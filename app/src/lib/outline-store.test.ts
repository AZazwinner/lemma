import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as Y from "yjs"
import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkMath from "remark-math"
import remarkRehype from "remark-rehype"
import rehypeKatex from "rehype-katex"
import { rehypeEquationNumbers } from "./equation-numbers"
import { OUTLINE_DEBOUNCE_MS, OutlineStore, type TrackedBlock } from "./outline-store"

// The blocks of a document the way useYDoc holds them: an array of maps, each with an id and a Y.Text.
function makeDoc(sources: string[]) {
    const doc = new Y.Doc()
    const array = doc.getArray<Y.Map<unknown>>("blocks")
    const add = (id: string, source: string, at = array.length) => {
        const map = new Y.Map<unknown>()
        map.set("id", id)
        map.set("text", new Y.Text(source))
        array.insert(at, [map])
    }
    sources.forEach((source, i) => add(`b${i}`, source))
    const blocks = (): TrackedBlock[] => array.toArray().map((m) => ({ id: m.get("id") as string, text: m.get("text") as Y.Text }))
    const text = (id: string) => blocks().find((b) => b.id === id)!.text
    return { doc, array, add, blocks, text }
}

const labelled = (name: string) => `$$\na = b \\label{${name}}\n$$`

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe("OutlineStore", () => {
    it("has the outline as soon as it is given the blocks", () => {
        const { blocks } = makeDoc(["# One", "text", "## Two"])
        const store = new OutlineStore()
        store.setBlocks(blocks())
        expect(store.getSnapshot().headings.map((h) => h.text)).toEqual(["One", "Two"])
    })

    it("does not tell anyone when a paragraph is typed in, and leaves the outline object alone", () => {
        const { blocks, text } = makeDoc(["# One", "text"])
        const store = new OutlineStore()
        store.setBlocks(blocks())
        const before = store.getSnapshot()
        const listener = vi.fn()
        store.subscribe(listener)

        for (const ch of "typing in a paragraph") text("b1").insert(text("b1").length, ch)
        vi.advanceTimersByTime(OUTLINE_DEBOUNCE_MS + 10)

        expect(listener).not.toHaveBeenCalled()
        expect(store.getSnapshot()).toBe(before)
    })

    it("tells everyone once, after the typing pauses, when a heading is renamed", () => {
        const { blocks, text } = makeDoc(["# One", "text"])
        const store = new OutlineStore()
        store.setBlocks(blocks())
        const listener = vi.fn()
        store.subscribe(listener)

        text("b0").insert(5, " and a half")
        text("b0").insert(16, "!")
        expect(listener).not.toHaveBeenCalled() // debounced
        vi.advanceTimersByTime(OUTLINE_DEBOUNCE_MS + 10)

        expect(listener).toHaveBeenCalledTimes(1)
        expect(store.getSnapshot().headings[0].text).toBe("One and a half!")
    })

    it("applies what was typed straight away when asked to (the cursor leaving a block)", () => {
        const { blocks, text } = makeDoc(["# One"])
        const store = new OutlineStore()
        store.setBlocks(blocks())
        const listener = vi.fn()
        store.subscribe(listener)

        text("b0").insert(5, " changed")
        expect(listener).not.toHaveBeenCalled()
        store.flush()
        expect(listener).toHaveBeenCalledTimes(1)
        expect(store.getSnapshot().headings[0].text).toBe("One changed")
        vi.advanceTimersByTime(OUTLINE_DEBOUNCE_MS + 10)
        expect(listener).toHaveBeenCalledTimes(1) // and the pause that was waiting has nothing left to do
    })

    it("catches up at least once a second while someone keeps typing", () => {
        const { blocks, text } = makeDoc(["# One"])
        const store = new OutlineStore()
        store.setBlocks(blocks())
        const listener = vi.fn()
        store.subscribe(listener)

        for (let i = 0; i < 20; i++) {
            text("b0").insert(text("b0").length, "x")
            vi.advanceTimersByTime(100) // never pauses long enough to debounce
        }
        expect(listener).toHaveBeenCalled()
    })

    it("applies a block arriving, leaving or moving at once", () => {
        const { blocks, add, array } = makeDoc(["# One"])
        const store = new OutlineStore()
        store.setBlocks(blocks())
        const listener = vi.fn()
        store.subscribe(listener)

        add("new", "## Pasted", 0)
        store.setBlocks(blocks())
        expect(listener).toHaveBeenCalledTimes(1)
        expect(store.getSnapshot().headings.map((h) => h.text)).toEqual(["Pasted", "One"])

        array.delete(0, 1)
        store.setBlocks(blocks())
        expect(store.getSnapshot().headings.map((h) => h.text)).toEqual(["One"])
    })

    it("sees a collaborator's edit, which arrives as a remote update", () => {
        const mine = makeDoc(["# One"])
        const theirs = new Y.Doc()
        Y.applyUpdate(theirs, Y.encodeStateAsUpdate(mine.doc))
        const store = new OutlineStore()
        store.setBlocks(mine.blocks())

        const theirText = (theirs.getArray<Y.Map<unknown>>("blocks").get(0).get("text") as Y.Text)
        theirText.insert(5, " (edited by them)")
        Y.applyUpdate(mine.doc, Y.encodeStateAsUpdate(theirs, Y.encodeStateVector(mine.doc)))
        vi.advanceTimersByTime(OUTLINE_DEBOUNCE_MS + 10)

        expect(store.getSnapshot().headings[0].text).toBe("One (edited by them)")
    })

    it("stops listening when detached, and works again when given blocks again", () => {
        const { blocks, text } = makeDoc(["# One"])
        const store = new OutlineStore()
        store.setBlocks(blocks())
        store.detach()
        text("b0").insert(5, " changed")
        vi.advanceTimersByTime(OUTLINE_DEBOUNCE_MS + 10)
        expect(store.getSnapshot().headings[0].text).toBe("One") // it was not listening

        store.setBlocks(blocks())
        expect(store.getSnapshot().headings[0].text).toBe("One changed")
    })
})

describe("the equation numbers of the blocks below a block being edited", () => {
    // A block being edited shows its raw text in a CodeMirror view. Its typeset preview stays on the page, hidden, and is not
    // updated until the cursor leaves: it is frozen. The margin number of every block below must come from the document and
    // not from that stale preview, or one deleted equation would leave every number after it too high until the next click.
    // The page's own pipeline (remark-math, then KaTeX, then the numbers going onto the typeset displays: see LatexRenderer),
    // run without a browser. The result is the margin numbers it would draw, in order.
    type Node = { properties?: Record<string, unknown>; children?: Node[] }
    const typeset = (source: string, numbers: readonly (number | null)[] | undefined): number[] => {
        const processor = unified()
            .use(remarkParse)
            .use(remarkMath)
            .use(remarkRehype)
            .use(rehypeKatex)
            .use(rehypeEquationNumbers, { numbers: numbers ? [...numbers] : [] })
        const tree = processor.runSync(processor.parse(source)) as Node
        const drawn: number[] = []
        const walk = (node: Node) => {
            const n = node.properties?.dataEqnum
            if (typeof n === "string") drawn.push(Number(n))
            node.children?.forEach(walk)
        }
        walk(tree)
        return drawn
    }
    const margin = (drawn: number[]) => drawn

    it("do not shift, or stay behind, when the edited block loses an equation", () => {
        const { blocks, text } = makeDoc([`${labelled("first")}`, `${labelled("second")}`])
        const store = new OutlineStore()
        store.setBlocks(blocks())
        const frozenPreview = text("b0").toString() // what the focused block's hidden preview still shows

        const below = (): number[] => typeset(text("b1").toString(), store.getSnapshot().blockNumbers.get("b1"))
        expect(margin(below())).toEqual([2])

        // the writer deletes the first equation, with the cursor still in the block
        text("b0").delete(0, text("b0").length)
        vi.advanceTimersByTime(OUTLINE_DEBOUNCE_MS + 10)

        expect(store.getSnapshot().blockNumbers.get("b0")).toBeUndefined()
        expect(margin(below())).toEqual([1]) // the block below follows the document, not the frozen preview
        expect(store.getSnapshot().equations.map((e) => [e.blockId, e.number])).toEqual([["b1", 1]]) // and so does the panel
        expect(frozenPreview).toContain("a = b") // the frozen preview really was stale
    })

    it("do not shift when the edited block gains an equation", () => {
        const { blocks, text } = makeDoc(["intro", `${labelled("only")}`])
        const store = new OutlineStore()
        store.setBlocks(blocks())
        expect(margin(typeset(text("b1").toString(), store.getSnapshot().blockNumbers.get("b1")))).toEqual([1])

        text("b0").insert(text("b0").length, `\n${labelled("new")}`)
        vi.advanceTimersByTime(OUTLINE_DEBOUNCE_MS + 10)

        expect(margin(typeset(text("b1").toString(), store.getSnapshot().blockNumbers.get("b1")))).toEqual([2])
    })

    it("draw no number rather than a wrong one for a preview that disagrees with the numbers it is given", () => {
        // the frozen preview has an equation the document no longer has: the counts differ, so nothing is numbered
        expect(margin(typeset(labelled("old"), []))).toEqual([])
        expect(margin(typeset(labelled("old"), [7]))).toEqual([7])
    })
})
