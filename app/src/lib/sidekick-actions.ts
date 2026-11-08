import type { EditorView } from "@codemirror/view"
import type * as Y from "yjs"
import {
    checkWork,
    explainIntoDoc,
    explainLatex,
    fixLatex,
    SidekickApiError,
    suggestNext,
    textToLatex,
    writeIntoDoc,
    writeText,
} from "@/api/sidekick"
import { flagRange } from "@/components/sidekick/marks"
import { derivationErrorText, derivationSteps } from "@/lib/sidekick-derivation"
import { displayEquations } from "@/lib/equation-numbers"
import { findRenderProblem, shortRenderMessage } from "@/lib/sidekick-katex"
import {
    explainSource,
    explanationNote,
    latexSource,
    mentionAt,
    MAX_LATEX_CHARS,
    MAX_TEXT_CHARS,
    minimalEdit,
    noticeFor,
    splitBlocks,
    wrapLatex,
    type Source,
} from "@/lib/sidekick-text"
import {
    clearSlot,
    editorFor,
    getHost,
    getState,
    isCurrentSlot,
    makeAnchor,
    nextSlotId,
    noteForError,
    noteIn,
    refreshUsage,
    resolveAnchor,
    setSlot,
    type Proposal,
    type ProposalState,
} from "@/lib/sidekick"

// What the sidekick does, one function per action. Each starts from an explicit gesture (a button, a key, Ctrl/Cmd+Enter
// on an "@sidekick" line). Each puts a short "Thinking…" in the place its answer will appear, drops the answer if the text
// it was made for has changed meanwhile, and leaves the document alone: an answer is a ghost until it is accepted.

export type ActionOptions = {
    /** The block to act on. Defaults to the one the writer was last in. */
    blockId?: string
    /** Act on the whole block, whatever is selected in its editor (used when the block itself is selected). */
    whole?: boolean
}

export type ActionName = "explain" | "fix" | "next" | "rewrite"

type Target = {
    blockId: string
    view: EditorView
    text: Y.Text
    doc: string
    /** The selection, or the whole block when nothing is selected. */
    from: number
    to: number
    selected: boolean
    caret: number
}

function targetOf(opts?: ActionOptions): Target | null {
    const blockId = opts?.blockId ?? getState().activeBlockId
    const ref = blockId ? editorFor(blockId) : undefined
    if (!blockId || !ref || !ref.view.dom.isConnected) return null
    const doc = ref.view.state.doc.toString()
    const sel = ref.view.state.selection.main
    const selected = !opts?.whole && sel.from !== sel.to
    return {
        blockId,
        view: ref.view,
        text: ref.text,
        doc,
        from: selected ? sel.from : 0,
        to: selected ? sel.to : doc.length,
        selected,
        caret: sel.head,
    }
}

const VIEW_ONLY = { kind: "error", text: "This document is view-only." } as const

// ---- explain ----------------------------------------------------------------------------------------------------------

/** Which numbered equation of the block the explanation is about, so its card can say "Explanation of (3)". */
function equationIndexIn(t: Target): number | null {
    const equations = displayEquations(t.doc)
    if (!t.selected) return equations.length > 0 ? 0 : null
    const index = equations.findIndex((eq) => eq.to > t.from && eq.from < t.to)
    return index === -1 ? null : index
}

/** A short explanation of the selection, or of the block, in a card under the block. */
export async function explain(opts?: ActionOptions): Promise<void> {
    const t = targetOf(opts)
    if (!t) return
    if (getState().blocks[t.blockId]?.explain?.phase === "loading") return

    const source = explainSource(t.doc, t.selected ? t.from : 0, t.selected ? t.to : 0)
    if (!source) return noteIn(t.blockId, "explain", { kind: "info", text: "Put the cursor in an equation, or select one, then try again." })
    if (source.length > MAX_LATEX_CHARS) return noteIn(t.blockId, "explain", { kind: "error", text: "That is too long. Select just the equation." })

    const eq = equationIndexIn(t)
    const { collab, docId } = getState()
    const id = nextSlotId()
    setSlot(t.blockId, "explain", { id, phase: "loading", eq })
    try {
        if (collab && docId !== null && !t.view.state.readOnly) {
            // The Sidekick joins the document and writes the explanation in as a block, which reaches everyone as a normal edit.
            await explainIntoDoc(docId, source, t.blockId)
            if (isCurrentSlot(t.blockId, "explain", id)) clearSlot(t.blockId, "explain")
            return
        }
        const result = await explainLatex(source)
        if (isCurrentSlot(t.blockId, "explain", id)) setSlot(t.blockId, "explain", { id, phase: "ready", eq, text: result.text, mock: result.mock })
    } catch (error) {
        if (isCurrentSlot(t.blockId, "explain", id)) noteForError(t.blockId, "explain", error)
    } finally {
        void refreshUsage()
    }
}

/** "Insert as note": the explanation becomes a paragraph after the block, which everyone in the document then sees. */
export function insertNote(blockId: string): boolean {
    const slot = getState().blocks[blockId]?.explain
    const ref = editorFor(blockId)
    if (slot?.phase !== "ready" || !ref || ref.view.state.readOnly) return false
    getHost()?.insertBlocksAfter(blockId, [explanationNote(slot.text)])
    clearSlot(blockId, "explain")
    return true
}

// ---- fix --------------------------------------------------------------------------------------------------------------

const hasEquation = /[=<>≤≥]|\\(?:le|ge|neq|leq|geq)\b/

/**
 * Looks for what is wrong in the selection or the block. A LaTeX error is found in the browser, which costs nothing; a
 * step of a derivation that doesn't follow is found by the model. Either way the answer is a squiggle and one line; the
 * repair itself is only fetched (or shown) when "Fix" is clicked, and even then it is a ghost until accepted.
 */
export async function fix(opts?: ActionOptions): Promise<void> {
    const t = targetOf(opts)
    if (!t) return
    if (t.view.state.readOnly) return noteIn(t.blockId, "problem", VIEW_ONLY)
    if (getState().blocks[t.blockId]?.problem?.phase === "checking") return

    const render = findRenderProblem(t.doc, t.selected ? { from: t.from, to: t.to } : null)
    if (render !== "none" && render !== "no-math") {
        setSlot(t.blockId, "problem", {
            id: nextSlotId(),
            phase: "found",
            kind: "render",
            message: "This equation doesn't render.",
            detail: shortRenderMessage(render.message),
            error: render.message,
            flag: makeAnchor(t.text, render.from, render.to),
            region: makeAnchor(t.text, t.from, t.to),
            prepared: null,
            proposal: { phase: "idle" },
        })
        flagRange(t.view, render.from, render.to)
        return
    }

    const found = derivationSteps(t.doc, t.selected ? t.from : 0, t.selected ? t.to : 0)
    if ("error" in found) return noteIn(t.blockId, "problem", { kind: "info", text: derivationErrorText(found.error) })
    const steps = found.steps
    if (!steps.some((step) => hasEquation.test(step.text))) {
        return noteIn(t.blockId, "problem", { kind: "info", text: "Nothing to check here: no equations found." })
    }

    const anchors = steps.map((step) => makeAnchor(t.text, step.from, step.to))
    const id = nextSlotId()
    setSlot(t.blockId, "problem", { id, phase: "checking" })
    try {
        const result = await checkWork(steps.map((step) => step.text))
        if (!isCurrentSlot(t.blockId, "problem", id)) return
        // Typing in the steps while the sidekick was thinking: its answer is for text that is gone.
        if (!anchors.every((anchor) => resolveAnchor(t.text, anchor))) return clearSlot(t.blockId, "problem")

        if (result.ok) {
            const text = steps.length === 1 ? "No problems found." : "Every step follows from the one before."
            return setSlot(t.blockId, "problem", { id, phase: "clean", text })
        }
        const index = result.step !== null ? result.step - 1 : -1
        const flagAnchor = index >= 0 ? anchors[index] : null
        const range = flagAnchor ? resolveAnchor(t.text, flagAnchor) : null
        const prepared: Proposal | null =
            flagAnchor && result.suggestion
                ? {
                      label: "Suggested fix",
                      edit: { anchor: flagAnchor, mode: "replace", insert: result.suggestion },
                      blocksAfter: [],
                      show: { block: true },
                      why: "", // the line above the ghost already says why
                  }
                : null
        setSlot(t.blockId, "problem", {
            id,
            phase: "found",
            kind: "step",
            message: index > 0 ? "This step doesn't follow from the line above." : index === 0 ? "This step doesn't look right." : "Something looks off here.",
            detail: result.why,
            error: "",
            flag: flagAnchor,
            region: null,
            prepared,
            proposal: { phase: "idle" },
        })
        if (range) flagRange(t.view, range.from, range.to)
    } catch (error) {
        if (isCurrentSlot(t.blockId, "problem", id)) noteForError(t.blockId, "problem", error)
    } finally {
        void refreshUsage()
    }
}

/** The "Fix" button on a problem: shows the proposed repair as a ghost. Nothing in the block changes until it is accepted. */
export async function proposeFix(blockId: string): Promise<void> {
    const slot = getState().blocks[blockId]?.problem
    const ref = editorFor(blockId)
    if (slot?.phase !== "found" || !ref || slot.proposal.phase === "loading") return

    if (slot.prepared) {
        // The check already came with a fix: no new request.
        setSlot(blockId, "problem", { ...slot, proposal: { phase: "ready", proposal: slot.prepared } })
        return
    }
    if (slot.kind !== "render" || !slot.region) return

    const region = resolveAnchor(ref.text, slot.region)
    if (!region) return clearSlot(blockId, "problem")
    const regionText = ref.text.toString().slice(region.from, region.to)
    const stay = (proposal: ProposalState) => {
        const now = getState().blocks[blockId]?.problem
        if (now?.phase === "found" && now.id === slot.id) setSlot(blockId, "problem", { ...now, proposal })
    }
    if (regionText.length > MAX_LATEX_CHARS) return stay({ phase: "notice", notice: { kind: "error", text: "That is too long. Select just the equation." } })

    stay({ phase: "loading" })
    try {
        const result = await fixLatex(regionText, slot.error)
        const now = getState().blocks[blockId]?.problem
        if (now?.phase !== "found" || now.id !== slot.id) return
        const edit = result.changed ? minimalEdit(regionText, result.latex) : null
        if (!edit || !resolveAnchor(ref.text, slot.region)) {
            return stay({ phase: "notice", notice: { kind: "info", text: "Sidekick couldn't find a fix for that." } })
        }
        // Only the part that differs is replaced, so the rest of the block (and anyone's caret in it) is left alone.
        const changed = makeAnchor(ref.text, region.from + edit.from, region.from + edit.to)
        stay({
            phase: "ready",
            proposal: {
                label: "Suggested fix",
                edit: { anchor: changed, mode: "replace", insert: edit.insert },
                blocksAfter: [],
                show: { block: true },
                why: result.why,
            },
        })
    } catch (error) {
        stay({
            phase: "notice",
            notice: error instanceof SidekickApiError ? noticeFor(error.kind, error.retryAfter, error.reason) : noticeFor("upstream"),
        })
    } finally {
        void refreshUsage()
    }
}

// ---- next step --------------------------------------------------------------------------------------------------------

/** Suggests the next step of a derivation, as a dashed ghost block under the block. Exactly one step. */
export async function nextStep(opts?: ActionOptions): Promise<void> {
    const t = targetOf(opts)
    if (!t) return
    if (t.view.state.readOnly) return noteIn(t.blockId, "suggestion", VIEW_ONLY)

    const found = derivationSteps(t.doc, t.selected ? t.from : 0, t.selected ? t.to : 0)
    if ("error" in found) return noteIn(t.blockId, "suggestion", { kind: "info", text: derivationErrorText(found.error) })
    const steps = found.steps
    const last = steps[steps.length - 1]
    const anchor = makeAnchor(t.text, last.from, last.to)

    const id = nextSlotId()
    setSlot(t.blockId, "suggestion", { id, phase: "loading", kind: "next" })
    try {
        const result = await suggestNext(steps.map((step) => step.text))
        if (!isCurrentSlot(t.blockId, "suggestion", id)) return
        if (!resolveAnchor(t.text, anchor)) return clearSlot(t.blockId, "suggestion")
        if (result.done || !result.next) {
            return noteIn(t.blockId, "suggestion", { kind: "info", text: result.why || "That looks finished: there is no next step." })
        }
        setSlot(t.blockId, "suggestion", {
            id,
            phase: "ready",
            kind: "next",
            mock: result.mock,
            proposal: {
                label: "Suggested next step",
                // the step goes on a new line right after the last one, which keeps it inside a $$ block
                edit: { anchor, mode: "after", insert: `\n${result.next}` },
                blocksAfter: [],
                show: { snippet: wrapLatex(result.next, true) },
                why: result.why,
            },
        })
    } catch (error) {
        if (isCurrentSlot(t.blockId, "suggestion", id)) noteForError(t.blockId, "suggestion", error)
    } finally {
        void refreshUsage()
    }
}

// ---- rewrite ----------------------------------------------------------------------------------------------------------

function rewriteSource(t: Target, whole: boolean): Source | null {
    if (t.selected) return latexSource(t.doc, t.from, t.to)
    if (!whole) return latexSource(t.doc, t.caret, t.caret) // an "@sidekick ..." line if the caret is on one, else the block
    const text = t.doc.trim()
    return text ? { from: 0, to: t.doc.length, text, raw: t.doc, block: true } : null
}

/** Rewrites the selection (or the block) as LaTeX, shown in place as a suggestion. */
export async function rewrite(opts?: ActionOptions): Promise<void> {
    const t = targetOf(opts)
    if (!t) return
    if (t.view.state.readOnly) return noteIn(t.blockId, "suggestion", VIEW_ONLY)

    const source = rewriteSource(t, !!opts?.whole)
    if (!source) return noteIn(t.blockId, "suggestion", { kind: "info", text: "Write a description first (or select some text), then try again." })
    if (source.text.length > MAX_TEXT_CHARS) return noteIn(t.blockId, "suggestion", { kind: "error", text: "That is too long. Select a shorter description." })

    const anchor = makeAnchor(t.text, source.from, source.to)
    const id = nextSlotId()
    setSlot(t.blockId, "suggestion", { id, phase: "loading", kind: "rewrite" })
    try {
        const result = await textToLatex(source.text)
        if (!isCurrentSlot(t.blockId, "suggestion", id)) return
        if (!resolveAnchor(t.text, anchor)) return clearSlot(t.blockId, "suggestion")
        setSlot(t.blockId, "suggestion", {
            id,
            phase: "ready",
            kind: "rewrite",
            mock: result.mock,
            proposal: {
                label: "Suggested rewrite",
                edit: { anchor, mode: "replace", insert: wrapLatex(result.latex, source.block) },
                blocksAfter: [],
                show: { block: true },
                why: "",
            },
        })
    } catch (error) {
        if (isCurrentSlot(t.blockId, "suggestion", id)) noteForError(t.blockId, "suggestion", error)
    } finally {
        void refreshUsage()
    }
}

// ---- write from a description -------------------------------------------------------------------------------------------

/**
 * Writes something from a description: an equation, or a few paragraphs such as a proof, with its maths in `$...$` and
 * `$$...$$`. It is shown as a ghost under the block and goes into the document only when accepted. The "Write from
 * description" field and an "@sidekick ..." line (Ctrl/Cmd+Enter) both come here.
 */
export async function write(description: string, opts: { blockId?: string; replace?: Source } = {}): Promise<void> {
    const blockId = opts.blockId ?? getState().activeBlockId ?? getHost()?.blockIds().at(-1) ?? null
    const ref = blockId ? editorFor(blockId) : undefined
    if (!blockId || !ref) return
    const text = description.trim()

    if (ref.view.state.readOnly) return noteIn(blockId, "suggestion", VIEW_ONLY)
    if (!text) return noteIn(blockId, "suggestion", { kind: "info", text: "Write a description first, then try again." })
    if (text.length > MAX_TEXT_CHARS) return noteIn(blockId, "suggestion", { kind: "error", text: "That is too long. Use a shorter description." })

    const replace = opts.replace ? makeAnchor(ref.text, opts.replace.from, opts.replace.to) : null
    const { collab, docId } = getState()
    const id = nextSlotId()
    setSlot(blockId, "suggestion", { id, phase: "loading", kind: "write" })
    try {
        if (collab && docId !== null) {
            // The Sidekick joins the document and writes the passage in as blocks, which reach everyone as normal edits.
            await writeIntoDoc(docId, text, blockId)
            if (isCurrentSlot(blockId, "suggestion", id)) clearSlot(blockId, "suggestion")
            return
        }
        const result = await writeText(text)
        if (!isCurrentSlot(blockId, "suggestion", id)) return
        if (replace && !resolveAnchor(ref.text, replace)) return clearSlot(blockId, "suggestion")

        const chunks = splitBlocks(result.text)
        if (chunks.length === 0) return noteIn(blockId, "suggestion", { kind: "error", text: "The sidekick gave no text. Try again." })

        // An "@sidekick ..." line is replaced by the first block; an empty block is filled; otherwise everything goes after.
        const current = ref.text.toString()
        const into = replace ?? (current.trim() === "" ? makeAnchor(ref.text, 0, current.length) : null)
        setSlot(blockId, "suggestion", {
            id,
            phase: "ready",
            kind: "write",
            mock: result.mock,
            proposal: {
                label: "Suggested text",
                edit: into ? { anchor: into, mode: "replace", insert: chunks[0] } : null,
                blocksAfter: into ? chunks.slice(1) : chunks,
                show: { snippet: result.text },
                why: "",
            },
        })
    } catch (error) {
        if (isCurrentSlot(blockId, "suggestion", id)) noteForError(blockId, "suggestion", error)
    } finally {
        void refreshUsage()
    }
}

/** Ctrl/Cmd+Enter on an "@sidekick ..." line. */
export function runMention(blockId: string): boolean {
    const ref = editorFor(blockId)
    if (!ref) return false
    const mention = mentionAt(ref.view.state.doc.toString(), ref.view.state.selection.main.head)
    if (!mention) return false
    void write(mention.text, { blockId, replace: mention })
    return true
}

export const ACTIONS: Record<ActionName, (opts?: ActionOptions) => Promise<void>> = { explain, fix, next: nextStep, rewrite }
