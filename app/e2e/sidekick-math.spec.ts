import { expect, test, type Page } from "@playwright/test"
import {
    blockSource,
    editorFocused,
    ghost,
    ghostPreview,
    noticeRow,
    problemRow,
    runFromMenu,
    shot,
    slowSidekick,
    squiggle,
    startWriting,
    thinking,
    typeLines,
    typesetSources,
} from "./sidekick-helpers"

// Run against a backend started with SIDEKICK_MOCK=1: canned answers, no AI calls, no quota.

const requestsTo = (page: Page, path: string) => {
    const seen: string[] = []
    page.on("request", (request) => {
        if (request.url().includes(path)) seen.push(request.url())
    })
    return seen
}

test("Fix finds the broken equation for free, then shows the repair as a ghost block, and keeps the rest", async ({ page }) => {
    await startWriting(page, "sk_fix")
    await slowSidekick(page)
    const requests = requestsTo(page, "/sidekick/fix")
    const original = "so $x^2$ and $\\frac{1}{2$ end"
    await page.keyboard.type(original)

    await runFromMenu(page, "Fix")

    // a squiggle under the broken equation and one line saying so; nothing was sent to the model
    await expect(problemRow(page)).toContainText("This equation doesn't render.")
    await expect(squiggle(page)).toHaveText("\\frac{1}{2")
    expect(requests).toEqual([])
    expect(await blockSource(page)).toBe(original)

    // the Fix button asks for the repair, which comes back as a ghost: the whole block, typeset, with the one-sentence reason
    await page.getByTestId("sidekick-fix").click()
    await expect(thinking(page)).toBeVisible()
    await expect(ghost(page)).toBeVisible()
    await expect(ghost(page)).toContainText("The fraction was missing a closing brace.")
    expect(await typesetSources(ghostPreview(page))).toEqual(["x^2", "\\frac{1}{2}"])
    expect(requests).toHaveLength(1)
    expect(await blockSource(page)).toBe(original) // still not changed
    expect(await editorFocused(page)).toBe(true)

    await page.keyboard.press("Tab")
    expect(await blockSource(page)).toBe("so $x^2$ and $\\frac{1}{2}$ end")
    await expect(problemRow(page)).toHaveCount(0)
    await expect(ghost(page)).toHaveCount(0)
})

test("Fix on a selection repairs just the selection", async ({ page }) => {
    await startWriting(page, "sk_fix_sel")
    await page.keyboard.type("\\frac{1}{2")
    await page.keyboard.press("Shift+Home")

    await runFromMenu(page, "Fix")
    await expect(problemRow(page)).toBeVisible()
    await page.getByTestId("sidekick-fix").click()
    await expect(ghost(page)).toBeVisible()
    await page.keyboard.press("Tab")
    expect(await blockSource(page)).toBe("\\frac{1}{2}")
})

test("Esc closes the ghost first, then the problem line, and never changes the text", async ({ page }) => {
    await startWriting(page, "sk_fix_esc")
    await page.keyboard.type("\\frac{1}{2")
    await page.keyboard.press("Shift+Home")
    await runFromMenu(page, "Fix")
    await page.getByTestId("sidekick-fix").click()
    await expect(ghost(page)).toBeVisible()

    await page.keyboard.press("Escape")
    await expect(ghost(page)).toHaveCount(0)
    await expect(problemRow(page)).toBeVisible() // the line, with its Fix button, is still there
    await expect(page.getByTestId("sidekick-fix")).toBeVisible()

    await page.keyboard.press("Escape")
    await expect(problemRow(page)).toHaveCount(0)
    await expect(squiggle(page)).toHaveCount(0)
    expect(await blockSource(page)).toBe("\\frac{1}{2")
    expect(await editorFocused(page)).toBe(true)
})

test("when there is nothing to fix, no request is made", async ({ page }) => {
    await startWriting(page, "sk_fix_none")
    const fixes = requestsTo(page, "/sidekick/fix")
    const checks = requestsTo(page, "/sidekick/check")

    await page.keyboard.type("just words")
    await runFromMenu(page, "Fix")
    await expect(noticeRow(page)).toContainText("Nothing to check here")

    await page.keyboard.type(" and $x^2$")
    await runFromMenu(page, "Fix")
    await expect(noticeRow(page)).toContainText("Nothing to check here")

    await page.waitForTimeout(500)
    expect(fixes).toEqual([])
    expect(checks).toEqual([])
})

test("Fix flags the first wrong step with a squiggle and one line, without touching the text", async ({ page }) => {
    await startWriting(page, "sk_check")
    await slowSidekick(page)
    await typeLines(page, ["2x + 3 = 7", "2x = 5", "x = 2.5"])

    await runFromMenu(page, "Fix")
    await expect(thinking(page)).toBeVisible()

    const row = problemRow(page)
    await expect(row).toContainText("This step doesn't follow from the line above.")
    await expect(row).toContainText("x = 2") // why, in terms of this derivation
    await expect(squiggle(page)).toHaveText("2x = 5")
    await expect(page.locator('[data-block-index="0"][data-flagged]')).toHaveCount(1) // the "!" in the margin
    expect(await blockSource(page)).toBe("2x + 3 = 7\n2x = 5\nx = 2.5")
    expect(await editorFocused(page)).toBe(true)

    // Esc closes the line and removes the squiggle, and leaves the editor focused
    await page.keyboard.press("Escape")
    await expect(row).toHaveCount(0)
    await expect(squiggle(page)).toHaveCount(0)
    await expect(page.locator("[data-flagged]")).toHaveCount(0)
    expect(await editorFocused(page)).toBe(true)
})

test("the Fix button shows the corrected step as a ghost; Tab replaces just that step", async ({ page }) => {
    await startWriting(page, "sk_check_use")
    await page.keyboard.type("$$")
    await typeLines(page, ["", "2x + 3 = 7", "2x = 5", "x = 2.5", "$$"])

    await runFromMenu(page, "Fix")
    await expect(problemRow(page)).toContainText("This step doesn't follow from the line above.")
    expect(await blockSource(page)).toBe("$$\n2x + 3 = 7\n2x = 5\nx = 2.5\n$$")

    await page.getByTestId("sidekick-fix").click()
    await expect(ghost(page)).toBeVisible()
    await expect(ghost(page)).toContainText("Suggested fix")
    await expect(ghostPreview(page).locator("annotation")).toContainText("2x = 4")
    expect(await blockSource(page)).toBe("$$\n2x + 3 = 7\n2x = 5\nx = 2.5\n$$") // not yet

    await page.keyboard.press("Tab")
    expect(await blockSource(page)).toBe("$$\n2x + 3 = 7\n2x = 4\nx = 2.5\n$$")
    await expect(problemRow(page)).toHaveCount(0)
})

test("Fix says so when every step follows", async ({ page }) => {
    await startWriting(page, "sk_check_ok")
    await typeLines(page, ["x = 1", "__ok__"])
    await runFromMenu(page, "Fix")
    await expect(page.getByTestId("sidekick-clean")).toContainText("Every step follows")
    await expect(squiggle(page)).toHaveCount(0)
})

test("editing the flagged step removes the squiggle and the stale line", async ({ page }) => {
    await startWriting(page, "sk_check_edit")
    await typeLines(page, ["2x + 3 = 7", "x = 3"])
    await runFromMenu(page, "Fix")
    await expect(squiggle(page)).toHaveText("x = 3")

    await page.keyboard.type("!") // the caret is at the end of the flagged step
    await expect(squiggle(page)).toHaveCount(0)
    await expect(problemRow(page)).toHaveCount(0)
    await expect(page.getByTestId("sidekick-fix")).toHaveCount(0)
})

test("Next step is one dashed ghost block under the block, typeset, accepted with Tab", async ({ page }) => {
    await startWriting(page, "sk_next")
    await slowSidekick(page)
    await typeLines(page, ["2x + 3 = 7", "2x = 6"])

    await runFromMenu(page, "Next step")
    await expect(thinking(page)).toBeVisible()
    await expect(ghost(page)).toBeVisible()
    await expect(ghost(page)).toContainText("Suggested next step")
    await expect(ghostPreview(page).locator("annotation")).toHaveText("x = 3") // exactly one step
    await expect(ghost(page)).toContainText("Divide both sides by")
    expect(await blockSource(page)).toBe("2x + 3 = 7\n2x = 6")
    await shot(page, "next-1-ghost")

    await page.keyboard.press("Tab")
    expect(await blockSource(page)).toBe("2x + 3 = 7\n2x = 6\nx = 3")
    await expect(ghost(page)).toHaveCount(0)
})

test("the next step goes inside the $$ block, before the closing line", async ({ page }) => {
    await startWriting(page, "sk_next_block")
    await page.keyboard.type("$$")
    await typeLines(page, ["", "2x = 6", "$$"])
    await page.keyboard.press("ArrowUp") // the caret is somewhere in the block, not at the end of a step

    await runFromMenu(page, "Next step")
    await expect(ghost(page)).toBeVisible()
    await page.keyboard.press("Tab")
    expect(await blockSource(page)).toBe("$$\n2x = 6\nx = 3\n$$")
})

test("a finished derivation gets a quiet note, not a made-up step", async ({ page }) => {
    await startWriting(page, "sk_next_done")
    await typeLines(page, ["x = 3", "__done__"])
    await runFromMenu(page, "Next step")
    await expect(noticeRow(page)).toContainText(/already reached/i)
    await expect(ghost(page)).toHaveCount(0)
})

test("the maths helpers show a calm busy note in place, and change nothing", async ({ page }) => {
    await startWriting(page, "sk_math_busy")
    await typeLines(page, ["a = 1", "__busy__"])
    await runFromMenu(page, "Fix")
    await expect(noticeRow(page)).toContainText(/busy.*try again in 20s/i)
    expect(await blockSource(page)).toBe("a = 1\n__busy__")
})

test("an empty block asks for steps instead of sending anything", async ({ page }) => {
    await startWriting(page, "sk_math_empty")
    const requests = requestsTo(page, "/sidekick/check")
    await runFromMenu(page, "Fix")
    await expect(noticeRow(page)).toContainText(/Write the steps/)
    await page.waitForTimeout(400)
    expect(requests).toEqual([])
})
