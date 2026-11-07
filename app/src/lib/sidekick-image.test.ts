import { describe, expect, it } from "vitest"
import { checkImageFile, fitWithin, imageProblemText, MAX_SOURCE_BYTES } from "./sidekick-image"

describe("fitWithin", () => {
    it("shrinks the longest side to the limit and keeps the shape", () => {
        expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 })
        expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 })
    })

    it("never scales up", () => {
        expect(fitWithin(300, 200, 1600)).toEqual({ width: 300, height: 200 })
    })

    it("never gives a zero-sized side", () => {
        expect(fitWithin(10000, 2, 1600)).toEqual({ width: 1600, height: 1 })
    })
})

describe("checkImageFile", () => {
    it("accepts the supported types and refuses the rest", () => {
        for (const type of ["image/png", "image/jpeg", "image/webp"]) expect(checkImageFile({ type, size: 1000 })).toBe("ok")
        expect(checkImageFile({ type: "image/gif", size: 1000 })).toBe("type")
        expect(checkImageFile({ type: "application/pdf", size: 1000 })).toBe("type")
        expect(checkImageFile({ type: "", size: 1000 })).toBe("type")
    })

    it("refuses an absurdly large file before decoding it", () => {
        expect(checkImageFile({ type: "image/png", size: MAX_SOURCE_BYTES + 1 })).toBe("huge")
    })
})

describe("imageProblemText", () => {
    it("has a plain sentence for each problem", () => {
        for (const problem of ["type", "huge", "too-big", "unreadable"] as const) expect(imageProblemText(problem).length).toBeGreaterThan(10)
    })
})
