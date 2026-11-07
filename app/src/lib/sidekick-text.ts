// Pure text helpers for the sidekick: no editor, no network, so they can be unit-tested.

export const MENTION = "@sidekick"
export const MAX_TEXT_CHARS = 2000
export const MAX_LATEX_CHARS = 4000

export type Source = {
    from: number
    to: number
    text: string
    /** The document text in [from, to) when the request was made. */
    raw: string
    /** True when the whole line or block is replaced (a display equation), false for a selection inside text. */
    block: boolean
}

function lineBounds(doc: string, pos: number): { from: number; to: number } {
    const from = doc.lastIndexOf("\n", pos - 1) + 1
    const nl = doc.indexOf("\n", pos)
    return { from, to: nl === -1 ? doc.length : nl }
}

/** The "@sidekick ..." line the cursor is on, if any. */
export function mentionAt(doc: string, pos: number): Source | null {
    const { from, to } = lineBounds(doc, pos)
    const line = doc.slice(from, to)
    const match = line.match(/^\s*@sidekick\b[ \t]*(.*)$/i)
    if (!match) return null
    return { from, to, text: match[1].trim(), raw: line, block: true }
}

/** What to turn into LaTeX: the selection, else an "@sidekick ..." line, else the whole block. */
export function latexSource(doc: string, selFrom: number, selTo: number): Source | null {
    if (selFrom !== selTo) {
        const from = Math.min(selFrom, selTo)
        const to = Math.max(selFrom, selTo)
        const text = doc.slice(from, to).trim()
        return text ? { from, to, text, raw: doc.slice(from, to), block: false } : null
    }
    const mention = mentionAt(doc, selFrom)
    if (mention) return mention.text ? mention : null
    const text = doc.trim()
    return text ? { from: 0, to: doc.length, text, raw: doc, block: true } : null
}

/** What to explain: the selection, else the whole block, with any "@sidekick" prefix and math delimiters removed. */
export function explainSource(doc: string, selFrom: number, selTo: number): string {
    const raw = selFrom !== selTo ? doc.slice(Math.min(selFrom, selTo), Math.max(selFrom, selTo)) : doc
    return raw
        .replace(/^\s*@sidekick\b[ \t]*/i, "")
        .trim()
}

/** What goes into the document when a suggestion is accepted. */
export function wrapLatex(latex: string, block: boolean): string {
    const body = latex.trim()
    return block ? `$$\n${body}\n$$` : `$${body}$`
}

/** The explanation as plain text for "Insert below". */
export function explanationText(summary: string, steps: string[]): string {
    const lines = [summary, ...steps.map((s, i) => `${i + 1}. ${s}`)].filter(Boolean)
    return lines.join("\n")
}

/** True if the text the request was made for is still exactly where it was. If it moved or changed, the answer is dropped. */
export function isUnchanged(doc: string, source: Source): boolean {
    if (doc.slice(source.from, source.to) !== source.raw) return false
    // A whole line or block must still end where it did: something typed at its end changes what was asked.
    return !source.block || source.to === doc.length || doc.charAt(source.to) === "\n"
}

/** A short line for the ghost preview. */
export function previewOf(latex: string, max = 90): string {
    const flat = latex.replace(/\s+/g, " ").trim()
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

export type Notice = { kind: "busy" | "error" | "info"; text: string; retryAfter?: number }

export function noticeFor(kind: string, retryAfter?: number): Notice {
    switch (kind) {
        case "busy": {
            const wait = retryAfter && retryAfter > 0 ? retryAfter : 30
            const when = wait >= 90 ? `in about ${Math.ceil(wait / 60)} min` : `in ${wait}s`
            return { kind: "busy", text: `Sidekick is busy. Try again ${when}.`, retryAfter: wait }
        }
        case "disabled":
            return { kind: "error", text: "Sidekick is switched off on this server." }
        case "forbidden":
            return { kind: "error", text: "You can't edit this document, so the sidekick can't add to it." }
        case "not-open":
            return { kind: "error", text: "The document isn't connected yet. Try again in a moment." }
        case "signed-out":
            return { kind: "error", text: "Sign in again to use the sidekick." }
        case "network":
            return { kind: "error", text: "Couldn't reach the sidekick. Check your connection." }
        case "invalid":
            return { kind: "error", text: "That text is too long or empty for the sidekick." }
        default:
            return { kind: "error", text: "The sidekick couldn't answer. Try again." }
    }
}
