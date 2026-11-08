import katex from "katex"
// The same extension the editor's renderer loads, so \ce{...} isn't reported as an error here when it renders there.
import "katex/contrib/mhchem"
import type { MathSpan } from "./sidekick-derivation"
import { findMathSpans } from "./sidekick-derivation"

export type LatexProblem = { span: MathSpan; message: string }

/** KaTeX's message for LaTeX that won't render, or null if it renders. Strict mode is off so only real errors count. */
export function renderError(latex: string, display = false): string | null {
    try {
        katex.renderToString(latex, { throwOnError: true, strict: "ignore", displayMode: display })
        return null
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // KaTeX prefixes "KaTeX parse error: "; the model doesn't need that.
        return message.replace(/^KaTeX parse error:\s*/i, "").slice(0, 300)
    }
}

/** KaTeX's message without the part that quotes the source ("at position 2: ..."), which does not fit on one line. */
export function shortRenderMessage(message: string): string {
    return message
        .replace(/ at (?:position \d+|end of input)[\s\S]*$/, "")
        .replace(/\s+/g, " ")
        .trim()
}

/** An equation that will not render: where it is in the block (just the LaTeX, not its delimiters) and why. */
export type RenderProblem = { from: number; to: number; message: string }

/**
 * Looks for an equation that fails to render, in the selection if there is one (a selection with no `$` in it is taken
 * to be LaTeX itself) and otherwise in the whole block. "none" means there are equations and they are fine, "no-math"
 * that there are none. Positions are offsets in `doc`.
 */
export function findRenderProblem(doc: string, selection: { from: number; to: number } | null): RenderProblem | "none" | "no-math" {
    if (selection) {
        const slice = doc.slice(selection.from, selection.to)
        const spans = findMathSpans(slice)
        if (spans.length === 0) {
            const message = renderError(slice)
            return message ? { from: selection.from, to: selection.to, message } : "none"
        }
        for (const span of spans) {
            const message = renderError(span.latex, span.display)
            if (message) return { from: selection.from + span.from, to: selection.from + span.to, message }
        }
        return "none"
    }
    const problem = firstLatexProblem(doc)
    if (problem === "none" || problem === "no-math") return problem
    return { from: problem.span.from, to: problem.span.to, message: problem.message }
}

/**
 * The first equation in a block that fails to render, or "none" if there are equations and they are fine, or "no-math"
 * if the block holds none. Runs entirely in the browser: nothing is sent anywhere, so it costs no quota.
 */
export function firstLatexProblem(doc: string): LatexProblem | "none" | "no-math" {
    const spans = findMathSpans(doc)
    if (spans.length === 0) return "no-math"
    for (const span of spans) {
        const message = renderError(span.latex, span.display)
        if (message) return { span, message }
    }
    return "none"
}
