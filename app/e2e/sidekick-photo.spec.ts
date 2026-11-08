import { expect, test, type Page } from "@playwright/test"
import { blockSource, editorFocused, ghost, ghostPreview, noticeRow, openSidekickMenu, slowSidekick, startWriting, thinking } from "./sidekick-helpers"

// A 1x1 PNG. The browser decodes and re-encodes it, so the whole path (choose file, shrink, send, ghost) is real; only
// the answer is canned, because the backend runs with SIDEKICK_MOCK=1.
const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
)
const photo = { name: "board.png", mimeType: "image/png", buffer: PNG }
const MOCK_LATEX = "x^2 + 2x + 1 = (x + 1)^2"

const choosePhoto = (page: Page, file = photo) => page.getByTestId("sidekick-photo-input").setInputFiles(file)

test("Photo → LaTeX sends a shrunk JPEG and shows the result as a ghost block to accept with Tab", async ({ page }) => {
    await startWriting(page, "sk_photo")
    await slowSidekick(page)
    await page.keyboard.type("Board from class:")
    const sent: { url: string; body: string }[] = []
    page.on("request", (request) => {
        if (request.url().includes("/sidekick/image")) sent.push({ url: request.url(), body: request.postData() ?? "" })
    })

    await openSidekickMenu(page)
    await choosePhoto(page)

    await expect(thinking(page)).toBeVisible()
    await expect(ghost(page)).toBeVisible()
    await expect(ghost(page)).toContainText("Suggested equation")
    await expect(ghostPreview(page).locator("annotation")).toContainText(MOCK_LATEX)
    expect(await blockSource(page)).toBe("Board from class:") // nothing written yet
    expect(await editorFocused(page)).toBe(true)

    expect(sent).toHaveLength(1)
    const body = JSON.parse(sent[0].body)
    expect(body.mime_type).toBe("image/jpeg")
    expect(Buffer.from(body.image, "base64").subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff])) // a real JPEG
    expect(sent[0].body.length).toBeLessThan(1024 * 1024) // under the server's request cap

    await page.keyboard.press("Tab")
    expect(await blockSource(page)).toBe(`Board from class:\n$$\n${MOCK_LATEX}\n$$`)
})

test("an empty block is replaced by the transcription, and Esc dismisses it", async ({ page }) => {
    await startWriting(page, "sk_photo_empty")
    await choosePhoto(page)
    await expect(ghost(page)).toBeVisible()

    await page.keyboard.press("Escape")
    await expect(ghost(page)).toHaveCount(0)
    expect(await blockSource(page)).toBe("")

    await choosePhoto(page)
    await expect(ghost(page)).toBeVisible()
    await page.keyboard.press("Tab")
    expect(await blockSource(page)).toBe(`$$\n${MOCK_LATEX}\n$$`)
})

test("a file that isn't a supported picture is turned away without sending anything", async ({ page }) => {
    await startWriting(page, "sk_photo_type")
    let requests = 0
    page.on("request", (request) => {
        if (request.url().includes("/sidekick/image")) requests++
    })

    await openSidekickMenu(page)
    await choosePhoto(page, { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") })
    await expect(noticeRow(page)).toContainText("PNG, JPEG or WebP")
    await page.waitForTimeout(400)
    expect(requests).toBe(0)
})

test("a picture that can't be decoded gets a quiet note", async ({ page }) => {
    await startWriting(page, "sk_photo_bad")
    await openSidekickMenu(page)
    await choosePhoto(page, { name: "broken.png", mimeType: "image/png", buffer: Buffer.from("not really a png") })
    await expect(noticeRow(page)).toContainText("Couldn't read that picture")
    await expect(ghost(page)).toHaveCount(0)
})

test("typing while the sidekick reads the photo drops its answer", async ({ page }) => {
    await startWriting(page, "sk_photo_typing")
    await slowSidekick(page)
    await page.keyboard.type("class notes")
    await openSidekickMenu(page)
    await choosePhoto(page)
    await page.keyboard.type("!")
    await page.waitForTimeout(1200)
    await expect(ghost(page)).toHaveCount(0)
    expect(await blockSource(page)).toBe("class notes!")
})

test("a busy answer for a photo is a quiet note", async ({ page }) => {
    await startWriting(page, "sk_photo_busy")
    // the mock only answers "busy" for text, so simulate the server's own 429 for this request
    await page.route("**/sidekick/image", (route) =>
        route.fulfill({
            status: 429,
            headers: { "Retry-After": "20", "Content-Type": "application/json" },
            body: JSON.stringify({ detail: { code: "busy", message: "busy", retry_after: 20 } }),
        })
    )
    await openSidekickMenu(page)
    await choosePhoto(page)
    await expect(noticeRow(page)).toContainText(/busy.*try again in 20s/i)
    await expect(ghost(page)).toHaveCount(0)
})
