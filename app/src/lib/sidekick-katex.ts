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
