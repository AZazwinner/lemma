// Getting a photo ready to send: checked, shrunk and re-encoded in the browser. The server caps HTTP bodies at 1 MiB and
// accepts at most MAX_UPLOAD_BYTES of image, and a smaller picture is also quicker and uses fewer tokens.

export const MAX_UPLOAD_BYTES = 600 * 1024
/** Refuse anything bigger than this before even decoding it. */
export const MAX_SOURCE_BYTES = 20 * 1024 * 1024
export const MAX_EDGE_PX = 1600
export const MIN_EDGE_PX = 400
export const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"]

/** The largest size that fits in a `max` by `max` square, keeping the shape. Never scales up. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
    const scale = Math.min(1, max / Math.max(width, height))
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export function checkImageFile(file: { type: string; size: number }): "ok" | "type" | "huge" {
    if (!ACCEPTED_TYPES.includes(file.type)) return "type"
    if (file.size > MAX_SOURCE_BYTES) return "huge"
    return "ok"
}

export function imageProblemText(problem: "type" | "huge" | "too-big" | "unreadable"): string {
    switch (problem) {
        case "type":
            return "Use a PNG, JPEG or WebP picture."
        case "huge":
            return "That picture is too large. Try a smaller one."
        case "too-big":
            return "Couldn't shrink that picture enough. Try cropping it to just the maths."
        default:
            return "Couldn't read that picture."
    }
}

export class ImageProblem extends Error {
    constructor(readonly problem: "type" | "huge" | "too-big" | "unreadable") {
        super(problem)
    }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
    return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality))
}

async function toBase64(blob: Blob): Promise<string> {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ""
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(binary)
}

/** A JPEG of the picture, at most MAX_EDGE_PX on its longest side and MAX_UPLOAD_BYTES in size, as base64. */
export async function prepareImage(file: File): Promise<{ base64: string; mime: "image/jpeg" }> {
    const problem = checkImageFile(file)
    if (problem !== "ok") throw new ImageProblem(problem)

    let bitmap: ImageBitmap
    try {
        bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
    } catch {
        throw new ImageProblem("unreadable")
    }

    try {
        let edge = MAX_EDGE_PX
        while (edge >= MIN_EDGE_PX) {
            const { width, height } = fitWithin(bitmap.width, bitmap.height, edge)
            const canvas = document.createElement("canvas")
            canvas.width = width
            canvas.height = height
            const context = canvas.getContext("2d")
            if (!context) throw new ImageProblem("unreadable")
            // JPEG has no transparency: paint white first, or a transparent PNG becomes black.
            context.fillStyle = "#fff"
            context.fillRect(0, 0, width, height)
            context.drawImage(bitmap, 0, 0, width, height)

            for (const quality of [0.85, 0.7, 0.55]) {
                const blob = await toBlob(canvas, quality)
                if (blob && blob.size <= MAX_UPLOAD_BYTES) return { base64: await toBase64(blob), mime: "image/jpeg" }
            }
            edge = Math.floor(edge * 0.75)
        }
    } finally {
        bitmap.close()
    }
    throw new ImageProblem("too-big")
}
