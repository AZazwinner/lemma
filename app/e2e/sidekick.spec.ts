import { expect, test } from "@playwright/test"
import { blockSource, ghost, openSidekickMenu, sidekickButton, sidekickPanel, startWriting } from "./sidekick-helpers"

// These run against a backend started with SIDEKICK_MOCK=1: canned answers, no Google calls, no quota.
const INTEGRAL = "\\int_0^1 x^2 \\, dx"
const editorFocused = (page: import("@playwright/test").Page) =>
    page.evaluate(() => document.activeElement?.classList.contains("cm-content") ?? false)

test("the sidekick is a small collapsed icon, and opening it does not take focus from the editor", async ({ page }) => {
    await startWriting(page, "sk_collapsed")
    await page.keyboard.type("integral of x squared from 0 to 1")

    await expect(sidekickButton(page)).toBeVisible()
    await expect(sidekickPanel(page)).toHaveCount(0)

    await sidekickButton(page).click()
    await expect(sidekickPanel(page)).toBeVisible()
    expect(await editorFocused(page)).toBe(true)

    // the writer can keep typing straight away
    await page.keyboard.type("!")
    expect(await blockSource(page)).toBe("integral of x squared from 0 to 1!")
})

test("Describe → LaTeX shows ghost text, which is not in the document until accepted with Tab", async ({ page }) => {
    await startWriting(page, "sk_tab")
    await page.keyboard.type("integral of x squared from 0 to 1")

    await openSidekickMenu(page)
    await page.getByRole("button", { name: /Describe → LaTeX/ }).click()

    await expect(ghost(page)).toContainText(INTEGRAL)
    expect(await blockSource(page)).toBe("integral of x squared from 0 to 1")
    expect(await editorFocused(page)).toBe(true)

    await page.keyboard.press("Tab")
    await expect(ghost(page)).toHaveCount(0)
    expect(await blockSource(page)).toBe(`$$\n${INTEGRAL}\n$$`)
})

test("Esc dismisses a suggestion and leaves the text and the caret alone", async ({ page }) => {
    await startWriting(page, "sk_esc")
    await page.keyboard.type("the sum of the first n numbers")

    await openSidekickMenu(page)
    await page.getByRole("button", { name: /Describe → LaTeX/ }).click()
    await expect(ghost(page)).toBeVisible()

    await page.keyboard.press("Escape")
    await expect(ghost(page)).toHaveCount(0)
    expect(await editorFocused(page)).toBe(true)
    expect(await blockSource(page)).toBe("the sum of the first n numbers")

    await page.keyboard.type("!")
    expect(await blockSource(page)).toBe("the sum of the first n numbers!")
})

test("clicking the ghost text accepts it", async ({ page }) => {
    await startWriting(page, "sk_click")
    await page.keyboard.type("quadratic formula")

    await openSidekickMenu(page)
    await page.getByRole("button", { name: /Describe → LaTeX/ }).click()
    await ghost(page).click()

    expect(await blockSource(page)).toBe("$$\nx = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\n$$")
})

test("a selection becomes inline math in place", async ({ page }) => {
    await startWriting(page, "sk_selection")
    await page.keyboard.type("we compute the derivative here")
    for (let i = 0; i < " here".length; i++) await page.keyboard.press("ArrowLeft")
    await page.keyboard.down("Shift")
    for (let i = 0; i < "derivative".length; i++) await page.keyboard.press("ArrowLeft")
    await page.keyboard.up("Shift")

    await openSidekickMenu(page)
    await page.getByRole("button", { name: /Describe → LaTeX/ }).click()
    await expect(ghost(page)).toBeVisible()
    await page.keyboard.press("Tab")

    expect(await blockSource(page)).toBe("we compute the $\\frac{d}{dx} x^3 = 3x^2$ here")
})

test("an @sidekick line runs on Ctrl+Enter and is replaced when accepted", async ({ page }) => {
    await startWriting(page, "sk_mention")
    await page.keyboard.type("@sidekick integral of x squared")

    await expect(page.locator('[data-sidekick-ghost="hint"]')).toBeVisible()
    await page.keyboard.press("Control+Enter")
    await expect(ghost(page)).toContainText(INTEGRAL)
    expect(await blockSource(page)).toBe("@sidekick integral of x squared")

    await page.keyboard.press("Tab")
    expect(await blockSource(page)).toBe(`$$\n${INTEGRAL}\n$$`)
})

test("the Sidekick slash command starts an @sidekick line", async ({ page }) => {
    await startWriting(page, "sk_slash")
    await page.keyboard.type("/")
    await page.getByRole("button", { name: /Sidekick Describe/ }).click()
    expect(await blockSource(page)).toBe("@sidekick ")
    await page.keyboard.type("sum")
    await page.keyboard.press("Control+Enter")
    await expect(ghost(page)).toContainText("\\sum_{k=1}^{n}")
})

test("a busy answer is a quiet note, and nothing changes in the document", async ({ page }) => {
    await startWriting(page, "sk_busy")
    await page.keyboard.type("please __busy__")

    await openSidekickMenu(page)
    await page.getByRole("button", { name: /Describe → LaTeX/ }).click()

    const notice = page.getByTestId("sidekick-notice")
    await expect(notice).toContainText(/busy.*try again in 20s/i)
    await expect(ghost(page)).toHaveCount(0)
    expect(await blockSource(page)).toBe("please __busy__")
    expect(await editorFocused(page)).toBe(true)
})

test("typing while the sidekick is thinking drops its answer instead of interrupting", async ({ page }) => {
    await startWriting(page, "sk_typing")
    await page.keyboard.type("integral of x squared")

    await openSidekickMenu(page)
    await page.getByRole("button", { name: /Describe → LaTeX/ }).click()
    await page.keyboard.type("!")
    await page.waitForTimeout(1200)

    await expect(ghost(page)).toHaveCount(0)
    expect(await blockSource(page)).toBe("integral of x squared!")
    expect(await editorFocused(page)).toBe(true)
})

test("Explain shows a small card; Esc closes it and Insert below is an explicit click", async ({ page }) => {
    await startWriting(page, "sk_explain")
    await page.keyboard.type("$$x^2 + y^2 = z^2$$")

    await openSidekickMenu(page)
    await page.getByRole("button", { name: /Explain this equation/ }).click()
    const card = page.getByTestId("sidekick-explanation")
    await expect(card.locator("li")).toHaveCount(3)
    expect(await blockSource(page)).toBe("$$x^2 + y^2 = z^2$$")

    await page.keyboard.press("Escape")
    await expect(sidekickPanel(page)).toHaveCount(0)
    expect(await editorFocused(page)).toBe(true)

    await openSidekickMenu(page)
    await page.getByRole("button", { name: /Explain this equation/ }).click()
    await expect(card.locator("li")).toHaveCount(3)
    await page.getByRole("button", { name: "Insert below" }).click()
    await expect(sidekickPanel(page)).toHaveCount(0)
    expect(await blockSource(page)).toContain("$$x^2 + y^2 = z^2$$\n\nThis is a sample explanation")
})

test("an empty block gets a calm hint, not a request", async ({ page }) => {
    await startWriting(page, "sk_empty")
    await openSidekickMenu(page)
    await page.getByRole("button", { name: /Describe → LaTeX/ }).click()
    await expect(page.getByTestId("sidekick-notice")).toContainText(/description/i)
    await expect(ghost(page)).toHaveCount(0)
})

test("the sidekick follows the dark theme", async ({ page }) => {
    await startWriting(page, "sk_dark")
    await page.keyboard.type("quadratic formula")
    await page.evaluate(() => document.documentElement.classList.add("dark"))
    await openSidekickMenu(page)
    await page.getByRole("button", { name: /Describe → LaTeX/ }).click()
    await expect(ghost(page)).toBeVisible()
    // the ghost uses the theme's muted colour, so it is not the light-theme grey on a dark page
    const color = await ghost(page).evaluate((el) => getComputedStyle(el).color)
    const dark = await page.evaluate(() => {
        const probe = document.createElement("span")
        probe.style.color = "var(--muted-foreground)"
        document.body.append(probe)
        const value = getComputedStyle(probe).color
        probe.remove()
        return value
    })
    expect(color).toBe(dark)
})
