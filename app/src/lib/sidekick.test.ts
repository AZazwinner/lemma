import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as Y from "yjs"
import { EditorState, type StateEffect } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { marksExtension } from "@/components/sidekick/marks"
import {
    acceptPending,
    clearSlot,
    dismissTop,
    getState,
    hasPending,
    makeAnchor,
    nextSlotId,
    noteIn,
    pruneBlocks,
    registerBlock,
    resetSidekick,
    resolveAnchor,
    revalidateBlock,
    setHost,
    setSlot,
    textAfterEdit,
    unregisterBlock,
    type Proposal,
} from "./sidekick"

// The store holds what the sidekick shows, per block, in memory only. A real Y.Text stands in for the block's shared text,
// and a minimal object for its editor (the store only reads `state` and calls `dispatch`).
function makeBlock(blockId: string, initial: string, readOnly = false) {
    const ydoc = new Y.Doc()
    const text = ydoc.getText(blockId)
    text.insert(0, initial)
    const fake = {
        dom: { isConnected: true },
        hasFocus: false,
        // a real editor state, so the squiggle (a state field) behaves as it does in the page
        state: EditorState.create({ extensions: [marksExtension, EditorState.readOnly.of(readOnly)] }),
        dispatch(spec: { changes?: { from: number; to: number; insert: string }; effects?: StateEffect<unknown> }) {
            if (spec.changes) {
                const { from, to, insert } = spec.changes
                ydoc.transact(() => {
                    text.delete(from, to - from)
                    text.insert(from, insert)
                })
            }
            if (spec.effects) fake.state = fake.state.update({ effects: spec.effects }).state
        },
    }
    const view = fake as unknown as EditorView
    registerBlock(blockId, view, text)
    return { text, view, ydoc }
}

function suggestion(edit: Proposal["edit"], over: Partial<Proposal> = {}): Proposal {
    return { label: "Suggested rewrite", edit, blocksAfter: [], show: { block: true }, why: "", ...over }
}

function showSuggestion(blockId: string, proposal: Proposal) {
    setSlot(blockId, "suggestion", { id: nextSlotId(), phase: "ready", kind: "rewrite", mock: true, proposal })
}

beforeEach(() => {
    vi.useFakeTimers()
})

afterEach(() => {
    setHost(null)
    resetSidekick()
    vi.useRealTimers()
})

describe("anchors", () => {
    it("follow their text when something is typed before it", () => {
        const { text } = makeBlock("b", "one half")
        const anchor = makeAnchor(text, 4, 8)
        text.insert(0, "so ")
        expect(resolveAnchor(text, anchor)).toEqual({ from: 7, to: 11 })
    })

    it("survive an edit elsewhere in the block", () => {
        const { text } = makeBlock("b", "a = 1\nb = 2\nc = 3")
        const anchor = makeAnchor(text, 6, 11)
        text.insert(text.length, "!") // after, in a later line
        expect(resolveAnchor(text, anchor)).toEqual({ from: 6, to: 11 })
        text.insert(2, "Z") // before
        expect(resolveAnchor(text, anchor)).toEqual({ from: 7, to: 12 })
    })

    it("do not survive an edit inside the text, or typing right at either edge, which changes what was asked", () => {
        const make = () => {
            const { text } = makeBlock("b", "a = 1\nb = 2\nc = 3")
            return { text, anchor: makeAnchor(text, 6, 11) }
        }
        let { text, anchor } = make()
        text.insert(8, "x") // inside
        expect(resolveAnchor(text, anchor)).toBeNull()
        ;({ text, anchor } = make())
        text.insert(11, "!") // at the end
        expect(resolveAnchor(text, anchor)).toBeNull()
        ;({ text, anchor } = make())
        text.insert(6, "!") // at the start
        expect(resolveAnchor(text, anchor)).toBeNull()
    })

    it("cover a whole block, so typing at its very end (or start) is an edit to it", () => {
        const { text } = makeBlock("b", "integral of x squared")
        const anchor = makeAnchor(text, 0, text.length)
        text.insert(text.length, "!")
        expect(resolveAnchor(text, anchor)).toBeNull()
    })

    it("are gone when the text they covered is deleted", () => {
        const { text } = makeBlock("b", "abc def")
        const anchor = makeAnchor(text, 4, 7)
        text.delete(4, 3)
        expect(resolveAnchor(text, anchor)).toBeNull()
    })
})

describe("suggestions", () => {
    it("are not in the text until accepted: showing one changes nothing", () => {
        const { text } = makeBlock("b", "one half")
        showSuggestion("b", suggestion({ anchor: makeAnchor(text, 0, 8), mode: "replace", insert: "$\\frac{1}{2}$" }))
        expect(text.toString()).toBe("one half")
        expect(hasPending("b")).toBe(true)
    })

    it("replace the anchored text when accepted, and the ghost is gone afterwards", () => {
        const { text } = makeBlock("b", "so one half here")
        showSuggestion("b", suggestion({ anchor: makeAnchor(text, 3, 11), mode: "replace", insert: "$\\frac{1}{2}$" }))
        expect(acceptPending("b")).toBe(true)
        expect(text.toString()).toBe("so $\\frac{1}{2}$ here")
        expect(getState().blocks.b).toBeUndefined()
    })

    it("go after the anchored text in 'after' mode, which is how a next step is added", () => {
        const { text } = makeBlock("b", "2x + 3 = 7\n2x = 6")
        showSuggestion("b", suggestion({ anchor: makeAnchor(text, 11, 17), mode: "after", insert: "\nx = 3" }))
        expect(acceptPending("b")).toBe(true)
        expect(text.toString()).toBe("2x + 3 = 7\n2x = 6\nx = 3")
    })

    it("show the block as it would read, using where the text is now", () => {
        const { text } = makeBlock("b", "so one half")
        const proposal = suggestion({ anchor: makeAnchor(text, 3, 11), mode: "replace", insert: "$x$" })
        text.insert(0, ">> ")
        expect(textAfterEdit("b", proposal)).toBe(">> so $x$")
    })

    it("are dropped, not applied, when the text they were made for has changed", () => {
        const { text } = makeBlock("b", "one half")
        const proposal = suggestion({ anchor: makeAnchor(text, 0, 8), mode: "replace", insert: "$\\frac{1}{2}$" })
        showSuggestion("b", proposal)
        text.insert(3, "!")
        expect(textAfterEdit("b", proposal)).toBeNull()
        revalidateBlock("b")
        expect(getState().blocks.b).toBeUndefined()
        expect(text.toString()).toBe("one! half")
    })

    it("refuse to accept when the text changed, and say so calmly instead of writing", () => {
        const { text } = makeBlock("b", "one half")
        showSuggestion("b", suggestion({ anchor: makeAnchor(text, 0, 8), mode: "replace", insert: "X" }))
        text.insert(3, "!")
        expect(acceptPending("b")).toBe(false)
        expect(text.toString()).toBe("one! half")
        expect(getState().blocks.b?.suggestion).toMatchObject({ phase: "notice" })
    })

    it("never write into a read-only block", () => {
        const { text } = makeBlock("b", "one half", true)
        showSuggestion("b", suggestion({ anchor: makeAnchor(text, 0, 8), mode: "replace", insert: "X" }))
        expect(acceptPending("b")).toBe(false)
        expect(text.toString()).toBe("one half")
    })

    it("add the blocks they bring through the page, only when accepted", () => {
        const { text } = makeBlock("b", "")
        const insertBlocksAfter = vi.fn()
        setHost({ blockIds: () => ["b"], insertBlocksAfter })
        showSuggestion("b", suggestion({ anchor: makeAnchor(text, 0, 0), mode: "replace", insert: "First." }, { blocksAfter: ["Second.", "Third."] }))
        expect(insertBlocksAfter).not.toHaveBeenCalled()
        acceptPending("b")
        expect(text.toString()).toBe("First.")
        expect(insertBlocksAfter).toHaveBeenCalledWith("b", ["Second.", "Third."])
    })
})

describe("a problem and its fix", () => {
    const found = (text: Y.Text, proposal: Proposal | null) => {
        const flag = makeAnchor(text, 6, 11)
        setSlot("b", "problem", {
            id: nextSlotId(),
            phase: "found",
            kind: "step",
            message: "This step doesn't follow from the line above.",
            detail: "",
            error: "",
            flag,
            region: null,
            prepared: proposal,
            proposal: proposal ? { phase: "ready", proposal } : { phase: "idle" },
        })
    }

    it("is only a line and a ghost: the fix is applied when accepted, and then the problem is gone", () => {
        const { text } = makeBlock("b", "a = 1\nb = 2")
        found(text, suggestion({ anchor: makeAnchor(text, 6, 11), mode: "replace", insert: "b = 1" }, { label: "Suggested fix" }))
        expect(text.toString()).toBe("a = 1\nb = 2")
        expect(acceptPending("b", "problem")).toBe(true)
        expect(text.toString()).toBe("a = 1\nb = 1")
        expect(getState().blocks.b).toBeUndefined()
    })

    it("goes when the flagged text is edited", () => {
        const { text } = makeBlock("b", "a = 1\nb = 2")
        found(text, null)
        text.insert(8, "x")
        revalidateBlock("b")
        expect(getState().blocks.b).toBeUndefined()
    })

    it("Accept on a fix takes the fix, not a next-step suggestion that is showing too", () => {
        const { text } = makeBlock("b", "a = 1\nb = 2")
        found(text, suggestion({ anchor: makeAnchor(text, 6, 11), mode: "replace", insert: "b = 1" }))
        showSuggestion("b", suggestion({ anchor: makeAnchor(text, 6, 11), mode: "after", insert: "\nb = 5" }))
        acceptPending("b", "problem")
        expect(text.toString()).toBe("a = 1\nb = 1")
        expect(getState().blocks.b?.suggestion).toBeDefined()
    })
})

describe("Esc", () => {
    it("dismisses the most recent thing first, one at a time, and reports when there is nothing", () => {
        const { text } = makeBlock("b", "a = 1")
        setSlot("b", "explain", { id: nextSlotId(), phase: "ready", eq: null, text: "It sets $a$ to $1$.", mock: true })
        showSuggestion("b", suggestion({ anchor: makeAnchor(text, 0, 5), mode: "replace", insert: "X" }))
        expect(dismissTop("b")).toBe(true)
        expect(getState().blocks.b?.suggestion).toBeUndefined()
        expect(getState().blocks.b?.explain).toBeDefined()
        expect(dismissTop("b")).toBe(true)
        expect(getState().blocks.b).toBeUndefined()
        expect(dismissTop("b")).toBe(false)
        expect(text.toString()).toBe("a = 1") // nothing was written
    })
})

describe("belonging to a block", () => {
    it("goes when the block is deleted, and only that block's results", () => {
        makeBlock("a", "x")
        makeBlock("b", "y")
        noteIn("a", "explain", { kind: "info", text: "a" })
        noteIn("b", "explain", { kind: "info", text: "b" })
        pruneBlocks(["b"])
        expect(Object.keys(getState().blocks)).toEqual(["b"])
    })

    it("goes when the block's editor is torn down", () => {
        const { view } = makeBlock("a", "x")
        noteIn("a", "explain", { kind: "info", text: "a" })
        unregisterBlock("a", view)
        expect(getState().blocks.a).toBeUndefined()
    })

    it("is private to this page: it lives only in this store, never in the shared text", () => {
        const { text } = makeBlock("a", "x")
        setSlot("a", "explain", { id: nextSlotId(), phase: "ready", eq: null, text: "private", mock: false })
        expect(text.toString()).toBe("x")
        expect(Y.encodeStateAsUpdate(text.doc as Y.Doc).length).toBe(Y.encodeStateAsUpdate(makeBlock("c", "x").ydoc).length)
    })
})

describe("quiet notes", () => {
    it("go by themselves after a while, but an answer waiting for a decision does not", () => {
        const { text } = makeBlock("b", "x")
        noteIn("b", "problem", { kind: "info", text: "Nothing to check." })
        showSuggestion("b", suggestion({ anchor: makeAnchor(text, 0, 1), mode: "replace", insert: "y" }))
        vi.advanceTimersByTime(60_000)
        expect(getState().blocks.b?.problem).toBeUndefined()
        expect(getState().blocks.b?.suggestion).toBeDefined()
    })

    it("a busy note stays for as long as the wait it names", () => {
        makeBlock("b", "x")
        noteIn("b", "suggestion", { kind: "busy", text: "Sidekick is busy.", retryAfter: 30 })
        vi.advanceTimersByTime(20_000)
        expect(getState().blocks.b?.suggestion).toBeDefined()
        vi.advanceTimersByTime(11_000)
        expect(getState().blocks.b?.suggestion).toBeUndefined()
    })

    it("dismissing a slot cancels its timer, so a later note is not cut short", () => {
        makeBlock("b", "x")
        noteIn("b", "explain", { kind: "info", text: "one" })
        clearSlot("b", "explain")
        noteIn("b", "explain", { kind: "info", text: "two" })
        vi.advanceTimersByTime(5_000)
        expect(getState().blocks.b?.explain).toBeDefined()
    })
})
