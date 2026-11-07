import type { EditorView } from "@codemirror/view"
import {
    explainIntoDoc,
    explainLatex,
    fetchSidekickStatus,
    latexIntoDoc,
    SidekickApiError,
    textToLatex,
} from "@/api/sidekick"
import { clearFlag, clearGhost, showGhost, showWorking } from "@/components/sidekick/ghost"
import {
    explainSource,
    explanationText,
    isUnchanged,
    latexSource,
    MAX_LATEX_CHARS,
    MAX_TEXT_CHARS,
    noticeFor,
    wrapLatex,
    type Notice,
} from "@/lib/sidekick-text"

// The sidekick's client-side state and actions. Every action starts from an explicit user gesture (a menu item, or
// Ctrl/Cmd+Enter on an "@sidekick" line); nothing here runs on typing or on a timer.

export type Working = "latex" | "explain" | "fix" | "check" | "next" | null
export type Explanation = { summary: string; steps: string[]; mock: boolean }
/** The answer to "check my work". `stepRange` is where the flagged step is in the block, so "Use suggestion" can replace it. */
export type CheckCard = {
    ok: boolean
    stepNumber: number | null
    stepText: string | null
    stepRange: { from: number; to: number } | null
    why: string
    suggestion: string | null
    mock: boolean
}

export type SidekickState = {
    /** "unknown" until the status check returns; the button stays hidden unless "ready". */
    availability: "unknown" | "ready" | "off"
    mock: boolean
    usedToday: number | null
    dailyBudget: number | null
    working: Working
    notice: Notice | null
    explanation: Explanation | null
    check: CheckCard | null
    menuOpen: boolean
    /** The editor view (one per block) that was last focused. */
    view: EditorView | null
    /** The document this button belongs to, for collaborator mode. */
    docId: number | null
    /**
     * Collaborator mode: instead of a private suggestion, the Sidekick joins the document like another person and
     * writes its answer in as a new block. Off unless the person turns it on.
     */
    collab: boolean
}

const initial: SidekickState = {
    availability: "unknown",
    mock: false,
    usedToday: null,
    dailyBudget: null,
    working: null,
    notice: null,
    explanation: null,
    check: null,
    menuOpen: false,
    view: null,
    docId: null,
    collab: false,
}

let state: SidekickState = initial
const listeners = new Set<() => void>()
let noticeTimer: ReturnType<typeof setTimeout> | null = null

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

export function resetSidekick() {
    if (noticeTimer) clearTimeout(noticeTimer)
    noticeTimer = null
    state = initial
    listeners.forEach((l) => l())
}

function showNotice(notice: Notice) {
    if (noticeTimer) clearTimeout(noticeTimer)
    // The note appears under the icon, so the menu (which would sit on top of it) closes.
    set({ notice, menuOpen: false, explanation: null, check: null })
    const ms = notice.kind === "busy" ? Math.min(Math.max((notice.retryAfter ?? 30) * 1000, 6000), 60_000) : 7000
    noticeTimer = setTimeout(() => set({ notice: null }), ms)
}

export function dismissNotice() {
    if (noticeTimer) clearTimeout(noticeTimer)
    noticeTimer = null
    if (state.notice) set({ notice: null })
}

function showError(error: unknown) {
    if (error instanceof SidekickApiError) showNotice(noticeFor(error.kind, error.retryAfter))
    else showNotice(noticeFor("upstream"))
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
        // Not signed in, backend too old to have the endpoint, or unreachable: no sidekick, and no noise about it.
        if (!(error instanceof SidekickApiError)) console.error(error)
        set({ availability: "off" })
    }
}

export const setMenuOpen = (menuOpen: boolean) => {
    if (menuOpen && !state.menuOpen) void loadStatusQuietly()
    if (!menuOpen) dropFlag()
    set(menuOpen ? { menuOpen } : { menuOpen, explanation: null, check: null })
}

/** Refreshes the "used today" count when the menu opens. It never touches Google, so it costs no quota. */
async function loadStatusQuietly() {
    try {
        const status = await fetchSidekickStatus()
        set({ usedToday: status.used_today, dailyBudget: status.daily_budget, mock: status.mock })
    } catch {
        // the count is a nicety
    }
}

// Which block each editor view is, so the Sidekick can put its block right after the one the writer is in.
const blockIds = new WeakMap<EditorView, string>()

export function setActiveView(view: EditorView | null, blockId?: string) {
    if (view && blockId) blockIds.set(view, blockId)
    if (view === state.view) return
    set({ view })
}

const COLLAB_KEY = "sidekick.collab"

export function setDocId(docId: number | null) {
    set({ docId })
}

export function setCollab(collab: boolean) {
    set({ collab })
    try {
        localStorage.setItem(COLLAB_KEY, collab ? "1" : "0")
    } catch {
        // a remembered preference is a nicety; the switch still works for this visit
    }
}

function readCollabPreference(): boolean {
    try {
        return localStorage.getItem(COLLAB_KEY) === "1"
    } catch {
        return false
    }
}

export function forgetView(view: EditorView) {
    if (state.view === view) set({ view: null })
}

/** Closes whatever the sidekick has open. Returns true if something was open (so Esc is used up). */
export function closeSidekickUi(): boolean {
    if (state.explanation || state.check || state.menuOpen) {
        dropFlag()
        set({ explanation: null, check: null, menuOpen: false })
        return true
    }
    return false
}

/** The flagged step was edited (or dismissed), so its "Use suggestion" no longer applies. */
export function flagCleared(view: EditorView) {
    if (state.view === view && state.check?.stepRange) set({ check: { ...state.check, stepRange: null } })
}

/** Removes the highlight on a flagged step, if the last-used block has one. */
function dropFlag() {
    if (state.view && state.view.dom.isConnected) clearFlag(state.view)
}

function usableView(): EditorView | null {
    const view = state.view
    if (!view || !view.dom.isConnected || !view.hasFocus) {
        showNotice({ kind: "error", text: "Click into the text you want to use first." })
        return null
    }
    return view
}

/** Natural language to LaTeX, shown as ghost text to accept with Tab or a click. */
export async function convertToLatex(): Promise<void> {
    if (state.working) return
    const view = usableView()
    if (!view) return
    if (view.state.readOnly) {
        showNotice({ kind: "error", text: "This document is view-only." })
        return
    }

    const { from, to } = view.state.selection.main
    const doc = view.state.doc.toString()
    const source = latexSource(doc, from, to)
    if (!source) {
        showNotice({ kind: "error", text: "Write a description first (or select some text), then try again." })
        return
    }
    if (source.text.length > MAX_TEXT_CHARS) {
        showNotice({ kind: "error", text: "That is too long. Select a shorter description." })
        return
    }

    set({ working: "latex", menuOpen: false })
    clearGhost(view)
    showWorking(view, source.to)
    try {
        if (state.collab && state.docId !== null) {
            // The Sidekick joins the document and writes a block after this one. The block reaches this editor, and
            // everyone else's, as an ordinary synced edit, so there is nothing to show here but the quiet "Working…".
            await latexIntoDoc(state.docId, source.text, blockIds.get(view))
            if (view.dom.isConnected) clearGhost(view)
            return
        }
        const result = await textToLatex(source.text)
        if (!view.dom.isConnected || !isUnchanged(view.state.doc.toString(), source)) {
            // The text moved or changed while the sidekick was thinking. Don't second-guess the writer.
            clearGhost(view)
            return
        }
        showGhost(view, {
            from: source.from,
            to: source.to,
            insert: wrapLatex(result.latex, source.block),
            label: result.latex,
        })
    } catch (error) {
        if (view.dom.isConnected) clearGhost(view)
        showError(error)
    } finally {
        set({ working: null })
        void loadStatusQuietly()
    }
}

/** A plain-language, step-by-step explanation, shown in a small card. Nothing goes into the document unless "Insert below" is clicked. */
export async function explainEquation(): Promise<void> {
    if (state.working) return
    const view = usableView()
    if (!view) return

    const { from, to } = view.state.selection.main
    const text = explainSource(view.state.doc.toString(), from, to)
    if (!text) {
        showNotice({ kind: "error", text: "Put the cursor in an equation, or select one, then try again." })
        return
    }
    if (text.length > MAX_LATEX_CHARS) {
        showNotice({ kind: "error", text: "That is too long. Select just the equation." })
        return
    }

    const collab = state.collab && state.docId !== null && !view.state.readOnly
    set({ working: "explain", explanation: null, menuOpen: !collab })
    try {
        if (collab) {
            await explainIntoDoc(state.docId as number, text, blockIds.get(view))
            return
        }
        const result = await explainLatex(text)
        set({ explanation: { summary: result.summary, steps: result.steps, mock: result.mock } })
    } catch (error) {
        set({ menuOpen: false })
        showError(error)
    } finally {
        set({ working: null })
        void loadStatusQuietly()
    }
}

/** Appends the explanation to the end of the block the cursor was in. Only runs from an explicit click. */
export function insertExplanation(): boolean {
    const view = state.view
    const explanation = state.explanation
    if (!view || !explanation || !view.dom.isConnected || view.state.readOnly) return false
    const end = view.state.doc.length
    const insert = `\n\n${explanationText(explanation.summary, explanation.steps)}`
    view.dispatch({ changes: { from: end, insert }, userEvent: "input.sidekick" })
    set({ explanation: null, menuOpen: false })
    return true
}

/** Ctrl/Cmd+Enter on an "@sidekick ..." line. */
export function runMention(view: EditorView): boolean {
    setActiveView(view)
    void convertToLatex()
    return true
}

// For sidekick-math.ts, which holds the maths helpers (fix, check, next step) so this file stays readable.
export {
    set as patchState,
    showNotice as notify,
    showError as notifyError,
    usableView as focusedView,
    loadStatusQuietly as refreshUsage,
}
