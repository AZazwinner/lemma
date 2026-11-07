import { expect, test, type Page } from "@playwright/test"
import { blockSource, ghost, openSidekickMenu, startWriting } from "./sidekick-helpers"

// Run against a backend started with SIDEKICK_MOCK=1: canned answers, no Google calls, no quota.

/** Types lines into one block (Shift+Enter is a newline; plain Enter would start a new block). */
async function typeLines(page: Page, lines: string[]) {
    for (const [i, line] of lines.entries()) {
        if (i > 0) await page.keyboard.press("Shift+Enter")
        await page.keyboard.type(line)
    }
}

const choose = (page: Page, name: RegExp) => page.getByRole("button", { name }).click()
const requestsTo = (page: Page, path: string) => {
    const seen: string[] = []
    page.on("request", (request) => {
        if (request.url().includes(path)) seen.push(request.url())
    })
    return seen
}

test("Fix LaTeX error finds the broken equation, suggests a repair as ghost text and keeps the rest", async ({ page }) => {
    await startWriting(page, "sk_fix")
    await page.keyboard.type("so $x^2$ and $\\frac{1}{2$ end")

    await openSidekickMenu(page)
    await choose(page, /Fix LaTeX error/)

    await expect(ghost(page)).toContainText("\\frac{1}{2}")
    await expect(page.getByTestId("sidekick-notice")).toContainText(/missing a closing brace.*Tab to accept/)
    expect(await blockSource(page)).toBe("so $x^2$ and $\\frac{1}{2$ end") // not changed until accepted

    await page.keyboard.press("Tab")
    expect(await blockSource(page)).toBe("so $x^2$ and $\\frac{1}{2}$ end")
})

test("Fix LaTeX error on a selection repairs just the selection", async ({ page }) => {
    await startWriting(page, "sk_fix_sel")
    await page.keyboard.type("\\frac{1}{2")
    await page.keyboard.press("Shift+Home")

    await openSidekickMenu(page)
    await choose(page, /Fix LaTeX error/)
    await expect(ghost(page)).toBeVisible()
    await page.keyboard.press("Tab")
    expect(await blockSource(page)).toBe("\\frac{1}{2}")
})

test("when there is nothing to fix, no request is made", async ({ page }) => {
    await startWriting(page, "sk_fix_none")
    const requests = requestsTo(page, "/sidekick/fix")

    await page.keyboard.type("just words")
    await openSidekickMenu(page)
    await choose(page, /Fix LaTeX error/)
    await expect(page.getByTestId("sidekick-notice")).toContainText("No equations in this block")

    await page.keyboard.type(" and $x^2$")
    await openSidekickMenu(page)
    await choose(page, /Fix LaTeX error/)
    await expect(page.getByTestId("sidekick-notice")).toContainText("renders fine")

    await page.waitForTimeout(500)
    expect(requests).toEqual([])
})

test("Check my work flags the first wrong step with a highlight, without touching the text", async ({ page }) => {
    await startWriting(page, "sk_check")
    await typeLines(page, ["2x + 3 = 7", "2x = 5", "x = 2.5"])

    await openSidekickMenu(page)
    await choose(page, /Check my work/)

    const card = page.getByTestId("sidekick-check")
    await expect(card).toContainText("Step 2 doesn't follow.")
    await expect(card).toContainText("2x = 5")
    await expect(page.locator(".cm-sidekick-flag")).toHaveText("2x = 5")
    expect(await blockSource(page)).toBe("2x + 3 = 7\n2x = 5\nx = 2.5")
    expect(await page.evaluate(() => document.activeElement?.classList.contains("cm-content"))).toBe(true)

    // Esc closes the card and removes the highlight, and leaves the editor focused
    await page.keyboard.press("Escape")
    await expect(card).toHaveCount(0)
    await expect(page.locator(".cm-sidekick-flag")).toHaveCount(0)
    expect(await page.evaluate(() => document.activeElement?.classList.contains("cm-content"))).toBe(true)
})

test("Use suggestion replaces just the flagged step, only when clicked", async ({ page }) => {
    await startWriting(page, "sk_check_use")
    await page.keyboard.type("$$")
    await typeLines(page, ["", "2x + 3 = 7", "2x = 5", "x = 2.5", "$$"])

    await openSidekickMenu(page)
    await choose(page, /Check my work/)
    await expect(page.getByTestId("sidekick-check")).toContainText("Step 2")
    expect(await blockSource(page)).toBe("$$\n2x + 3 = 7\n2x = 5\nx = 2.5\n$$")

    await choose(page, /Use suggestion/)
    expect(await blockSource(page)).toBe("$$\n2x + 3 = 7\nx = 2\nx = 2.5\n$$")
    await expect(page.getByTestId("sidekick-check")).toHaveCount(0)
})

test("Check my work says so when every step follows", async ({ page }) => {
    await startWriting(page, "sk_check_ok")
    await typeLines(page, ["x = 1", "__ok__"])
    await openSidekickMenu(page)
    await choose(page, /Check my work/)
    await expect(page.getByTestId("sidekick-check")).toContainText("Every step follows")
    await expect(page.locator(".cm-sidekick-flag")).toHaveCount(0)
})

test("editing the flagged step removes the highlight and the stale suggestion", async ({ page }) => {
    await startWriting(page, "sk_check_edit")
    await typeLines(page, ["a = 1", "b = 2"])
    await openSidekickMenu(page)
    await choose(page, /Check my work/)
    await expect(page.locator(".cm-sidekick-flag")).toHaveText("b = 2")

    await page.keyboard.type("!") // caret is at the end of the flagged step
    await expect(page.locator(".cm-sidekick-flag")).toHaveCount(0)
    await expect(page.getByRole("button", { name: /Use suggestion/ })).toHaveCount(0)
})

test("Suggest next step shows a ghost line after the last step, accepted with Tab", async ({ page }) => {
    await startWriting(page, "sk_next")
    await typeLines(page, ["2x + 3 = 7", "2x = 6"])

    await openSidekickMenu(page)
    await choose(page, /Suggest next step/)
    await expect(ghost(page)).toContainText("x = 3")
    expect(await blockSource(page)).toBe("2x + 3 = 7\n2x = 6")

    await page.keyboard.press("Tab")
    expect(await blockSource(page)).toBe("2x + 3 = 7\n2x = 6\nx = 3")
})

test("the next step goes inside the $$ block, before the closing line", async ({ page }) => {
    await startWriting(page, "sk_next_block")
    await page.keyboard.type("$$")
    await typeLines(page, ["", "2x = 6", "$$"])
    await page.keyboard.press("ArrowUp") // caret somewhere in the block, not at the end of a step

    await openSidekickMenu(page)
    await choose(page, /Suggest next step/)
    await expect(ghost(page)).toBeVisible()
    await page.keyboard.press("Tab")
    expect(await blockSource(page)).toBe("$$\n2x = 6\nx = 3\n$$")
})

test("a finished derivation gets a quiet note, not a made-up step", async ({ page }) => {
    await startWriting(page, "sk_next_done")
    await typeLines(page, ["x = 3", "__done__"])
    await openSidekickMenu(page)
    await choose(page, /Suggest next step/)
    await expect(page.getByTestId("sidekick-notice")).toContainText(/already reached/i)
    await expect(ghost(page)).toHaveCount(0)
})

test("the maths helpers show a quiet busy note too, and change nothing", async ({ page }) => {
    await startWriting(page, "sk_math_busy")
    await typeLines(page, ["a = 1", "__busy__"])
    await openSidekickMenu(page)
    await choose(page, /Check my work/)
    await expect(page.getByTestId("sidekick-notice")).toContainText(/busy.*try again in 20s/i)
    expect(await blockSource(page)).toBe("a = 1\n__busy__")
})

test("an empty block asks for steps instead of sending anything", async ({ page }) => {
    await startWriting(page, "sk_math_empty")
    const requests = requestsTo(page, "/sidekick/check")
    await openSidekickMenu(page)
    await choose(page, /Check my work/)
    await expect(page.getByTestId("sidekick-notice")).toContainText(/Write the steps/)
    await page.waitForTimeout(400)
    expect(requests).toEqual([])
})
