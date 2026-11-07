import { expect, type Page } from "@playwright/test"
import { focusBlock, signUp } from "./helpers"

// The backend the browser talks to, for the few calls a test makes directly (sharing a document). Defaults to the dev backend.
export const API_URL = process.env.E2E_API_URL ?? "http://localhost:12001"

export async function openNewDoc(page: Page): Promise<string> {
    await page.getByRole("button", { name: "New document" }).click()
    await page.waitForURL("**/docs/d/*")
    await page.waitForTimeout(800)
    return page.url()
}

/** Signs up, opens a new document and puts the caret in its first block. */
export async function startWriting(page: Page, prefix: string) {
    const user = await signUp(page, prefix)
    const url = await openNewDoc(page)
    await focusBlock(page)
    return { ...user, url }
}

export const sidekickButton = (page: Page) => page.getByTestId("sidekick-button")
export const sidekickPanel = (page: Page) => page.getByTestId("sidekick-panel")
export const ghost = (page: Page) => page.locator('[data-sidekick-ghost="suggestion"]')

export async function openSidekickMenu(page: Page) {
    await sidekickButton(page).click()
    await expect(sidekickPanel(page)).toBeVisible()
}

/** The raw text of a block, as the editor holds it (not the rendered preview), without ghost text or other people's cursor labels. */
export async function blockSource(page: Page, index = 0): Promise<string> {
    return page.locator(`[data-block-index="${index}"] .cm-line`).evaluateAll((lines) =>
        lines
            .map((line) => {
                const copy = line.cloneNode(true) as HTMLElement
                copy.querySelectorAll(".cm-sidekick-ghost, .cm-ySelectionCaret").forEach((el) => el.remove())
                return copy.textContent ?? ""
            })
            .join("\n")
    )
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
