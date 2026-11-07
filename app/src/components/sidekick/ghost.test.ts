import { describe, expect, it } from "vitest"
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { acceptGhost, clearGhost, getGhost, ghostExtension, setSuggestion, type GhostSuggestion } from "./ghost"

// The ghost is plain editor state, so it can be tested without a browser: apply transactions and read the field.
const suggestion = (over: Partial<GhostSuggestion> = {}): GhostSuggestion => ({
    from: 0,
    to: 8,
    insert: "$$\nx^2\n$$",
    label: "x^2",
    ...over,
})

function start(doc: string, s: GhostSuggestion | null = suggestion(), readOnly = false) {
    let state = EditorState.create({
        doc,
        selection: EditorSelection.cursor(doc.length),
        extensions: [ghostExtension, EditorState.readOnly.of(readOnly)],
    })
    if (s) state = state.update({ effects: setSuggestion.of(s) }).state
    return state
}

/** Just enough of an EditorView for acceptGhost/clearGhost: they only read `state` and call `dispatch`. */
function fakeView(state: EditorState) {
    const view = {
        state,
        dispatch(...specs: TransactionSpec[]) {
            view.state = view.state.update(...specs).state
        },
    }
    return view as unknown as EditorView & { state: EditorState }
}

describe("ghost suggestion", () => {
    it("shows after an explicit effect and starts out empty", () => {
        expect(getGhost(start("one half", null))).toBeNull()
        expect(getGhost(start("one half"))?.insert).toBe("$$\nx^2\n$$")
    })

    it("is not part of the document until accepted", () => {
        expect(start("one half").doc.toString()).toBe("one half")
    })

    it("is dropped when the writer types inside the text it would replace", () => {
        const state = start("one half").update({ changes: { from: 3, insert: "x" } }).state
        expect(getGhost(state)).toBeNull()
    })

    it("survives an edit after its range, and moves if the edit is before it", () => {
        const after = start("one half\nlater", suggestion({ from: 0, to: 8 })).update({ changes: { from: 14, insert: "!" } }).state
        expect(getGhost(after)).toMatchObject({ from: 0, to: 8 })

        const before = start("intro\none half", suggestion({ from: 6, to: 14 })).update({ changes: { from: 0, insert: "AB" } }).state
        expect(getGhost(before)).toMatchObject({ from: 8, to: 16 })
    })

    it("is dropped when the caret leaves its range", () => {
        const state = start("one half\nother", suggestion({ from: 0, to: 8 }))
            .update({ selection: EditorSelection.cursor(12) }).state
        expect(getGhost(state)).toBeNull()
        const inside = start("one half\nother", suggestion({ from: 0, to: 8 }))
            .update({ selection: EditorSelection.cursor(4) }).state
        expect(getGhost(inside)).not.toBeNull()
    })
})

describe("accepting and dismissing", () => {
    it("Tab/click replaces the range with the suggestion and puts the caret after it", () => {
        const view = fakeView(start("one half"))
        expect(acceptGhost(view)).toBe(true)
        expect(view.state.doc.toString()).toBe("$$\nx^2\n$$")
        expect(view.state.selection.main.head).toBe("$$\nx^2\n$$".length)
        expect(getGhost(view.state)).toBeNull()
    })

    it("does nothing without a suggestion", () => {
        const view = fakeView(start("one half", null))
        expect(acceptGhost(view)).toBe(false)
        expect(view.state.doc.toString()).toBe("one half")
    })

    it("never writes into a read-only block", () => {
        const view = fakeView(start("one half", suggestion(), true))
        expect(acceptGhost(view)).toBe(false)
        expect(view.state.doc.toString()).toBe("one half")
    })

    it("Esc dismisses without touching the document, and reports whether it had anything to dismiss", () => {
        const view = fakeView(start("one half"))
        expect(clearGhost(view)).toBe(true)
        expect(getGhost(view.state)).toBeNull()
        expect(view.state.doc.toString()).toBe("one half")
        expect(clearGhost(view)).toBe(false)
    })
})
