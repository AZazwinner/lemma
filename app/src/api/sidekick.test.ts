import { describe, expect, it } from "vitest"
import { errorFromResponse, requireText, SidekickApiError } from "./sidekick"

describe("errorFromResponse", () => {
    it("reads the retry hint from the body, then the header", () => {
        expect(errorFromResponse(429, { detail: { code: "busy", retry_after: 23 } }, "99")).toMatchObject({ kind: "busy", retryAfter: 23 })
        expect(errorFromResponse(429, null, "17")).toMatchObject({ kind: "busy", retryAfter: 17 })
        expect(errorFromResponse(429, {}, null).retryAfter).toBeUndefined()
    })

    it("maps the other statuses", () => {
        expect(errorFromResponse(503, null).kind).toBe("disabled")
        expect(errorFromResponse(401, null).kind).toBe("signed-out")
        expect(errorFromResponse(403, null).kind).toBe("forbidden")
        expect(errorFromResponse(409, null).kind).toBe("not-open")
        expect(errorFromResponse(422, null).kind).toBe("invalid")
        expect(errorFromResponse(502, null).kind).toBe("upstream")
        expect(errorFromResponse(502, { detail: { code: "upstream_error", reason: "HTTP 503" } }).reason).toBe("HTTP 503")
        expect(errorFromResponse(502, { detail: { reason: 5 } }).reason).toBeUndefined()
        expect(errorFromResponse(500, null).kind).toBe("upstream")
    })

    it("treats a missing endpoint as a backend that is older than this page", () => {
        expect(errorFromResponse(404, null).kind).toBe("outdated")
    })
})

describe("requireText", () => {
    it("passes an answer that has its text", () => {
        expect(requireText({ text: "It squares $x$.", cached: false })).toMatchObject({ text: "It squares $x$." })
    })

    it("turns an older backend's answer (a summary and steps, no text) into an 'outdated' error instead of undefined", () => {
        const oldAnswer = { summary: "It squares x.", steps: ["Take x."], cached: false, mock: false }
        expect(() => requireText(oldAnswer)).toThrow(SidekickApiError)
        try {
            requireText(oldAnswer)
        } catch (error) {
            expect((error as SidekickApiError).kind).toBe("outdated")
        }
        expect(() => requireText({ text: null })).toThrow(SidekickApiError)
    })
})
