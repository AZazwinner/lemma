import { checkWork, fixLatex, suggestNext } from "@/api/sidekick"
import { clearTransient, flagRange, showGhost, showWorking } from "@/components/sidekick/ghost"
import { derivationErrorText, derivationSteps, type Step } from "@/lib/sidekick-derivation"
import { firstLatexProblem, renderError } from "@/lib/sidekick-katex"
import { MAX_LATEX_CHARS } from "@/lib/sidekick-text"
import { focusedView, getState, notify, notifyError, patchState, refreshUsage } from "@/lib/sidekick"

// The maths helpers: fix a LaTeX error, check a derivation, suggest the next step. Like everything else they start only
// from a click, and what they show (a ghost to accept, a highlight, a card) never changes the document by itself.

/** Fix a LaTeX error. Finds the broken equation in the browser first, so a block with no error costs no request. */
export async function fixLatexError(): Promise<void> {
    if (getState().working) return
    const view = focusedView()
    if (!view) return
    if (view.state.readOnly) return notify({ kind: "error", text: "This document is view-only." })

    const { from, to } = view.state.selection.main
    const doc = view.state.doc.toString()

    let target: { from: number; to: number; latex: string; message: string }
    if (from !== to) {
        const start = Math.min(from, to)
        const end = Math.max(from, to)
        const latex = doc.slice(start, end)
        const message = renderError(latex)
        if (!message) return notify({ kind: "info", text: "That already renders fine." })
        target = { from: start, to: end, latex, message }
    } else {
        const problem = firstLatexProblem(doc)
        if (problem === "no-math") return notify({ kind: "info", text: "No equations in this block." })
        if (problem === "none") return notify({ kind: "info", text: "Every equation in this block renders fine." })
        target = { from: problem.span.from, to: problem.span.to, latex: problem.span.latex, message: problem.message }
    }
    if (target.latex.length > MAX_LATEX_CHARS) return notify({ kind: "error", text: "That is too long. Select just the equation." })

    patchState({ working: "fix", menuOpen: false })
    clearTransient(view)
    showWorking(view, target.to)
    try {
        const result = await fixLatex(target.latex, target.message)
        const now = view.state.doc.toString()
        if (!view.dom.isConnected || now.slice(target.from, target.to) !== target.latex) {
            clearTransient(view)
            return
        }
        if (!result.changed) {
            clearTransient(view)
            return notify({ kind: "info", text: "The sidekick couldn't find a fix for that." })
        }
        showGhost(view, {
            from: target.from,
            to: target.to,
            insert: result.latex,
            label: result.latex,
            scope: { from: 0, to: now.length },
        })
        if (result.why) notify({ kind: "info", text: `${result.why} Tab to accept.` })
    } catch (error) {
        if (view.dom.isConnected) clearTransient(view)
        notifyError(error)
    } finally {
        patchState({ working: null })
        void refreshUsage()
    }
}

function stepsOrNotify(view: NonNullable<ReturnType<typeof focusedView>>): Step[] | null {
    const { from, to } = view.state.selection.main
    const found = derivationSteps(view.state.doc.toString(), from, to)
    if ("error" in found) {
        notify({ kind: "error", text: derivationErrorText(found.error) })
        return null
    }
    return found.steps
}

/** Check my work: flags the first step that doesn't follow, with a quiet highlight and a small card. */
export async function checkMyWork(): Promise<void> {
    if (getState().working) return
    const view = focusedView()
    if (!view) return
    const steps = stepsOrNotify(view)
    if (!steps) return

    const sent = view.state.doc.toString()
    patchState({ working: "check", check: null, menuOpen: true })
    try {
        const result = await checkWork(steps.map((s) => s.text))
        const unchanged = view.dom.isConnected && view.state.doc.toString() === sent
        const flagged = result.step !== null ? steps[result.step - 1] : null
        if (!result.ok && flagged && unchanged) flagRange(view, flagged.from, flagged.to)
        patchState({
            check: {
                ok: result.ok,
                stepNumber: result.ok ? null : result.step,
                stepText: flagged?.text ?? null,
                // only usable while the text is exactly what was checked
                stepRange: unchanged && flagged ? { from: flagged.from, to: flagged.to } : null,
                why: result.why,
                suggestion: result.suggestion,
                mock: result.mock,
            },
        })
    } catch (error) {
        patchState({ menuOpen: false })
        notifyError(error)
    } finally {
        patchState({ working: null })
        void refreshUsage()
    }
}

/** "Use suggestion" on the check card: replaces the flagged step with the corrected one. Only from a click. */
export function applyCheckSuggestion(): boolean {
    const { view, check } = getState()
    if (!view || !check?.suggestion || !check.stepRange || !check.stepText) return false
    if (!view.dom.isConnected || view.state.readOnly) return false
    const { from, to } = check.stepRange
    if (view.state.doc.sliceString(from, to) !== check.stepText) return false
    view.dispatch({ changes: { from, to, insert: check.suggestion }, userEvent: "input.sidekick" })
    patchState({ check: null, menuOpen: false })
    return true
}

/** Suggest the next step, as ghost text on a new line after the last step. */
export async function suggestNextStep(): Promise<void> {
    if (getState().working) return
    const view = focusedView()
    if (!view) return
    if (view.state.readOnly) return notify({ kind: "error", text: "This document is view-only." })
    const steps = stepsOrNotify(view)
    if (!steps) return

    const last = steps[steps.length - 1]
    const sent = view.state.doc.toString()
    patchState({ working: "next", menuOpen: false })
    clearTransient(view)
    showWorking(view, last.to)
    try {
        const result = await suggestNext(steps.map((s) => s.text))
        const now = view.state.doc.toString()
        if (!view.dom.isConnected || now !== sent) {
            clearTransient(view)
            return
        }
        if (result.done || !result.next) {
            clearTransient(view)
            return notify({ kind: "info", text: result.why || "That looks finished: there is no next step." })
        }
        showGhost(view, {
            from: last.to,
            to: last.to,
            insert: `\n${result.next}`,
            label: result.next,
            scope: { from: 0, to: now.length },
        })
        if (result.why) notify({ kind: "info", text: `${result.why} Tab to add it.` })
    } catch (error) {
        if (view.dom.isConnected) clearTransient(view)
        notifyError(error)
    } finally {
        patchState({ working: null })
        void refreshUsage()
    }
}
