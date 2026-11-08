import { displayEquations, numberDocument } from "@/lib/equation-numbers"

// What the Outline panel (and the equation numbers in the page margin) are made of, derived from the document's text and
// nothing else: no DOM, no rendered preview. Both the margin and the panel read the one `Outline` this module returns, so
// they cannot disagree.
//
//   - Headings are the `#`..`######` lines of a block, outside code fences and displayed maths.
//   - Equation numbers come from `numberDocument` (lib/equation-numbers.ts), which is called here exactly once per outline.
//     That function is the only place that decides which equations are numbered and what the numbers are.
//
// Ids. A block's id is a UUID made when the block is created. It is the same on every collaborator's screen and does not
// change when the block is edited or moved. A heading is `<blockId>:h<n>` and an equation `<blockId>:e<n>`, where n counts
// within the block (almost always 0 for a heading). The id never contains the equation's number, because that changes when
// an equation is added above it.

export type OutlineBlock = { id: string; source: string }

export type Heading = {
    id: string
    blockId: string
    /** Which heading of the block this is (almost always 0). */
    ordinal: number
    /** 1 (`#`) to 6 (`######`). */
    level: number
    /** What follows the hashes. Markdown and `$maths$` are allowed; the panel typesets it. */
    text: string
}

export type OutlineEquation = {
    id: string
    blockId: string
    /** Which displayed equation of the block this is, counting the ones that take no number (that is what the page draws). */
    ordinal: number
    /** The number shown in the margin. */
    number: number
    /** The LaTeX inside the delimiters. */
    tex: string
}

export type Outline = {
    headings: readonly Heading[]
    /** Only the equations that show a number in the margin, in document order. */
    equations: readonly OutlineEquation[]
    /** For each block that has displayed equations: the number each one shows in the margin, or null for none. */
    blockNumbers: ReadonlyMap<string, readonly (number | null)[]>
    /** Label name to equation number, for `\eqref{name}`. */
    labels: Readonly<Record<string, number>>
}

export const EMPTY_OUTLINE: Outline = { headings: [], equations: [], blockNumbers: new Map(), labels: {} }

// ---- one block ---------------------------------------------------------------------------------------------------------

type ScannedBlock = {
    headings: { level: number; text: string }[]
    /** The LaTeX of each displayed equation of the block, in order. */
    tex: string[]
}

const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/

/** The ATX headings of a block, as the page draws them: not inside a code fence, and not inside a displayed equation. */
export function scanHeadings(source: string, equationRanges: readonly { from: number; to: number }[] = displayEquations(source)): { level: number; text: string }[] {
    const found: { level: number; text: string }[] = []
    let fence: { char: string; length: number } | null = null
    let offset = 0
    for (const line of source.split("\n")) {
        const lineFrom = offset
        offset += line.length + 1

        if (fence) {
            const close = new RegExp(`^ {0,3}${fence.char === "`" ? "`" : "~"}{${fence.length},}[ \\t]*$`)
            if (close.test(line)) fence = null
            continue
        }
        const open = FENCE_OPEN.exec(line)
        if (open) {
            fence = { char: open[1][0], length: open[1].length }
            continue
        }
        if (equationRanges.some((eq) => lineFrom >= eq.from && lineFrom < eq.to)) continue

        const match = ATX_HEADING.exec(line)
        if (!match) continue
        const text = (match[2] ?? "").trim()
        // `#` on its own, or `# #`, is an empty heading: the panel has nothing to show for it
        if (!text || /^#+$/.test(text)) continue
        found.push({ level: match[1].length, text })
    }
    return found
}

// Scanning is repeated for every block on every change, and most blocks did not change, so the result is kept by the
// block's text. The same trick `numberDocument` uses.
const scanCache = new Map<string, ScannedBlock>()

function scanBlock(source: string): ScannedBlock {
    const cached = scanCache.get(source)
    if (cached) return cached
    const equations = displayEquations(source)
    const scanned: ScannedBlock = { headings: scanHeadings(source, equations), tex: equations.map((eq) => eq.tex) }
    if (scanCache.size > 400) scanCache.clear()
    scanCache.set(source, scanned)
    return scanned
}

// ---- the whole document ------------------------------------------------------------------------------------------------

/**
 * The outline of a document, given its blocks in order.
 *
 * `previous` is the outline this one replaces. Headings and equations that did not change are returned as the very same
 * objects, so the panel only redraws the rows that did.
 */
export function deriveOutline(blocks: readonly OutlineBlock[], previous: Outline = EMPTY_OUTLINE): Outline {
    const scanned = blocks.map((block) => scanBlock(block.source))

    // The one place the numbering is computed. Which equations take a number, and which number, is decided there.
    const numbering = numberDocument(blocks.map((block) => block.source))

    const previousHeadings = new Map(previous.headings.map((h) => [h.id, h]))
    const previousEquations = new Map(previous.equations.map((e) => [e.id, e]))

    const headings: Heading[] = []
    const equations: OutlineEquation[] = []
    const blockNumbers = new Map<string, readonly (number | null)[]>()

    blocks.forEach((block, i) => {
        scanned[i].headings.forEach((found, n) => {
            const id = `${block.id}:h${n}`
            const before = previousHeadings.get(id)
            headings.push(before && before.level === found.level && before.text === found.text ? before : { id, blockId: block.id, ordinal: n, level: found.level, text: found.text })
        })

        const shown = numbering.shown[i] ?? []
        if (shown.length > 0) blockNumbers.set(block.id, shown)
        shown.forEach((number, ordinal) => {
            if (number === null) return
            const id = `${block.id}:e${ordinal}`
            const tex = scanned[i].tex[ordinal] ?? ""
            const before = previousEquations.get(id)
            equations.push(before && before.number === number && before.tex === tex ? before : { id, blockId: block.id, ordinal, number, tex })
        })
    })

    const next: Outline = { headings, equations, blockNumbers, labels: numbering.labels }
    return sameOutline(previous, next) ? previous : next
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
    return a.length === b.length && a.every((item, i) => item === b[i])
}

function sameNumbers(a: ReadonlyMap<string, readonly (number | null)[]>, b: ReadonlyMap<string, readonly (number | null)[]>): boolean {
    if (a.size !== b.size) return false
    for (const [id, numbers] of a) {
        const other = b.get(id)
        if (!other || !sameList(numbers, other)) return false
    }
    return true
}

function sameLabels(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): boolean {
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
}

/**
 * True if nothing the panel or the margin shows has changed. `deriveOutline` shares unchanged headings and equations between
 * outlines, so comparing them by identity is enough.
 */
export function sameOutline(a: Outline, b: Outline): boolean {
    return a === b || (sameList(a.headings, b.headings) && sameList(a.equations, b.equations) && sameNumbers(a.blockNumbers, b.blockNumbers) && sameLabels(a.labels, b.labels))
}

// ---- reading it ---------------------------------------------------------------------------------------------------------

export type OutlineRow = {
    heading: Heading
    /** How many headings this one is nested under (a `###` straight after a `#` is still depth 1). */
    depth: number
    hasChildren: boolean
    collapsed: boolean
    parentId: string | null
}

/** The rows the panel shows: every heading, except those inside a collapsed section. */
export function outlineRows(headings: readonly Heading[], collapsed: ReadonlySet<string>): OutlineRow[] {
    const rows: OutlineRow[] = []
    const ancestors: Heading[] = []
    headings.forEach((heading, i) => {
        while (ancestors.length > 0 && ancestors[ancestors.length - 1].level >= heading.level) ancestors.pop()
        const hidden = ancestors.some((a) => collapsed.has(a.id))
        if (!hidden) {
            rows.push({
                heading,
                depth: ancestors.length,
                hasChildren: (headings[i + 1]?.level ?? 0) > heading.level,
                collapsed: collapsed.has(heading.id),
                parentId: ancestors.length > 0 ? ancestors[ancestors.length - 1].id : null,
            })
        }
        ancestors.push(heading)
    })
    return rows
}

/** The heading whose section holds a block: the last one at or above it. Null before the first heading. */
export function headingAt(headings: readonly Heading[], blockIds: readonly string[], blockId: string | null): string | null {
    if (!blockId) return null
    const position = new Map(blockIds.map((id, index) => [id, index]))
    const at = position.get(blockId)
    if (at === undefined) return null
    let current: string | null = null
    for (const heading of headings) {
        const index = position.get(heading.blockId)
        if (index === undefined || index > at) break
        current = heading.id
    }
    return current
}
