import { describe, expect, it } from "vitest"
import { deriveOutline, headingAt, outlineRows, sameOutline, scanHeadings, type Heading, type OutlineBlock } from "./doc-outline"
import { numberDocument } from "./equation-numbers"

const block = (id: string, source: string): OutlineBlock => ({ id, source })

// A labelled `a = b` is numbered whatever the numbering rule is, so these fixtures do not depend on it.
const labelled = (name: string) => `$$\na = b \\label{${name}}\n$$`

describe("scanHeadings", () => {
    it("reads levels 1 to 6 and drops the closing hashes", () => {
        const found = scanHeadings("# One\n## Two ##\n###### Six")
        expect(found).toEqual([
            { level: 1, text: "One" },
            { level: 2, text: "Two" },
            { level: 6, text: "Six" },
        ])
    })

    it("keeps maths and markdown in the text for the panel to typeset", () => {
        expect(scanHeadings("## The roots of $x^2 = 4$")[0].text).toBe("The roots of $x^2 = 4$")
    })

    it("is not fooled by lines that only look like headings", () => {
        expect(scanHeadings("#hashtag")).toEqual([])
        expect(scanHeadings("####### seven")).toEqual([])
        expect(scanHeadings("    # four spaces is code")).toEqual([])
        expect(scanHeadings("text # not at the start")).toEqual([])
        expect(scanHeadings("   # three spaces is fine")).toHaveLength(1)
    })

    it("skips a heading with nothing in it", () => {
        expect(scanHeadings("# ")).toEqual([])
        expect(scanHeadings("#")).toEqual([])
        expect(scanHeadings("## ##")).toEqual([])
    })

    it("ignores code fences and displayed maths", () => {
        expect(scanHeadings("```\n# not a heading\n```\n# real")).toEqual([{ level: 1, text: "real" }])
        expect(scanHeadings("~~~\n# no\n~~~")).toEqual([])
        expect(scanHeadings("$$\n# x\n$$\n# real")).toEqual([{ level: 1, text: "real" }])
        expect(scanHeadings("\\[\n# x\n\\]")).toEqual([])
    })

    it("finds a heading on any line of a block", () => {
        expect(scanHeadings("intro\n# Title\nbody\n## Sub")).toEqual([
            { level: 1, text: "Title" },
            { level: 2, text: "Sub" },
        ])
    })
})

describe("deriveOutline: ids", () => {
    it("names a heading after its block, and a second heading in the same block after its place in it", () => {
        const outline = deriveOutline([block("b1", "# A\n## B"), block("b2", "# C")])
        expect(outline.headings.map((h) => h.id)).toEqual(["b1:h0", "b1:h1", "b2:h0"])
    })

    it("keeps the id when the heading is edited or the blocks around it change", () => {
        const before = deriveOutline([block("b1", "# Title")])
        const edited = deriveOutline([block("b1", "# A better title")])
        const moved = deriveOutline([block("new", "intro"), block("other", "# Other"), block("b1", "# Title")])
        expect(edited.headings[0].id).toBe(before.headings[0].id)
        expect(moved.headings.find((h) => h.text === "Title")?.id).toBe("b1:h0")
    })

    it("does not put an equation's number in its id, because adding an equation above changes the number", () => {
        const alone = deriveOutline([block("b1", labelled("x"))])
        const below = deriveOutline([block("b0", labelled("w")), block("b1", labelled("x"))])
        expect(alone.equations[0].id).toBe("b1:e0")
        const same = below.equations.find((e) => e.blockId === "b1")
        expect(same?.id).toBe("b1:e0")
        expect(same?.number).not.toBe(alone.equations[0].number)
    })
})

describe("deriveOutline: staying put", () => {
    it("returns the very same outline when a paragraph is typed in", () => {
        const before = deriveOutline([block("b1", "# Title"), block("b2", "some words"), block("b3", labelled("x"))])
        const after = deriveOutline([block("b1", "# Title"), block("b2", "some more words, typed"), block("b3", labelled("x"))], before)
        expect(after).toBe(before)
    })

    it("returns a new outline, sharing the headings that did not change, when one heading is renamed", () => {
        const before = deriveOutline([block("b1", "# One"), block("b2", "# Two")])
        const after = deriveOutline([block("b1", "# One"), block("b2", "# Two, renamed")], before)
        expect(after).not.toBe(before)
        expect(after.headings[0]).toBe(before.headings[0])
        expect(after.headings[1]).not.toBe(before.headings[1])
    })

    it("sameOutline sees a changed equation number", () => {
        const a = deriveOutline([block("b1", labelled("x"))])
        const b = deriveOutline([block("b0", labelled("w")), block("b1", labelled("x"))])
        expect(sameOutline(a, b)).toBe(false)
    })
})

describe("deriveOutline: the equation numbers", () => {
    const sources = [labelled("one"), "a paragraph", "$$\nplain\n$$", `${labelled("two")}\nand ${labelled("three")}`]

    it("are exactly what numberDocument says, which is what the margin draws", () => {
        const outline = deriveOutline(sources.map((source, i) => block(`b${i}`, source)))
        const numbering = numberDocument(sources)
        sources.forEach((_, i) => {
            expect(outline.blockNumbers.get(`b${i}`) ?? []).toEqual(numbering.shown[i])
        })
        expect(outline.labels).toEqual(numbering.labels)
    })

    it("list one row per equation that shows a number, never one that shows none", () => {
        const outline = deriveOutline(sources.map((source, i) => block(`b${i}`, source)))
        const shown = numberDocument(sources).shown.flat().filter((n) => n !== null)
        expect(outline.equations.map((e) => e.number)).toEqual(shown)
        // the equation without a number is in the block's numbers as null and has no row
        expect(outline.blockNumbers.get("b2")?.every((n) => n === null)).toBe(true)
        expect(outline.equations.some((e) => e.blockId === "b2")).toBe(false)
    })

    it("point at the equation by its place in the block, counting the ones that show no number", () => {
        const outline = deriveOutline([block("b0", `$$\nplain\n$$\n\n${labelled("x")}`)])
        const row = outline.equations.find((e) => e.tex.includes("a = b"))
        expect(row?.ordinal).toBe(1)
        expect(row?.id).toBe("b0:e1")
        expect(row?.tex.replace(/\s+/g, " ").trim()).toBe("a = b \\label{x}")
    })
})

describe("outlineRows", () => {
    const h = (id: string, level: number): Heading => ({ id, blockId: id, ordinal: 0, level, text: id })
    const headings = [h("a", 1), h("b", 2), h("c", 3), h("d", 2), h("e", 1), h("f", 3)]

    it("nests by level and says which headings have children", () => {
        const rows = outlineRows(headings, new Set())
        expect(rows.map((r) => [r.heading.id, r.depth, r.hasChildren])).toEqual([
            ["a", 0, true],
            ["b", 1, true],
            ["c", 2, false],
            ["d", 1, false],
            ["e", 0, true],
            ["f", 1, false], // a ### straight under a #: one level in, no gap
        ])
        expect(rows.find((r) => r.heading.id === "c")?.parentId).toBe("b")
    })

    it("hides everything under a collapsed heading, down to the next heading of its level or above", () => {
        expect(outlineRows(headings, new Set(["a"])).map((r) => r.heading.id)).toEqual(["a", "e", "f"])
        expect(outlineRows(headings, new Set(["b"])).map((r) => r.heading.id)).toEqual(["a", "b", "d", "e", "f"])
    })

    it("keeps a nested heading's own collapsed state while its parent is collapsed", () => {
        const rows = outlineRows(headings, new Set(["a", "b"]))
        expect(rows.map((r) => r.heading.id)).toEqual(["a", "e", "f"])
        expect(outlineRows(headings, new Set(["b"])).find((r) => r.heading.id === "b")?.collapsed).toBe(true)
    })
})

describe("headingAt", () => {
    const headings: Heading[] = [
        { id: "b1:h0", blockId: "b1", ordinal: 0, level: 1, text: "One" },
        { id: "b3:h0", blockId: "b3", ordinal: 0, level: 1, text: "Two" },
    ]
    const blockIds = ["b0", "b1", "b2", "b3", "b4"]

    it("is the last heading at or above the block", () => {
        expect(headingAt(headings, blockIds, "b0")).toBeNull()
        expect(headingAt(headings, blockIds, "b1")).toBe("b1:h0")
        expect(headingAt(headings, blockIds, "b2")).toBe("b1:h0")
        expect(headingAt(headings, blockIds, "b4")).toBe("b3:h0")
    })

    it("is null for a block that is gone, or no block", () => {
        expect(headingAt(headings, blockIds, "zzz")).toBeNull()
        expect(headingAt(headings, blockIds, null)).toBeNull()
    })
})
