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

/** What to explain: the selection, else the whole block, with any "@sidekick" prefix removed. */
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

/** The sentences of an explanation (the backend sends them one per line). */
export function explanationLines(text: string): string[] {
    return text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
}

/** An explanation as one paragraph, for "Insert as note". */
export function explanationNote(text: string): string {
    return explanationLines(text).join(" ")
}

/**
 * The smallest edit that turns `before` into `after`: the text they share at the start and at the end is left alone.
 * A repaired block is applied this way, so a collaborator's cursor elsewhere in the block does not move.
 */
export function minimalEdit(before: string, after: string): { from: number; to: number; insert: string } | null {
    if (before === after) return null
    const shortest = Math.min(before.length, after.length)
    let start = 0
    while (start < shortest && before[start] === after[start]) start++
    let endBefore = before.length
    let endAfter = after.length
    while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
        endBefore--
        endAfter--
    }
    return { from: start, to: endBefore, insert: after.slice(start, endAfter) }
}

/** Splits text into document blocks at blank lines, but never inside a `$$ ... $$` equation or a code fence. */
export function splitBlocks(text: string): string[] {
    const blocks: string[] = []
    let current: string[] = []
    let inMath = false
    let inCode = false
    for (const line of text.trim().split("\n")) {
        const stripped = line.trim()
        if (stripped.startsWith("```")) inCode = !inCode
        else if (!inCode && stripped === "$$") inMath = !inMath
        if (!stripped && !inMath && !inCode) {
            if (current.length > 0) blocks.push(current.join("\n"))
            current = []
            continue
        }
        current.push(line)
    }
    if (current.length > 0) blocks.push(current.join("\n"))
    return blocks
}

export type Notice = { kind: "busy" | "error" | "info"; text: string; retryAfter?: number }

/** What to tell the writer when the AI provider failed, from the short reason the backend gives ("HTTP 504", "HTTP 503", ...). */
function upstreamText(reason?: string): string {
    const status = reason?.match(/^HTTP (\d{3})$/)?.[1]
    if (status === "504") return "The AI service took too long to answer. Try again, or pick a faster model."
    if (status === "402") return "The AI account is out of credit. Top it up, or switch provider on the server."
    if (status && status.startsWith("5")) return `The AI service had a problem (HTTP ${status}). Try again in a moment.`
    if (status) return `The AI service rejected the request (HTTP ${status}). Check the model and key on the server.`
    if (reason === "output limit") return "The model ran out of room while thinking. Try again, or pick a faster model."
    if (reason === "empty answer") return "The model gave no answer. Try again."
    return "The sidekick couldn't answer. Try again."
}

export function noticeFor(kind: string, retryAfter?: number, reason?: string): Notice {
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
        case "outdated":
            return { kind: "info", text: "The server is running an older version of the sidekick. Restart the backend, then try again." }
        case "signed-out":
            return { kind: "error", text: "Sign in again to use the sidekick." }
        case "network":
            return { kind: "error", text: "Couldn't reach the sidekick. Check your connection." }
        case "invalid":
            return { kind: "error", text: "That text is too long or empty for the sidekick." }
        default:
            return { kind: "error", text: upstreamText(reason) }
    }
}
