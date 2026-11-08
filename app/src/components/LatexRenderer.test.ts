import type { ReactElement, ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import { describe, expect, it } from "vitest"
import LatexRenderer from "./LatexRenderer"
import { numberDocument } from "@/lib/equation-numbers"

// The real renderer, with the numbering of lib/equation-numbers.ts applied to it: the number of displays the scanner counts
// must be the number the page draws, or numbers would land on the wrong equation. react-markdown is a plain function that
// returns React elements, so it is called directly and the elements are read (no react-dom needed).

type Props = Record<string, unknown> & { children?: ReactNode }

function elementsOf(content: string, equations?: (number | null)[], labels?: Record<string, number>): ReactElement<Props>[] {
    const wrapper = LatexRenderer({ content, equations, labels }) as ReactElement<{ children: ReactElement<Props> }>
    const root = ReactMarkdown(wrapper.props.children.props as never) as ReactElement<Props>
    const found: ReactElement<Props>[] = []
    const walk = (node: ReactNode) => {
        if (Array.isArray(node)) return node.forEach(walk)
        if (node && typeof node === "object" && "props" in node) {
            found.push(node as ReactElement<Props>)
            walk((node as ReactElement<Props>).props.children)
        }
    }
    walk(root)
    return found
}

const displays = (elements: ReactElement<Props>[]) => elements.filter((el) => String(el.props.className ?? "").split(" ").includes("katex-display"))
const eqnums = (elements: ReactElement<Props>[]) => displays(elements).flatMap((el) => (el.props["data-eqnum"] ? [String(el.props["data-eqnum"])] : []))
const text = (node: ReactNode): string =>
    Array.isArray(node) ? node.map(text).join("") : typeof node === "string" ? node : node && typeof node === "object" && "props" in node ? text((node as ReactElement<Props>).props.children) : ""

describe("LatexRenderer with equation numbers", () => {
    it("draws no numbers unless it is given some", () => {
        const found = elementsOf("$$\na = b\n$$")
        expect(displays(found)).toHaveLength(1)
        expect(eqnums(found)).toEqual([])
    })

    it("puts a number on the display it is meant for", () => {
        const content = "$$\na = b\n$$\n\ntext\n\n$$\nc = d\n$$"
        expect(eqnums(elementsOf(content, [null, 2]))).toEqual(["2"])
        expect(eqnums(elementsOf(content, [1, null]))).toEqual(["1"])
    })

    it("counts the same displays as the scanner does, including the ones written with \\[ ... \\] (as a model writes a proof)", () => {
        const content = [
            "\\[\n\\boxed{\\text{Theorem: There are infinitely many prime numbers.}}\n\\]",
            "Proof. Suppose \\(p_1, \\ldots, p_n\\) are all the primes. Define",
            "\\[\nN = p_1 p_2 \\cdots p_n + 1. \\label{n}\n\\]",
            "Consequently,",
            "\\[\nq \\mid p_1 p_2 \\cdots p_n.\n\\]",
            "$$\n\n$$",
            "$$x^2 + y^2 = z^2$$", // on one line: drawn inline, not a display
        ].join("\n")
        const { shown, labels } = numberDocument([content])
        // the scanner saw four displays (boxed, labelled, unlabelled, empty), and the page draws exactly those four
        expect(shown[0]).toHaveLength(4)
        expect(displays(elementsOf(content, shown[0], labels))).toHaveLength(4)
        // only the labelled equation shows a number: the boxed statement and the unlabelled one do not
        expect(shown[0]).toEqual([null, 1, null, null])
        expect(eqnums(elementsOf(content, shown[0], labels))).toEqual(["1"])
    })

    it("writes \\eqref and \\ref as numbers, and removes \\label so KaTeX is not asked to read it", () => {
        const found = elementsOf("See \\eqref{a} and \\ref{a}.\n\n$$\nx = 1 \\label{a}\n$$", [1], { a: 1 })
        expect(found.map((el) => text(el.props.children)).join(" ")).toContain("See (1) and 1.")
        expect(found.some((el) => String(el.props.className ?? "").includes("katex-error"))).toBe(false)
        expect(eqnums(found)).toEqual(["1"])
    })

    it("numbers nothing when the displays drawn are not the displays counted", () => {
        expect(eqnums(elementsOf("$$\na = b\n$$", [1, 2]))).toEqual([])
    })
})
