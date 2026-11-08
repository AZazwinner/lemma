const API_URL = process.env.NEXT_PUBLIC_API_URL

// The backend waits up to SIDEKICK_TIMEOUT_SECONDS (default 100, at most 120) for Google, and a large model can take over
// a minute to answer. This is longer than any of those, so the backend's own answer (even an error) arrives first.
const TIMEOUT_MS = 130_000

export type SidekickStatus = {
    enabled: boolean
    mock: boolean
    used_today: number
    daily_budget: number
    user_per_minute: number
    features: string[]
}

export type LatexResult = { latex: string; cached: boolean; mock: boolean }
/** `text` is 3 to 5 short sentences, one per line, with the maths between single dollar signs. */
export type ExplainResult = { text: string; cached: boolean; mock: boolean }
/** Markdown with maths in `$...$` and `$$...$$`; paragraphs and displayed equations are separated by blank lines. */
export type WriteResult = { text: string; cached: boolean; mock: boolean }

export type SidekickErrorKind =
    | "busy"
    | "disabled"
    | "signed-out"
    | "forbidden"
    | "not-open"
    /** The backend is running an older version of the sidekick than this page expects (it has no such endpoint, or answers in an old shape). */
    | "outdated"
    | "upstream"
    | "network"
    | "invalid"

export class SidekickApiError extends Error {
    kind: SidekickErrorKind
    /** Seconds, for "busy". */
    retryAfter?: number
    /** A short, safe reason for "upstream" errors, such as "HTTP 503". */
    reason?: string

    constructor(kind: SidekickErrorKind, retryAfter?: number, reason?: string) {
        super(kind)
        this.kind = kind
        this.retryAfter = retryAfter
        this.reason = reason
    }
}

/** Maps a failed response to an error kind. Exported for tests. */
export function errorFromResponse(status: number, body: unknown, retryAfterHeader?: string | null): SidekickApiError {
    const detail = (body as { detail?: { code?: string; retry_after?: number; reason?: string } } | null)?.detail
    if (status === 429) {
        const fromBody = typeof detail?.retry_after === "number" ? detail.retry_after : undefined
        const fromHeader = retryAfterHeader ? Number(retryAfterHeader) : undefined
        return new SidekickApiError("busy", fromBody ?? (Number.isFinite(fromHeader) ? fromHeader : undefined))
    }
    if (status === 503) return new SidekickApiError("disabled")
    if (status === 401) return new SidekickApiError("signed-out")
    if (status === 403) return new SidekickApiError("forbidden")
    if (status === 409) return new SidekickApiError("not-open")
    if (status === 404) return new SidekickApiError("outdated") // the backend has no such sidekick endpoint yet
    if (status === 422) return new SidekickApiError("invalid")
    return new SidekickApiError("upstream", undefined, typeof detail?.reason === "string" ? detail.reason : undefined)
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = localStorage.getItem("token")
    if (!token) throw new SidekickApiError("signed-out")

    let res: Response
    try {
        res = await fetch(`${API_URL}${path}`, {
            ...init,
            headers: { ...init.headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            signal: AbortSignal.timeout(TIMEOUT_MS),
        })
    } catch {
        throw new SidekickApiError("network")
    }

    if (!res.ok) {
        let body: unknown = null
        try {
            body = await res.json()
        } catch {
            // not JSON; the status is enough
        }
        throw errorFromResponse(res.status, body, res.headers.get("Retry-After"))
    }
    return res.json()
}

export const fetchSidekickStatus = () => request<SidekickStatus>("/sidekick/status")

export const textToLatex = (text: string) =>
    request<LatexResult>("/sidekick/latex", { method: "POST", body: JSON.stringify({ text }) })

/**
 * An answer that should carry `text`. A backend that predates this version answers explain in an older shape (a summary
 * and steps), which the page cannot show: say so, rather than let it reach the screen as `undefined`.
 */
export function requireText<T extends object>(result: T): T & { text: string } {
    if (typeof (result as { text?: unknown }).text !== "string") throw new SidekickApiError("outdated")
    return result as T & { text: string }
}

export const explainLatex = async (latex: string) =>
    requireText(await request<ExplainResult>("/sidekick/explain", { method: "POST", body: JSON.stringify({ latex }) }))

export const writeText = async (text: string) =>
    requireText(await request<WriteResult>("/sidekick/write", { method: "POST", body: JSON.stringify({ text }) }))

export type FixResult = { latex: string; why: string; changed: boolean; cached: boolean; mock: boolean }
export type CheckResult = {
    ok: boolean
    /** 1-based, in the order the steps were sent. */
    step: number | null
    why: string
    suggestion: string | null
    cached: boolean
    mock: boolean
}
export type NextResult = { next: string | null; done: boolean; why: string; cached: boolean; mock: boolean }

export const fixLatex = (latex: string, error: string) =>
    request<FixResult>("/sidekick/fix", { method: "POST", body: JSON.stringify({ latex, error }) })

export const checkWork = (steps: string[]) =>
    request<CheckResult>("/sidekick/check", { method: "POST", body: JSON.stringify({ steps }) })

export const suggestNext = (steps: string[]) =>
    request<NextResult>("/sidekick/next", { method: "POST", body: JSON.stringify({ steps }) })

/** A photo or screenshot of maths (already shrunk to a base64 JPEG) to LaTeX. */
export const imageToLatex = (image: string, mimeType: string) =>
    request<LatexResult>("/sidekick/image", { method: "POST", body: JSON.stringify({ image, mime_type: mimeType }) })

export type IntoDocResult = { block_id: string; cached: boolean; mock: boolean }

/** Same as textToLatex, but the Sidekick writes the answer into the live document, as a new block after `afterBlockId`. */
export const latexIntoDoc = (docId: number, text: string, afterBlockId?: string) =>
    request<IntoDocResult>(`/sidekick/docs/${docId}/latex`, {
        method: "POST",
        body: JSON.stringify({ text, after_block_id: afterBlockId ?? null }),
    })

/** Same as writeText, but the Sidekick writes the passage into the live document, one block per paragraph or equation. */
export const writeIntoDoc = (docId: number, text: string, afterBlockId?: string) =>
    request<IntoDocResult>(`/sidekick/docs/${docId}/write`, {
        method: "POST",
        body: JSON.stringify({ text, after_block_id: afterBlockId ?? null }),
    })

export const explainIntoDoc = (docId: number, latex: string, afterBlockId?: string) =>
    request<IntoDocResult>(`/sidekick/docs/${docId}/explain`, {
        method: "POST",
        body: JSON.stringify({ latex, after_block_id: afterBlockId ?? null }),
    })
