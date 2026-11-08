import type { EditorView } from "@codemirror/view"
import * as Y from "yjs"
import { fetchSidekickStatus, SidekickApiError } from "@/api/sidekick"
import { clearFlag } from "@/components/sidekick/marks"
import { noticeFor, type Notice } from "@/lib/sidekick-text"

// The sidekick's client-side state. Everything it shows lives here, per block, and is only ever on this person's screen:
// nothing in this file writes to the shared document except accepting a suggestion (a normal edit, through the block's
// editor) and "Insert as note", and both start from an explicit click or key press. Nothing runs on typing or on a timer.

// ---- what a block can show -------------------------------------------------------------------------------------------

/**
 * A stretch of a block's text that stays put while the text around it is edited. It is only good while the text inside
 * is what it was when the request was made: if that changes, the answer no longer fits and is dropped.
 */
export type Anchor = { from: Y.RelativePosition; to: Y.RelativePosition; raw: string }

/** One change to a block's text: `replace` swaps the anchored text for `insert`, `after` adds `insert` just after it. */
export type Edit = { anchor: Anchor; mode: "replace" | "after"; insert: string }

/** Something the sidekick suggests, shown as a ghost until it is accepted. */
export type Proposal = {
    /** The chip on the ghost: "Suggested fix", "Suggested next step", ... */
    label: string
    /** The change to this block, if any. */
    edit: Edit | null
    /** New blocks to add after this one (the rest of something it wrote). */
    blocksAfter: string[]
    /** What the ghost draws: this block as it would read afterwards, or a snippet of Markdown. */
    show: { block: true } | { snippet: string }
    /** One sentence on what it does or what was wrong. May hold `$maths$`. */
    why: string
}

type Slot<T> = T & { id: number }

export type ExplainSlot = Slot<
    | { phase: "loading"; eq: number | null }
    | { phase: "ready"; eq: number | null; text: string; mock: boolean }
    | { phase: "notice"; notice: Notice }
>

export type ProposalState =
    | { phase: "idle" }
    | { phase: "loading" }
    | { phase: "ready"; proposal: Proposal }
    | { phase: "notice"; notice: Notice }

export type ProblemSlot = Slot<
    | { phase: "checking" }
    | { phase: "clean"; text: string }
    | { phase: "notice"; notice: Notice }
    | {
          phase: "found"
          /** "render": the equation won't draw. "step": a line of the work doesn't follow. */
          kind: "render" | "step"
          message: string
          /** What the page shows after the message: the renderer's reason, or the model's one sentence. May hold `$maths$`. */
          detail: string
          /** The renderer's full message, which the model is given when asked to repair. Empty for "step". */
          error: string
          /** What gets the squiggle. */
          flag: Anchor | null
          /** For "render": the text that is sent to be repaired. */
          region: Anchor | null
          /** For "step": the fix that came with the check, shown when "Fix" is clicked. */
          prepared: Proposal | null
          proposal: ProposalState
      }
>

export type SuggestionKind = "next" | "rewrite" | "write" | "photo"

export type SuggestionSlot = Slot<
    | { phase: "loading"; kind: SuggestionKind }
    | { phase: "ready"; kind: SuggestionKind; proposal: Proposal; mock: boolean }
    | { phase: "notice"; notice: Notice }
>

export type SlotKey = "explain" | "problem" | "suggestion"
export type BlockSlots = { explain?: ExplainSlot; problem?: ProblemSlot; suggestion?: SuggestionSlot }

export type Availability = "unknown" | "ready" | "off" | "unavailable"

export type SidekickState = {
    /** "unknown" until the status check returns. "off": the server has the sidekick switched off. "unavailable": not signed in, or the backend is unreachable. */
    availability: Availability
    mock: boolean
    usedToday: number | null
    dailyBudget: number | null
    menuOpen: boolean
    /** The document this button belongs to, for collaborator mode. */
    docId: number | null
    readOnly: boolean
    /** The block the writer was last in. The menu acts on it, and it stays after focus moves into the menu. */
    activeBlockId: string | null
    /**
     * Collaborator mode: instead of a private suggestion, the Sidekick joins the document like another person and
     * writes its answer in as new blocks. Off unless the person turns it on.
     */
    collab: boolean
    blocks: Readonly<Record<string, BlockSlots>>
}

const initial: SidekickState = {
    availability: "unknown",
    mock: false,
    usedToday: null,
    dailyBudget: null,
    menuOpen: false,
    docId: null,
    readOnly: false,
    activeBlockId: null,
    collab: false,
    blocks: {},
}

let state: SidekickState = initial
const listeners = new Set<() => void>()

function set(patch: Partial<SidekickState>) {
    state = { ...state, ...patch }
    listeners.forEach((l) => l())
}

export const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}
export const getState = () => state
export const getServerState = () => initial

// ---- the editors the sidekick can reach --------------------------------------------------------------------------------

type BlockEditorRef = { view: EditorView; text: Y.Text }
const editors = new Map<string, BlockEditorRef>()

/** What the sidekick needs from the page that owns the blocks. */
export type Host = {
    blockIds(): string[]
    /** Adds blocks after the block with this id (or at the end), as the person who asked: everyone sees them. */
    insertBlocksAfter(blockId: string | null, contents: string[]): void
}
let host: Host | null = null

export function setHost(next: Host | null) {
    host = next
}
export const getHost = () => host

export function registerBlock(blockId: string, view: EditorView, text: Y.Text) {
    editors.set(blockId, { view, text })
    if (view.hasFocus) setActiveBlock(blockId)
}

/** The block's editor is going away (the block was deleted, or the page closed): its sidekick results go with it. */
export function unregisterBlock(blockId: string, view: EditorView) {
    if (editors.get(blockId)?.view !== view) return
    editors.delete(blockId)
    dropBlock(blockId)
}

export const editorFor = (blockId: string): BlockEditorRef | undefined => editors.get(blockId)

export function blockIdOfView(view: EditorView): string | null {
    for (const [blockId, ref] of editors) if (ref.view === view) return blockId
    return null
}

export function setActiveBlock(blockId: string | null) {
    if (blockId === state.activeBlockId) return
    set({ activeBlockId: blockId })
}

// ---- anchors -----------------------------------------------------------------------------------------------------------

export function makeAnchor(text: Y.Text, from: number, to: number): Anchor {
    return {
        // Attached outward (the start to the character before it, the end to the one after it), so something typed right at
        // either edge lands inside the range: adding to the end of the line a suggestion was made for changes that line.
        from: Y.createRelativePositionFromTypeIndex(text, from, -1),
        to: Y.createRelativePositionFromTypeIndex(text, to, 0),
        raw: text.toString().slice(from, to),
    }
}

/** Where an anchor is now, or null if the text inside it has been edited (or it is gone). */
export function resolveAnchor(text: Y.Text, anchor: Anchor): { from: number; to: number } | null {
    const ydoc = text.doc
    if (!ydoc) return null
    const from = Y.createAbsolutePositionFromRelativePosition(anchor.from, ydoc)
    const to = Y.createAbsolutePositionFromRelativePosition(anchor.to, ydoc)
    if (!from || !to || from.type !== text || to.type !== text || to.index < from.index) return null
    return text.toString().slice(from.index, to.index) === anchor.raw ? { from: from.index, to: to.index } : null
}

/** The block as it would read once the proposal's edit is made, or null if the text it was made for has changed. */
export function textAfterEdit(blockId: string, proposal: Proposal): string | null {
    const ref = editors.get(blockId)
    if (!ref) return null
    const doc = ref.text.toString()
    if (!proposal.edit) return doc
    const range = resolveAnchor(ref.text, proposal.edit.anchor)
    if (!range) return null
    const from = proposal.edit.mode === "after" ? range.to : range.from
    return doc.slice(0, from) + proposal.edit.insert + doc.slice(range.to)
}

// ---- slots -------------------------------------------------------------------------------------------------------------

let slotCounter = 0
export const nextSlotId = () => ++slotCounter

const timers = new Map<string, ReturnType<typeof setTimeout>>()
const timerKey = (blockId: string, key: SlotKey) => `${blockId}\0${key}`

function cancelTimer(blockId: string, key: SlotKey) {
    const k = timerKey(blockId, key)
    const timer = timers.get(k)
    if (timer) clearTimeout(timer)
    timers.delete(k)
}

/** How long a quiet note stays before it goes by itself. Answers and errors that need a decision never time out. */
function lifetimeOf(slot: { phase: string; notice?: Notice }): number | null {
    if (slot.phase === "clean") return 8000
    if (slot.phase !== "notice" || !slot.notice) return null
    if (slot.notice.kind === "busy") return Math.min(Math.max((slot.notice.retryAfter ?? 30) * 1000, 6000), 60_000)
    return 8000
}

function writeSlots(blockId: string, slots: BlockSlots) {
    const blocks = { ...state.blocks }
    if (!slots.explain && !slots.problem && !slots.suggestion) delete blocks[blockId]
    else blocks[blockId] = slots
    set({ blocks })
}

/** Puts a slot on a block (or removes it with null), replacing what was there. */
export function setSlot<K extends SlotKey>(blockId: string, key: K, slot: NonNullable<BlockSlots[K]> | null) {
    cancelTimer(blockId, key)
    const before = state.blocks[blockId]?.[key]
    const next: BlockSlots = { ...state.blocks[blockId] }
    if (slot) (next as Record<string, unknown>)[key] = slot
    else delete next[key]
    writeSlots(blockId, next)

    if (key === "problem" && before && (before as ProblemSlot).phase === "found" && !(slot && (slot as ProblemSlot).phase === "found")) {
        const view = editors.get(blockId)?.view
        if (view && view.dom.isConnected) clearFlag(view)
    }
    const ms = slot ? lifetimeOf(slot as { phase: string; notice?: Notice }) : null
    if (slot && ms !== null) {
        const id = slot.id
        timers.set(
            timerKey(blockId, key),
            setTimeout(() => {
                if (state.blocks[blockId]?.[key]?.id === id) setSlot(blockId, key, null)
            }, ms)
        )
    }
}

/** True while this slot is still the one that a running request was started for (it may have been dismissed or replaced). */
export const isCurrentSlot = (blockId: string, key: SlotKey, id: number) => state.blocks[blockId]?.[key]?.id === id

export function clearSlot(blockId: string, key: SlotKey) {
    if (state.blocks[blockId]?.[key]) setSlot(blockId, key, null)
}

/** Shows a calm note in the place where the result of an action would have appeared. */
export function noteIn(blockId: string, key: SlotKey, notice: Notice) {
    const slot = { id: nextSlotId(), phase: "notice", notice }
    setSlot(blockId, key, slot as NonNullable<BlockSlots[SlotKey]>)
}

export function noteForError(blockId: string, key: SlotKey, error: unknown) {
    if (error instanceof SidekickApiError) noteIn(blockId, key, noticeFor(error.kind, error.retryAfter, error.reason))
    else noteIn(blockId, key, noticeFor("upstream"))
}

/** A block is gone (deleted, or its editor was rebuilt): forget everything shown for it. */
export function dropBlock(blockId: string) {
    for (const key of ["explain", "problem", "suggestion"] as const) cancelTimer(blockId, key)
    if (state.blocks[blockId]) {
        const blocks = { ...state.blocks }
        delete blocks[blockId]
        set({ blocks })
    }
    if (state.activeBlockId === blockId) set({ activeBlockId: null })
}

/** The blocks that exist now. Anything shown for a block that is no longer in the document goes away. */
export function pruneBlocks(existing: string[]) {
    const keep = new Set(existing)
    for (const blockId of Object.keys(state.blocks)) if (!keep.has(blockId)) dropBlock(blockId)
    if (state.activeBlockId && !keep.has(state.activeBlockId) && existing.length > 0) set({ activeBlockId: null })
}

/** The block's text changed: drop what was made for text that is no longer there. */
export function revalidateBlock(blockId: string) {
    const slots = state.blocks[blockId]
    const ref = editors.get(blockId)
    if (!slots || !ref) return
    const stale = (anchor: Anchor | null | undefined) => !!anchor && !resolveAnchor(ref.text, anchor)

    const suggestion = slots.suggestion
    if (suggestion?.phase === "ready" && stale(suggestion.proposal.edit?.anchor)) clearSlot(blockId, "suggestion")

    const problem = slots.problem
    if (problem?.phase === "found") {
        const open = problem.proposal.phase === "ready" ? problem.proposal.proposal : null
        if (stale(problem.flag) || stale(problem.region) || stale(problem.prepared?.edit?.anchor) || stale(open?.edit?.anchor)) {
            clearSlot(blockId, "problem")
        }
    }
}

/** The editor's squiggle on a flagged step went away (the step was edited, or it was dismissed): the problem goes with it. */
export function flagCleared(blockId: string) {
    if (state.blocks[blockId]?.problem?.phase === "found") clearSlot(blockId, "problem")
}

// ---- accepting and dismissing --------------------------------------------------------------------------------------------

/** The proposal showing as a ghost in a block: `which` picks one, otherwise the suggestion comes first (as it does for Esc). */
function readyProposal(slots: BlockSlots | undefined, which?: "suggestion" | "problem"): { from: SlotKey; proposal: Proposal } | null {
    if (which !== "problem" && slots?.suggestion?.phase === "ready") return { from: "suggestion", proposal: slots.suggestion.proposal }
    if (which !== "suggestion" && slots?.problem?.phase === "found" && slots.problem.proposal.phase === "ready") {
        return { from: "problem", proposal: slots.problem.proposal.proposal }
    }
    return null
}

/** True if there is something in this block that Tab would accept. */
export const hasPending = (blockId: string) => readyProposal(state.blocks[blockId]) !== null

/**
 * Makes the edit a proposal describes (Tab, or the Accept button on its ghost). Returns false, and changes nothing, if
 * there is nothing to accept or the text it was made for has changed.
 */
export function acceptPending(blockId: string, which?: "suggestion" | "problem"): boolean {
    const found = readyProposal(state.blocks[blockId], which)
    const ref = editors.get(blockId)
    if (!found || !ref || !ref.view.dom.isConnected || ref.view.state.readOnly) return false
    const { proposal } = found

    const { edit } = proposal
    if (edit) {
        const range = resolveAnchor(ref.text, edit.anchor)
        if (!range) {
            clearSlot(blockId, found.from)
            noteIn(blockId, "suggestion", { kind: "info", text: "That text changed, so Sidekick dropped its suggestion." })
            return false
        }
        const from = edit.mode === "after" ? range.to : range.from
        ref.view.dispatch({
            changes: { from, to: range.to, insert: edit.insert },
            // The caret only moves if it is already in this block; accepting never takes the focus.
            ...(ref.view.hasFocus ? { selection: { anchor: from + edit.insert.length } } : {}),
            userEvent: "input.sidekick",
        })
    }
    if (proposal.blocksAfter.length > 0) host?.insertBlocksAfter(blockId, proposal.blocksAfter)
    clearSlot(blockId, found.from)
    return true
}

/** "Fix" was open on a problem: close just that, back to the line with the Fix button. */
export function closeProposal(blockId: string) {
    const slot = state.blocks[blockId]?.problem
    if (slot?.phase === "found" && slot.proposal.phase !== "idle") setSlot(blockId, "problem", { ...slot, proposal: { phase: "idle" } })
}

/** Esc: dismisses what the sidekick shows in this block, the most recent thing first. Returns true if there was something. */
export function dismissTop(blockId: string): boolean {
    const slots = state.blocks[blockId]
    if (!slots) return false
    if (slots.suggestion) clearSlot(blockId, "suggestion")
    else if (slots.problem?.phase === "found" && slots.problem.proposal.phase !== "idle") closeProposal(blockId)
    else if (slots.problem) clearSlot(blockId, "problem")
    else if (slots.explain) clearSlot(blockId, "explain")
    return true
}

// ---- status, menu and settings ---------------------------------------------------------------------------------------------

const COLLAB_KEY = "sidekick.collab"

function readCollabPreference(): boolean {
    try {
        return localStorage.getItem(COLLAB_KEY) === "1"
    } catch {
        return false
    }
}

export function resetSidekick() {
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
    editors.clear()
    state = initial
    listeners.forEach((l) => l())
}

export async function loadStatus() {
    try {
        const status = await fetchSidekickStatus()
        set({
            availability: status.enabled ? "ready" : "off",
            collab: readCollabPreference(),
            mock: status.mock,
            usedToday: status.used_today,
            dailyBudget: status.daily_budget,
        })
    } catch (error) {
        // Not signed in, a backend too old to have the endpoint, or unreachable: no sidekick, and no noise about it.
        if (!(error instanceof SidekickApiError)) console.error(error)
        set({ availability: "unavailable" })
    }
}

/** Refreshes the "used today" count. It never calls the AI, so it costs nothing. */
export async function refreshUsage() {
    try {
        const status = await fetchSidekickStatus()
        set({ usedToday: status.used_today, dailyBudget: status.daily_budget, mock: status.mock })
    } catch {
        // the count is a nicety
    }
}

export const setMenuOpen = (menuOpen: boolean) => {
    if (menuOpen && !state.menuOpen) void refreshUsage()
    set({ menuOpen })
}

export const setDocId = (docId: number | null) => set({ docId })
export const setReadOnly = (readOnly: boolean) => set({ readOnly })

export function setCollab(collab: boolean) {
    set({ collab })
    try {
        localStorage.setItem(COLLAB_KEY, collab ? "1" : "0")
    } catch {
        // a remembered preference is a nicety; the switch still works for this visit
    }
}

/** True while any block is waiting for an answer. */
export const isWorking = (s: SidekickState = state) =>
    Object.values(s.blocks).some(
        (b) =>
            b.explain?.phase === "loading" ||
            b.suggestion?.phase === "loading" ||
            b.problem?.phase === "checking" ||
            (b.problem?.phase === "found" && b.problem.proposal.phase === "loading")
    )
