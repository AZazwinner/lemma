const API_URL = process.env.NEXT_PUBLIC_API_URL

// The backend waits up to a minute for Google, and large models can take half that to answer.
const TIMEOUT_MS = 75_000

export type SidekickStatus = {
    enabled: boolean
    mock: boolean
    used_today: number
    daily_budget: number
    user_per_minute: number
    features: string[]
}

export type LatexResult = { latex: string; cached: boolean; mock: boolean }
export type ExplainResult = { summary: string; steps: string[]; cached: boolean; mock: boolean }

export type SidekickErrorKind = "busy" | "disabled" | "signed-out" | "upstream" | "network" | "invalid"

export class SidekickApiError extends Error {
    kind: SidekickErrorKind
    /** Seconds, for "busy". */
    retryAfter?: number

    constructor(kind: SidekickErrorKind, retryAfter?: number) {
        super(kind)
        this.kind = kind
        this.retryAfter = retryAfter
    }
}

/** Maps a failed response to an error kind. Exported for tests. */
export function errorFromResponse(status: number, body: unknown, retryAfterHeader?: string | null): SidekickApiError {
    const detail = (body as { detail?: { code?: string; retry_after?: number } } | null)?.detail
    if (status === 429) {
        const fromBody = typeof detail?.retry_after === "number" ? detail.retry_after : undefined
        const fromHeader = retryAfterHeader ? Number(retryAfterHeader) : undefined
        return new SidekickApiError("busy", fromBody ?? (Number.isFinite(fromHeader) ? fromHeader : undefined))
    }
    if (status === 503) return new SidekickApiError("disabled")
    if (status === 401 || status === 403) return new SidekickApiError("signed-out")
    if (status === 422) return new SidekickApiError("invalid")
    return new SidekickApiError("upstream")
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

export const explainLatex = (latex: string) =>
    request<ExplainResult>("/sidekick/explain", { method: "POST", body: JSON.stringify({ latex }) })
