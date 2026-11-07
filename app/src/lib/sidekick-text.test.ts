import { describe, expect, it } from "vitest"
import {
    explainSource,
    explanationText,
    isUnchanged,
    latexSource,
    mentionAt,
    noticeFor,
    previewOf,
    wrapLatex,
} from "./sidekick-text"

describe("latexSource", () => {
    it("uses the selection and keeps it inline", () => {
        const doc = "so integral of x squared is nice"
        const source = latexSource(doc, 3, 25)
        expect(source).toMatchObject({ from: 3, to: 25, text: "integral of x squared", block: false })
    })

    it("works with a backwards selection", () => {
        expect(latexSource("a b c", 3, 1)).toMatchObject({ from: 1, to: 3, text: "b" })
    })

    it("takes the whole block when nothing is selected", () => {
        expect(latexSource("  one half  ", 4, 4)).toMatchObject({ from: 0, to: 12, text: "one half", block: true })
    })

    it("takes an @sidekick line, not the whole block", () => {
        const doc = "Intro text\n@sidekick sum of 1 to n\nafter"
        const source = latexSource(doc, 20, 20)
        expect(source).toMatchObject({ text: "sum of 1 to n", block: true })
        expect(doc.slice(source!.from, source!.to)).toBe("@sidekick sum of 1 to n")
    })

    it("has nothing to convert for an empty block or a bare mention", () => {
        expect(latexSource("   ", 0, 0)).toBeNull()
        expect(latexSource("@sidekick ", 10, 10)).toBeNull()
        expect(latexSource("abc", 1, 1 + 0)).not.toBeNull()
    })
})

describe("mentionAt", () => {
    it("finds the line the cursor is on, case-insensitively", () => {
        expect(mentionAt("@Sidekick one third", 3)?.text).toBe("one third")
    })

    it("ignores lines that only contain the word", () => {
        expect(mentionAt("ask @sidekick later", 3)).toBeNull()
        expect(mentionAt("@sidekickish", 2)).toBeNull()
    })
})

describe("explainSource", () => {
    it("explains the selection, else the block without an @sidekick prefix", () => {
        expect(explainSource("x^2 + y^2", 0, 3)).toBe("x^2")
        expect(explainSource("@sidekick x^2", 0, 0)).toBe("x^2")
        expect(explainSource("  $$a$$  ", 2, 2)).toBe("$$a$$")
    })
})

describe("wrapLatex", () => {
    it("makes a display equation for a block and inline math for a selection", () => {
        expect(wrapLatex(" \\frac{1}{2} ", true)).toBe("$$\n\\frac{1}{2}\n$$")
        expect(wrapLatex("x^2", false)).toBe("$x^2$")
    })
})

describe("isUnchanged", () => {
    it("is true only while the requested text is still exactly there", () => {
        const source = latexSource("one half", 0, 0)!
        expect(isUnchanged("one half", source)).toBe(true)
        expect(isUnchanged("one half!", source)).toBe(false)
        expect(isUnchanged("x one half", source)).toBe(false)
    })
})

describe("previews and text", () => {
    it("shortens long LaTeX for the ghost", () => {
        expect(previewOf("a".repeat(200), 10)).toBe("aaaaaaaaa…")
        expect(previewOf("a \n  b")).toBe("a b")
    })

    it("formats an explanation for Insert below", () => {
        expect(explanationText("It squares x.", ["Take x.", "Multiply."])).toBe("It squares x.\n1. Take x.\n2. Multiply.")
    })
})

describe("noticeFor", () => {
    it("gives a calm busy message with the retry hint", () => {
        expect(noticeFor("busy", 20)).toMatchObject({ kind: "busy", text: "Sidekick is busy. Try again in 20s." })
        expect(noticeFor("busy", 600).text).toContain("10 min")
        expect(noticeFor("busy").text).toContain("30s")
    })

    it("says what went wrong when Google failed, using only the short reason", () => {
        expect(noticeFor("upstream", undefined, "HTTP 504").text).toContain("too long")
        expect(noticeFor("upstream", undefined, "HTTP 503").text).toContain("HTTP 503")
        expect(noticeFor("upstream", undefined, "HTTP 404").text).toContain("rejected")
        expect(noticeFor("upstream", undefined, "output limit").text).toContain("ran out of room")
        expect(noticeFor("upstream", undefined, "empty answer").text).toContain("no answer")
        expect(noticeFor("upstream", undefined, "something else entirely").text).toBe("The sidekick couldn't answer. Try again.")
        expect(noticeFor("upstream").text).toBe("The sidekick couldn't answer. Try again.")
    })

    it("never leaks details for other failures", () => {
        for (const kind of ["disabled", "signed-out", "network", "invalid", "upstream", "whatever"]) {
            expect(noticeFor(kind).kind).toBe("error")
        }
    })
})
