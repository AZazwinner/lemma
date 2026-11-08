import { expect, test, type Locator, type Page } from "@playwright/test"
import { focusBlock, signUp } from "./helpers"

// The backend the browser talks to, for the few calls a test makes directly (sharing a document). Defaults to the dev backend.
export const API_URL = process.env.E2E_API_URL ?? "http://localhost:12001"

export async function openNewDoc(page: Page): Promise<string> {
    await page.getByRole("button", { name: "New document" }).click()
    await page.waitForURL("**/docs/d/*")
    await page.waitForTimeout(800)
    return page.url()
}

/**
 * The sidekick specs expect canned answers. Against a backend that is really calling an AI provider they would spend
 * quota and get answers they can't predict, so they skip themselves unless the backend runs with SIDEKICK_MOCK=1.
 */
export async function skipUnlessMock(page: Page) {
    const token = await page.evaluate(() => localStorage.getItem("token"))
    let status: { enabled?: boolean; mock?: boolean } | null = null
    try {
        const res = await page.request.get(`${API_URL}/sidekick/status`, { headers: { Authorization: `Bearer ${token}` } })
        status = res.ok() ? await res.json() : null
    } catch {
        // can't reach the backend to ask: don't guess, skip
    }
    test.skip(!status?.enabled || !status.mock, "needs a backend started with SIDEKICK_MOCK=1 (canned answers, no quota)")
}

/** Signs up, opens a new document and puts the caret in its first block. */
export async function startWriting(page: Page, prefix: string) {
    const user = await signUp(page, prefix)
    await skipUnlessMock(page)
    const url = await openNewDoc(page)
    await focusBlock(page)
    return { ...user, url }
}

export const sidekickButton = (page: Page) => page.getByTestId("sidekick-button")
export const sidekickPanel = (page: Page) => page.getByTestId("sidekick-panel")
export const selectionToolbar = (page: Page) => page.getByTestId("sidekick-selection-toolbar")

/** The dashed ghost block under a block: a suggestion that is not in the document until it is accepted. */
export const ghost = (page: Page) => page.getByTestId("sidekick-ghost")
export const ghostPreview = (page: Page) => page.getByTestId("sidekick-ghost-preview")
export const explanationCard = (page: Page) => page.getByTestId("sidekick-explanation")
export const problemRow = (page: Page) => page.getByTestId("sidekick-problem")
export const noticeRow = (page: Page) => page.getByTestId("sidekick-notice")
export const thinking = (page: Page) => page.getByTestId("sidekick-thinking")
export const squiggle = (page: Page) => page.locator(".cm-sidekick-flag")

export async function openSidekickMenu(page: Page) {
    await sidekickButton(page).click()
    await expect(sidekickPanel(page)).toBeVisible()
}

export type MenuAction = "Explain" | "Fix" | "Next step" | "Rewrite"

/** Opens the sparkle menu and picks one of its four actions. */
export async function runFromMenu(page: Page, action: MenuAction) {
    await openSidekickMenu(page)
    await sidekickPanel(page).getByRole("button", { name: new RegExp(`^${action}`) }).click()
}

/** Types into the "Write from description" field and sends it. */
export async function writeFromDescription(page: Page, description: string) {
    await openSidekickMenu(page)
    await page.getByTestId("sidekick-write-input").fill(description)
    await page.getByTestId("sidekick-write-input").press("Enter")
}

/**
 * Holds every sidekick answer back for a moment, so a test can see the "Thinking…" state and type while the sidekick is
 * working. Without it the mock's own delay is not enough: it caches answers, so a repeat of the same request comes back at once.
 */
export async function slowSidekick(page: Page, ms = 700) {
    await page.route("**/sidekick/**", async (route) => {
        if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, ms))
        await route.continue()
    })
}

export const editorFocused = (page: Page) => page.evaluate(() => document.activeElement?.classList.contains("cm-content") ?? false)

/** Types lines into one block (Shift+Enter is a newline; plain Enter would start a new block). */
export async function typeLines(page: Page, lines: string[]) {
    for (const [i, line] of lines.entries()) {
        if (i > 0) await page.keyboard.press("Shift+Enter")
        await page.keyboard.type(line)
    }
}

/** The raw text of a block, as the editor holds it (not the rendered preview), without hints or other people's cursor labels. */
export async function blockSource(page: Page, index = 0): Promise<string> {
    return page.locator(`[data-block-index="${index}"] .cm-line`).evaluateAll((lines) =>
        lines
            .map((line) => {
                const copy = line.cloneNode(true) as HTMLElement
                copy.querySelectorAll(".cm-sidekick-hint, .cm-ySelectionCaret").forEach((el) => el.remove())
                return copy.textContent ?? ""
            })
            .join("\n")
    )
}

/** Every block's raw text, in order, read from the editors (focused or not). */
export async function allBlockSources(page: Page): Promise<string[]> {
    const count = await page.locator("[data-block-index]").count()
    return Promise.all(Array.from({ length: count }, (_, i) => blockSource(page, i)))
}

/** The LaTeX source of every equation typeset inside a locator, read from KaTeX's own annotation. */
export const typesetSources = (scope: Locator) => scope.locator('annotation[encoding="application/x-tex"]').allTextContents()

/** True if the card is directly under the block: just below it, on the same left edge. */
export async function isRightBelow(card: Locator, block: Locator, maxGap = 60) {
    const [c, b] = await Promise.all([card.boundingBox(), block.boundingBox()])
    if (!c || !b) return false
    return c.y >= b.y + b.height - 2 && c.y - (b.y + b.height) <= maxGap
}

/**
 * Saves a screenshot when SIDEKICK_SHOTS names a folder (nothing is written otherwise), so the before/after pictures of
 * each flow can be made without the pictures being part of the repository.
 */
export async function shot(page: Page, name: string, target?: Locator) {
    const dir = process.env.SIDEKICK_SHOTS
    if (!dir) return
    await page.waitForTimeout(350) // let menus and toolbars finish fading in
    const path = `${dir}/${name}.png`
    if (target) await target.screenshot({ path })
    else await page.screenshot({ path })
}

export async function tokenOf(page: Page): Promise<string> {
    return (await page.evaluate(() => localStorage.getItem("token"))) as string
}

export async function currentUserId(page: Page): Promise<number> {
    const token = await tokenOf(page)
    const res = await page.request.get(`${API_URL}/me`, { headers: { Authorization: `Bearer ${token}` } })
    return (await res.json()).id
}

/** Gives `userId` write access to the document that `owner` has open. */
export async function shareDoc(owner: Page, userId: number, permission: "read" | "write" = "write") {
    const docId = Number(owner.url().split("/").pop())
    const token = await tokenOf(owner)
    const res = await owner.request.post(`${API_URL}/doc-share`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { doc_id: docId, user_id: userId, share_type: permission },
    })
    expect(res.ok()).toBeTruthy()
}
