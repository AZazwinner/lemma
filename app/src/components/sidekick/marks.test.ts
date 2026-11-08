import { describe, expect, it } from "vitest"
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { clearFlag, getFlag, marksExtension, setFlag, type Flag } from "./marks"

// The flag is plain editor state, so it can be tested without a browser: apply transactions and read the field.
function start(doc: string, flag: Flag | null) {
    let state = EditorState.create({ doc, selection: EditorSelection.cursor(0), extensions: [marksExtension] })
    if (flag) state = state.update({ effects: setFlag.of(flag) }).state
    return state
}

/** Just enough of an EditorView for clearFlag: it only reads `state` and calls `dispatch`. */
function fakeView(state: EditorState) {
    const view = {
        state,
        dispatch(...specs: TransactionSpec[]) {
            view.state = view.state.update(...specs).state
        },
    }
    return view as unknown as EditorView & { state: EditorState }
}

describe("flagged step", () => {
    it("is only a mark: the document is not changed", () => {
        expect(start("2x + 3 = 7\n2x = 5", { from: 11, to: 17 }).doc.toString()).toBe("2x + 3 = 7\n2x = 5")
    })

    it("moves with an edit before it and survives an edit after it", () => {
        const flagged = start("a = 1\nb = 2\nc = 3", { from: 6, to: 11 })
        expect(getFlag(flagged.update({ changes: { from: 0, insert: "XY" } }).state)).toEqual({ from: 8, to: 13 })
        expect(getFlag(flagged.update({ changes: { from: 13, insert: "!" } }).state)).toEqual({ from: 6, to: 11 })
    })

    it("goes when the writer edits the flagged text, since the answer was for text that is gone", () => {
        const flagged = start("a = 1\nb = 2", { from: 6, to: 11 })
        expect(getFlag(flagged.update({ changes: { from: 8, insert: "x" } }).state)).toBeNull()
        expect(getFlag(flagged.update({ changes: { from: 6, to: 11, insert: "b = 3" } }).state)).toBeNull()
        // typing right at the end of the flagged step is editing it
        expect(getFlag(flagged.update({ changes: { from: 11, insert: "!" } }).state)).toBeNull()
    })

    it("is cleared by Esc without touching the text, and says whether there was one", () => {
        const view = fakeView(start("a = 1\nb = 2", { from: 6, to: 11 }))
        expect(clearFlag(view)).toBe(true)
        expect(getFlag(view.state)).toBeNull()
        expect(view.state.doc.toString()).toBe("a = 1\nb = 2")
        expect(clearFlag(view)).toBe(false)
    })
})
