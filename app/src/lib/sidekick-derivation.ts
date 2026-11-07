// Pure helpers for the maths features: finding equations in a block, and reading a derivation (one step per line).
// No editor and no network, so they can be unit-tested.

export const MAX_STEPS = 20
export const MAX_STEP_CHARS = 500

export type MathSpan = {
    /** The LaTeX inside the delimiters. `from`/`to` cover just that. */
    from: number
    to: number
    latex: string
    display: boolean
}

/** Replaces fenced code with spaces of the same length, so positions still line up but nothing inside is read as maths. */
function maskCode(doc: string): string {
    return doc.replace(/```[\s\S]*?(```|$)/g, (block) => " ".repeat(block.length))
}

/** The `$$ ... $$` and `$ ... $` equations in a block, outside code fences. */
export function findMathSpans(doc: string): MathSpan[] {
    const masked = maskCode(doc)
    const spans: MathSpan[] = []
    const pattern = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g
    let match: RegExpExecArray | null
    while ((match = pattern.exec(masked)) !== null) {
        const display = match[1] !== undefined
        const inner = display ? match[1] : match[2]
        const from = match.index + (display ? 2 : 1)
        spans.push({ from, to: from + inner.length, latex: doc.slice(from, from + inner.length), display })
    }
    return spans
}

export type Step = { text: string; from: number; to: number }

/** Lines that only open or close a maths environment carry no step. */
const SCAFFOLDING = /^(\$\$|\\\[|\\\]|\\begin\{[^}]*\}|\\end\{[^}]*\}|```.*)$/

/**
 * The steps of a derivation: one per non-empty line of the selection, or of the whole block if nothing is selected.
 * Lines that only hold `$$`, `\[`, `\begin{...}` and the like are skipped, and a step written as `$...$` loses its dollar
 * signs. Returns null if it is empty or too long to send.
 */
export function derivationSteps(
    doc: string,
    selFrom: number,
    selTo: number
): { steps: Step[] } | { error: "empty" | "too-many" | "too-long" } {
    const regionFrom = selFrom === selTo ? 0 : Math.min(selFrom, selTo)
    const regionTo = selFrom === selTo ? doc.length : Math.max(selFrom, selTo)

    const steps: Step[] = []
    let inFence = false
    let offset = 0
    for (const line of doc.split("\n")) {
        const lineFrom = offset
        offset += line.length + 1
        if (/^\s*```/.test(line)) {
            inFence = !inFence
            continue
        }
        if (inFence || lineFrom + line.length < regionFrom || lineFrom > regionTo) continue

        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith("#") || SCAFFOLDING.test(trimmed)) continue

        const lead = line.length - line.trimStart().length
        let from = lineFrom + lead
        let text = trimmed
        let to = from + text.length

        // "$2x = 4$" or "$$2x = 4$$" on one line: the step is what is inside
        const wrapped = text.match(/^(\${1,2})(.+?)\1$/)
        if (wrapped) {
            from += wrapped[1].length
            text = wrapped[2]
            to = from + text.length
        }
        // "2x = 4 \\" at the end of a line of an aligned block
        const withoutBreak = text.replace(/\s*\\\\\s*$/, "")
        if (withoutBreak !== text) {
            to -= text.length - withoutBreak.length
            text = withoutBreak
        }
        text = text.trim()
        if (!text) continue
        if (text.length > MAX_STEP_CHARS) return { error: "too-long" }
        steps.push({ text, from, to })
    }

    if (steps.length === 0) return { error: "empty" }
    if (steps.length > MAX_STEPS) return { error: "too-many" }
    return { steps }
}

export function derivationErrorText(error: "empty" | "too-many" | "too-long"): string {
    switch (error) {
        case "empty":
            return "Write the steps of your work first, one per line (or select them)."
        case "too-many":
            return `That is more than ${MAX_STEPS} steps. Select a shorter part.`
        default:
            return "One of those lines is too long. Split it into smaller steps."
    }
}
