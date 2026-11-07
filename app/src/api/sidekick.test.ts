import { describe, expect, it } from "vitest"
import { errorFromResponse } from "./sidekick"

describe("errorFromResponse", () => {
    it("reads the retry hint from the body, then the header", () => {
        expect(errorFromResponse(429, { detail: { code: "busy", retry_after: 23 } }, "99")).toMatchObject({ kind: "busy", retryAfter: 23 })
        expect(errorFromResponse(429, null, "17")).toMatchObject({ kind: "busy", retryAfter: 17 })
        expect(errorFromResponse(429, {}, null).retryAfter).toBeUndefined()
    })

    it("maps the other statuses", () => {
        expect(errorFromResponse(503, null).kind).toBe("disabled")
        expect(errorFromResponse(401, null).kind).toBe("signed-out")
        expect(errorFromResponse(422, null).kind).toBe("invalid")
        expect(errorFromResponse(502, null).kind).toBe("upstream")
        expect(errorFromResponse(500, null).kind).toBe("upstream")
    })
})
