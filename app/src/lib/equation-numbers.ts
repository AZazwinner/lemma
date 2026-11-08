import { mapOutsideCode } from "@/components/latex-bracket-delimiters"

// Which displayed equations get a number in the page margin, and which number. Not every display is an equation worth
// numbering: a boxed theorem statement or a line of prose between two equations should not take one. The rules (the idea is
// LaTeX's `showonlyrefs`):
//
//   A display is a "real equation" if it has a relation symbol (=, <, \le, \mid, \in, ...) outside any \text{...}.
//   It is never numbered if it is \boxed, has \notag or \nonumber, is in a starred environment (equation*, align*), has a
//   \tag (KaTeX draws the tag itself), or is in an environment KaTeX numbers by itself (equation, align, ...).
//   Otherwise it counts: its number is its position among the real equations of the whole document, shown or not.
//   The number is shown only if the author asked for it with \label{...}, or the text cites it: \eqref{name} /
//   \ref{name}, or "by equation (3)".

/** A displayed equation in a block: `$$` on lines of its own, or `\[ ... \]`. Positions are offsets in the block's text. */
export type DisplayEquation = { from: number; to: number; /** The LaTeX inside the delimiters. */ tex: string; empty: boolean }

/**
 * The displayed equations of a block, in order, as the page draws them: `$$` on a line of its own, and `\[ ... \]`.
 * A `$$x$$` inside a line is drawn inline, so it is not one. An empty `$$ $$` placeholder is one (drawn, but empty).
 */
export function displayEquations(doc: string): DisplayEquation[] {
    const found: DisplayEquation[] = []

    // fenced code is not maths
    const masked = doc.replace(/```[\s\S]*?(```|$)/g, (block) => " ".repeat(block.length))

    let open: { from: number; bodyFrom: number } | null = null
    let offset = 0
    for (const line of masked.split("\n")) {
        const lineFrom = offset
        offset += line.length + 1
        if (!open) {
            if (/^ {0,3}\$\$[^$]*$/.test(line)) open = { from: lineFrom, bodyFrom: lineFrom + line.indexOf("$$") + 2 }
        } else if (/^ {0,3}\$\$+\s*$/.test(line)) {
            const tex = doc.slice(open.bodyFrom, lineFrom)
            found.push({ from: open.from, to: lineFrom + line.length, tex, empty: !tex.trim() })
            open = null
        }
    }
    if (open) {
        const tex = doc.slice(open.bodyFrom)
        found.push({ from: open.from, to: doc.length, tex, empty: !tex.trim() })
    }

    for (const match of masked.matchAll(/\\\[([\s\S]+?)\\\]/g)) {
        const from = match.index ?? 0
        if (!found.some((eq) => from >= eq.from && from < eq.to)) {
            found.push({ from, to: from + match[0].length, tex: doc.slice(from + 2, from + match[0].length - 2), empty: !match[1].trim() })
        }
    }

    return found.sort((a, b) => a.from - b.from)
}

// ---- reading one equation ---------------------------------------------------------------------------------------------

// Relation symbols: what makes a display an equation (a statement) rather than a title or a sentence.
const RELATION =
    /[=<>]|\\(?:le|leq|ge|geq|ne|neq|approx|equiv|sim|simeq|cong|propto|asymp|doteq|in|notin|ni|subset|subseteq|supset|supseteq|mid|nmid|parallel|perp|to|rightarrow|leftarrow|leftrightarrow|longrightarrow|Rightarrow|Leftarrow|Leftrightarrow|implies|impliedby|iff|mapsto|ll|gg|prec|succ|preceq|succeq|vdash|models)(?![A-Za-z])/

/** Environments KaTeX numbers by itself, so the page must not add a second number. */
const KATEX_NUMBERED = /\\begin\{(?:equation|align|alignat|gather|flalign|eqnarray|multline)\}/

const TEXT_COMMANDS = /\\(?:text|textbf|textit|textrm|textsf|texttt|mbox|hbox)\s*\{/g

/** The LaTeX without the content of `\text{...}` (and friends), so words in a statement are not mistaken for symbols. */
function withoutText(tex: string): string {
    let result = tex
    for (;;) {
        TEXT_COMMANDS.lastIndex = 0
        const match = TEXT_COMMANDS.exec(result)
        if (!match) return result
        let depth = 1
        let end = match.index + match[0].length
        while (end < result.length && depth > 0) {
            if (result[end] === "{") depth++
            else if (result[end] === "}") depth--
            end++
        }
        result = result.slice(0, match.index) + " " + result.slice(end)
    }
}

export type EquationInfo = {
    /** A real equation that nothing vetoes: it takes a number (shown or not). */
    candidate: boolean
    /** Names from `\label{...}`: the author asked for a number. */
    labels: string[]
}

export function analyzeEquation(tex: string): EquationInfo {
    const labels = [...tex.matchAll(/\\label\s*\{([^{}]*)\}/g)].map((m) => m[1].trim()).filter(Boolean)
    const body = tex.replace(/\\label\s*\{[^{}]*\}/g, "")
    const real = body.trim() !== "" && RELATION.test(withoutText(body))
    const vetoed =
        /\\boxed\b/.test(body) ||
        /\\(?:notag|nonumber)\b/.test(body) ||
        /\\begin\{[A-Za-z]+\*\}/.test(body) ||
        /\\tag\*?\s*\{/.test(body) ||
        KATEX_NUMBERED.test(body)
    return { candidate: real && !vetoed, labels }
}

// ---- the whole document -----------------------------------------------------------------------------------------------

/** Text with code and maths blanked out, so only prose is searched for citations. */
function prose(content: string): string {
    return content
        .replace(/```[\s\S]*?(?:```|$)|`[^`\n]*`/g, " ")
        .replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g, " ")
}

/** The equation numbers the text cites in words ("equation (3)", "equations (2) and (4)", "Eq. 5"), each once, in order. */
export function citedNumbers(content: string): number[] {
    const text = prose(content)
    const cited = new Set<number>()
    for (const match of text.matchAll(/\b(?:equations?|eqs?\.?)\s*((?:\(\s*\d+\s*\)\s*(?:,|and|&|or)?\s*)+)/gi)) {
        for (const n of match[1].matchAll(/\d+/g)) cited.add(Number(n[0]))
    }
    for (const match of text.matchAll(/\b(?:equation|eq\.?)\s+(\d+)\b/gi)) cited.add(Number(match[1]))
    return [...cited].sort((a, b) => a - b)
}

export type EquationNumbering = {
    /** For each block, for each of its displayed equations in order: the number shown in the margin, or null for none. */
    shown: (number | null)[][]
    /** Label name to equation number, for `\eqref{name}`. */
    labels: Record<string, number>
}

const scanCache = new Map<string, (EquationInfo & { empty: boolean })[]>()

function scan(content: string): (EquationInfo & { empty: boolean })[] {
    const cached = scanCache.get(content)
    if (cached) return cached
    const scanned = displayEquations(content).map((eq) => ({ ...analyzeEquation(eq.tex), empty: eq.empty }))
    if (scanCache.size > 400) scanCache.clear()
    scanCache.set(content, scanned)
    return scanned
}

/** Numbers a whole document, given each block's text in order. */
export function numberDocument(blocks: string[]): EquationNumbering {
    const scanned = blocks.map(scan)
    const cited = new Set(blocks.flatMap(citedNumbers))
    const labels: Record<string, number> = {}
    let position = 0
    const shown = scanned.map((equations) =>
        equations.map((eq) => {
            if (!eq.candidate || eq.empty) return null
            position++
            for (const name of eq.labels) if (!(name in labels)) labels[name] = position
            return eq.labels.length > 0 || cited.has(position) ? position : null
        })
    )
    return { shown, labels }
}

/**
 * Removes `\label{...}` (KaTeX can't read it) and writes `\eqref{name}` as "(3)" and `\ref{name}` as "3", using the
 * numbers of the labelled equations. A name that matches no numbered equation becomes "?". Code is left alone.
 */
export function resolveReferences(content: string, labels: Record<string, number>): string {
    if (!content.includes("\\label") && !content.includes("\\eqref") && !content.includes("\\ref")) return content
    return mapOutsideCode(content, (segment) =>
        segment
            .replace(/\\label\s*\{[^{}]*\}/g, "")
            .replace(/\\eqref\s*\{([^{}]*)\}/g, (_m, name: string) => `(${labels[name.trim()] ?? "?"})`)
            .replace(/\\ref\s*\{([^{}]*)\}/g, (_m, name: string) => String(labels[name.trim()] ?? "?"))
    )
}

// ---- drawing it ---------------------------------------------------------------------------------------------------------

type HastNode = { type: string; properties?: Record<string, unknown>; children?: HastNode[] }

function classesOf(node: HastNode): string[] {
    const value = node.properties?.className
    return Array.isArray(value) ? value.map(String) : typeof value === "string" ? value.split(/\s+/) : []
}

/**
 * A rehype plugin, to run after rehype-katex: puts `data-eqnum="3"` on each typeset display that has a number, which the page's
 * stylesheet draws in the margin. `numbers` is one entry per display of the block, in order (see numberDocument). If the
 * block draws a different number of displays than the numbering counted, nothing is numbered: no number beats a wrong one.
 */
export function rehypeEquationNumbers(options: { numbers?: (number | null)[] }) {
    return (tree: HastNode) => {
        const displays: HastNode[] = []
        const walk = (node: HastNode) => {
            if (node.type === "element" && classesOf(node).includes("katex-display")) displays.push(node)
            node.children?.forEach(walk)
        }
        walk(tree)
        const { numbers } = options
        if (!numbers || numbers.length !== displays.length) return
        displays.forEach((node, i) => {
            const n = numbers[i]
            if (n !== null && n !== undefined) node.properties = { ...node.properties, dataEqnum: String(n) }
        })
    }
}
