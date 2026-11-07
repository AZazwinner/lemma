import { describe, expect, it } from "vitest"
import { derivationSteps, findMathSpans } from "./sidekick-derivation"
import { firstLatexProblem, renderError } from "./sidekick-katex"

describe("findMathSpans", () => {
    it("finds display and inline equations with the range of the LaTeX inside", () => {
        const doc = "Solve $x^2$ then\n$$\n\\frac{1}{2}\n$$"
        const spans = findMathSpans(doc)
        expect(spans.map((s) => s.latex)).toEqual(["x^2", "\n\\frac{1}{2}\n"])
        expect(spans.map((s) => s.display)).toEqual([false, true])
        for (const span of spans) expect(doc.slice(span.from, span.to)).toBe(span.latex)
    })

    it("ignores dollar signs inside code fences", () => {
        expect(findMathSpans("```\n$x$\n```\nand $y$").map((s) => s.latex)).toEqual(["y"])
    })

    it("finds nothing in plain text", () => {
        expect(findMathSpans("no maths here")).toEqual([])
    })
})

describe("derivationSteps", () => {
    const steps = (doc: string, from = 0, to = 0) => {
        const result = derivationSteps(doc, from, to)
        if ("error" in result) throw new Error(result.error)
        return result.steps
    }

    it("takes one step per line and skips the $$ lines", () => {
        const doc = "$$\n2x + 3 = 7\n2x = 4\nx = 2\n$$"
        const found = steps(doc)
        expect(found.map((s) => s.text)).toEqual(["2x + 3 = 7", "2x = 4", "x = 2"])
        for (const step of found) expect(doc.slice(step.from, step.to)).toBe(step.text)
    })

    it("strips dollar signs and line breaks around a step, keeping its range exact", () => {
        const doc = "$2x = 4$\n$$x = 2$$\n3y = 9 \\\\"
        const found = steps(doc)
        expect(found.map((s) => s.text)).toEqual(["2x = 4", "x = 2", "3y = 9"])
        for (const step of found) expect(doc.slice(step.from, step.to)).toBe(step.text)
    })

    it("uses only the selected lines when there is a selection", () => {
        const doc = "a = 1\nb = 2\nc = 3"
        expect(steps(doc, 6, 11).map((s) => s.text)).toEqual(["b = 2"])
    })

    it("skips headings and code fences", () => {
        expect(steps("# Problem\n```\nnot a step\n```\nx = 1").map((s) => s.text)).toEqual(["x = 1"])
    })

    it("reports an empty block, too many steps and a line that is too long", () => {
        expect(derivationSteps("  \n$$\n$$", 0, 0)).toEqual({ error: "empty" })
        expect(derivationSteps(Array.from({ length: 21 }, (_, i) => `x = ${i}`).join("\n"), 0, 0)).toEqual({ error: "too-many" })
        expect(derivationSteps("x".repeat(501), 0, 0)).toEqual({ error: "too-long" })
    })
})

describe("finding LaTeX that won't render (real KaTeX, no network)", () => {
    it("reports KaTeX's message for broken LaTeX and null for good LaTeX", () => {
        expect(renderError("\\frac{1}{2}")).toBeNull()
        const message = renderError("\\frac{1}{2")
        expect(message).toBeTruthy()
        expect(message).not.toMatch(/^KaTeX parse error/)
    })

    it("accepts chemistry the editor can render", () => {
        expect(renderError("\\ce{H2O}")).toBeNull()
    })

    it("finds the first broken equation in a block", () => {
        const doc = "fine $x^2$ and broken $\\frac{1}{2$ and $y$"
        const problem = firstLatexProblem(doc)
        expect(problem).toMatchObject({ span: { latex: "\\frac{1}{2" } })
    })

    it("says when everything renders and when there is no maths", () => {
        expect(firstLatexProblem("$x$ and $$y$$")).toBe("none")
        expect(firstLatexProblem("plain words")).toBe("no-math")
    })
})
