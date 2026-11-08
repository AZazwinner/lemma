import { describe, expect, it } from "vitest"
import {
    analyzeEquation,
    citedNumbers,
    displayEquations,
    numberDocument,
    rehypeEquationNumbers,
    resolveReferences,
} from "./equation-numbers"

describe("displayEquations", () => {
    it("finds $$ on lines of its own and \\[ ... \\], with the LaTeX inside", () => {
        const doc = "text\n$$\nx^2\n$$\nmore\n\\[ y \\]\n"
        const found = displayEquations(doc)
        expect(found.map((eq) => eq.tex.trim())).toEqual(["x^2", "y"])
        expect(doc.slice(found[0].from, found[0].to)).toBe("$$\nx^2\n$$")
        expect(doc.slice(found[1].from, found[1].to)).toBe("\\[ y \\]")
    })

    it("does not see what the page does not draw as a display", () => {
        expect(displayEquations("$$x^2 + y^2 = z^2$$")).toEqual([]) // on one line it is drawn inline
        expect(displayEquations("```\n$$\nx\n$$\n```")).toEqual([]) // inside code
        expect(displayEquations("plain $x$ text")).toEqual([])
    })

    it("keeps an empty placeholder in the list, marked empty, because the page does draw it", () => {
        const found = displayEquations("$$\n\n$$\n$$\nx = 1\n$$")
        expect(found.map((eq) => eq.empty)).toEqual([true, false])
    })

    it("counts an equation that was never closed", () => {
        expect(displayEquations("$$\nx^2")).toHaveLength(1)
    })
})

describe("what counts as a real equation (and what never does)", () => {
    const candidate = (tex: string) => analyzeEquation(tex).candidate

    it("is a display with a relation symbol", () => {
        expect(candidate("N = p_1 p_2 \\cdots p_n + 1.")).toBe(true)
        expect(candidate("q \\mid p_1 p_2 \\cdots p_n.")).toBe(true)
        expect(candidate("x \\le y")).toBe(true)
        expect(candidate("q \\in \\{p_1, \\ldots, p_n\\}")).toBe(true)
        expect(candidate("f: A \\to B")).toBe(true)
        expect(candidate("a < b")).toBe(true)
        expect(candidate("\\begin{aligned} a &= 1 \\\\ b &= 2 \\end{aligned}")).toBe(true)
    })

    it("is not a statement with no relation symbol: a theorem or a bare expression", () => {
        expect(candidate("\\text{Theorem: There are infinitely many prime numbers.}")).toBe(false)
        expect(candidate("\\text{Hence the claim holds.}")).toBe(false)
        expect(candidate("\\int_0^1 x^2 \\, dx")).toBe(false) // \int is not \in
        expect(candidate("p_1 p_2 \\cdots p_n")).toBe(false)
        expect(candidate("")).toBe(false)
    })

    it("ignores the words inside \\text{...}: an = in a sentence does not make a text-only display an equation", () => {
        expect(candidate("\\text{Claim: } a = b")).toBe(true)
        expect(candidate("\\text{We have a = b and c < d.}")).toBe(false)
        expect(candidate("\\text{outer \\textbf{bold} still text = here}")).toBe(false)
    })

    it("is never numbered when boxed, even with a relation (a conclusion or highlighted result)", () => {
        expect(candidate("\\boxed{x = 1}")).toBe(false)
        expect(candidate("\\boxed{\\text{There are infinitely many prime numbers.}} \\qquad \\blacksquare")).toBe(false)
        expect(candidate("N = 5 \\boxed{N}")).toBe(false)
    })

    it("is never numbered with \\notag or \\nonumber", () => {
        expect(candidate("x = 1 \\notag")).toBe(false)
        expect(candidate("x = 1 \\nonumber")).toBe(false)
    })

    it("is never numbered in a starred environment", () => {
        expect(candidate("\\begin{equation*} x = 1 \\end{equation*}")).toBe(false)
        expect(candidate("\\begin{align*} a &= 1 \\\\ b &= 2 \\end{align*}")).toBe(false)
    })

    it("leaves an equation with its own \\tag, or in an environment KaTeX numbers itself, to KaTeX", () => {
        expect(candidate("x = 1 \\tag{A}")).toBe(false)
        expect(candidate("x = 1 \\tag*{A}")).toBe(false)
        expect(candidate("\\begin{equation} x = 1 \\end{equation}")).toBe(false)
        expect(candidate("\\begin{align} a &= 1 \\end{align}")).toBe(false)
    })

    it("reads \\label names, and a veto still wins over a label", () => {
        expect(analyzeEquation("x = 1 \\label{eq:one}")).toEqual({ candidate: true, labels: ["eq:one"] })
        expect(analyzeEquation("\\boxed{x = 1} \\label{eq:box}")).toEqual({ candidate: false, labels: ["eq:box"] })
    })
})

describe("citations in words", () => {
    it("reads 'equation (3)', 'equations (2) and (4)', 'Eq. 5'", () => {
        expect(citedNumbers("By equation (3) we get more.")).toEqual([3])
        expect(citedNumbers("Combine equations (2) and (4), (6).")).toEqual([2, 4, 6])
        expect(citedNumbers("As in Eq. 5, and eq. (7).")).toEqual([5, 7])
    })

    it("ignores numbers that are not cited as equations, and anything inside maths or code", () => {
        expect(citedNumbers("There are 3 cases (2 of them easy).")).toEqual([])
        expect(citedNumbers("$$\n\\text{equation (3)}\n$$")).toEqual([])
        expect(citedNumbers("Use `equation (3)` literally, and $equation (4)$.")).toEqual([])
    })
})

describe("numbering a document", () => {
    const display = (tex: string) => `$$\n${tex}\n$$`

    it("numbers nothing in a proof where nothing is labelled or cited (the model's boxed statements included)", () => {
        const proof = [
            display("\\boxed{\\text{Theorem: There are infinitely many prime numbers.}}"),
            "Proof. Suppose there are only finitely many primes. Define",
            display("N = p_1p_2\\cdots p_n+1."),
            "Consequently,",
            display("q\\mid p_1p_2\\cdots p_n."),
            display("q\\mid\\left(N-p_1p_2\\cdots p_n\\right)=1."),
            "Hence,",
            display("\\boxed{\\text{There are infinitely many prime numbers.}} \\qquad \\blacksquare"),
        ]
        expect(numberDocument(proof).shown.flat().filter((n) => n !== null)).toEqual([])
    })

    it("shows the number of an equation the author labelled, which is its position among the real equations", () => {
        const doc = [display("a = 1"), "text", display("b = 2 \\label{two}"), display("c = 3")]
        const { shown, labels } = numberDocument(doc)
        expect(shown).toEqual([[null], [], [2], [null]]) // the first and third take a number (1 and 3) but show none
        expect(labels).toEqual({ two: 2 })
    })

    it("does not count what is vetoed or empty, so it does not use up a number", () => {
        const doc = [display("\\boxed{a = 1}"), "$$\n\n$$", display("\\text{words}"), display("b = 2 \\label{b}")]
        const { shown, labels } = numberDocument(doc)
        expect(labels).toEqual({ b: 1 })
        expect(shown[3]).toEqual([1])
    })

    it("shows an equation the text cites by its number, and numbers keep counting past the ones not shown", () => {
        const doc = [display("a = 1"), display("b = 2"), display("c = 3"), "By equation (3) the claim follows."]
        expect(numberDocument(doc).shown).toEqual([[null], [null], [3], []])
        expect(numberDocument([...doc.slice(0, 3), "Compare equations (1) and (2)."]).shown).toEqual([[1], [2], [null], []])
    })

    it("ignores a citation of a number that no equation has", () => {
        expect(numberDocument([display("a = 1"), "See equation (9)."]).shown).toEqual([[null], []])
    })

    it("lets the first label win when a name is used twice", () => {
        const { labels } = numberDocument([display("a = 1 \\label{x}"), display("b = 2 \\label{x}")])
        expect(labels).toEqual({ x: 1 })
    })

    it("has a row for every block, empty for a block with no displays", () => {
        expect(numberDocument(["just text", display("a = 1 \\label{a}")]).shown).toEqual([[], [1]])
        expect(numberDocument([]).shown).toEqual([])
    })
})

describe("resolveReferences", () => {
    const labels = { one: 1, two: 2 }

    it("writes \\eqref as (n) and \\ref as n, and unknown names as ?", () => {
        expect(resolveReferences("see \\eqref{one} and \\ref{two}, but \\eqref{nope}", labels)).toBe("see (1) and 2, but (?)")
    })

    it("removes \\label{...}, which KaTeX cannot read", () => {
        expect(resolveReferences("$$\nx = 1 \\label{one}\n$$", labels)).toBe("$$\nx = 1 \n$$")
    })

    it("leaves code alone, and text with no references untouched", () => {
        expect(resolveReferences("write `\\eqref{one}` in code", labels)).toBe("write `\\eqref{one}` in code")
        expect(resolveReferences("```\n\\label{one}\n```", labels)).toBe("```\n\\label{one}\n```")
        expect(resolveReferences("nothing here", labels)).toBe("nothing here")
    })

    it("works inside maths too", () => {
        expect(resolveReferences("$x = \\eqref{one}$", labels)).toBe("$x = (1)$")
    })
})

describe("rehypeEquationNumbers", () => {
    const display = () => ({ type: "element", properties: { className: ["katex-display"] }, children: [] as never[] })
    const tree = (count: number) => ({ type: "root", children: Array.from({ length: count }, () => ({ type: "element", properties: {}, children: [display()] })) })
    const dataOf = (root: ReturnType<typeof tree>) => root.children.map((wrapper) => (wrapper.children[0].properties as Record<string, unknown>).dataEqnum)

    it("puts the number on the displays that have one, in order", () => {
        const root = tree(3)
        rehypeEquationNumbers({ numbers: [1, null, 3] })(root)
        expect(dataOf(root)).toEqual(["1", undefined, "3"])
    })

    it("numbers nothing when the block draws a different number of displays than was counted: no number beats a wrong one", () => {
        const root = tree(2)
        rehypeEquationNumbers({ numbers: [1, null, 3] })(root)
        expect(dataOf(root)).toEqual([undefined, undefined])
    })

    it("numbers nothing when no numbers are given, as for a snippet that is not part of the document", () => {
        const root = tree(1)
        rehypeEquationNumbers({})(root)
        expect(dataOf(root)).toEqual([undefined])
    })
})
