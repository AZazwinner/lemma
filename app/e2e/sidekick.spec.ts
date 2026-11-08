import { expect, test } from "@playwright/test"
import {
    allBlockSources,
    blockSource,
    editorFocused,
    explanationCard,
    ghost,
    ghostPreview,
    isRightBelow,
    noticeRow,
    openSidekickMenu,
    runFromMenu,
    shot,
    sidekickButton,
    sidekickPanel,
    slowSidekick,
    startWriting,
    thinking,
    writeFromDescription,
} from "./sidekick-helpers"

// These run against a backend started with SIDEKICK_MOCK=1: canned answers, no AI calls, no quota.
const INTEGRAL = "\\int_0^1 x^2 \\, dx"

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

test("the sparkle has a tooltip, and its menu lists the four actions and a description field", async ({ page }) => {
    await startWriting(page, "sk_menu")
    await page.keyboard.type("x^2 = 4")

    await sidekickButton(page).hover()
    await expect(page.getByRole("tooltip", { name: "Sidekick" })).toBeVisible()

    await sidekickButton(page).click()
    const panel = sidekickPanel(page)
    for (const action of ["Explain", "Fix", "Next step", "Rewrite"]) {
        await expect(panel.getByRole("button", { name: new RegExp(`^${action}`) })).toBeEnabled()
    }
    await expect(panel.getByText("Write from description")).toBeVisible()
    await expect(page.getByTestId("sidekick-write-input")).toBeVisible()
    // opening it did not move the caret
    expect(await editorFocused(page)).toBe(true)
})

test("Rewrite shows a ghost block under the block, which is not in the document until accepted with Tab", async ({ page }) => {
    await startWriting(page, "sk_tab")
    await slowSidekick(page)
    await page.keyboard.type("integral of x squared from 0 to 1")

    await runFromMenu(page, "Rewrite")
    // "Thinking…" appears where the answer will go, then is replaced by the ghost
    await expect(thinking(page)).toBeVisible()
    await expect(ghost(page)).toBeVisible()
    await expect(thinking(page)).toHaveCount(0)

    // the ghost is typeset, sits right under the block, and says what it is and how to use it
    await expect(ghostPreview(page).locator("annotation")).toContainText(INTEGRAL)
    await expect(ghostPreview(page).locator(".katex")).toBeVisible()
    await expect(ghost(page)).toContainText("Suggested rewrite")
    await expect(ghost(page).getByTestId("sidekick-accept")).toContainText("Tab")
    await expect(ghost(page).getByTestId("sidekick-dismiss")).toContainText("Esc")
    expect(await isRightBelow(ghost(page), page.locator('[data-block-index="0"]'))).toBe(true)

    expect(await blockSource(page)).toBe("integral of x squared from 0 to 1")
    expect(await editorFocused(page)).toBe(true)

    await page.keyboard.press("Tab")
    await expect(ghost(page)).toHaveCount(0)
    expect(await blockSource(page)).toBe(`$$\n${INTEGRAL}\n$$`)
    expect(await editorFocused(page)).toBe(true)
})

test("Esc dismisses a suggestion and leaves the text and the caret alone", async ({ page }) => {
    await startWriting(page, "sk_esc")
    await page.keyboard.type("the sum of the first n numbers")

    await runFromMenu(page, "Rewrite")
    await expect(ghost(page)).toBeVisible()

    await page.keyboard.press("Escape")
    await expect(ghost(page)).toHaveCount(0)
    expect(await editorFocused(page)).toBe(true)
    expect(await blockSource(page)).toBe("the sum of the first n numbers")

    await page.keyboard.type("!")
    expect(await blockSource(page)).toBe("the sum of the first n numbers!")
})

test("the Accept and Dismiss buttons work with the mouse and do not move the focus", async ({ page }) => {
    await startWriting(page, "sk_click")
    await page.keyboard.type("quadratic formula")

    await runFromMenu(page, "Rewrite")
    await ghost(page).getByTestId("sidekick-dismiss").click()
    await expect(ghost(page)).toHaveCount(0)
    expect(await blockSource(page)).toBe("quadratic formula")
    expect(await editorFocused(page)).toBe(true)

    await runFromMenu(page, "Rewrite")
    await ghost(page).getByTestId("sidekick-accept").click()
    expect(await blockSource(page)).toBe("$$\nx = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\n$$")
    expect(await editorFocused(page)).toBe(true)
})

test("a selection becomes inline math in place, shown in its block before it is accepted", async ({ page }) => {
    await startWriting(page, "sk_selection")
    await page.keyboard.type("we compute the derivative here")
    for (let i = 0; i < " here".length; i++) await page.keyboard.press("ArrowLeft")
    await page.keyboard.down("Shift")
    for (let i = 0; i < "derivative".length; i++) await page.keyboard.press("ArrowLeft")
    await page.keyboard.up("Shift")

    await runFromMenu(page, "Rewrite")
    await expect(ghost(page)).toBeVisible()
    // the ghost shows the block as it would read, with the equation typeset in the sentence
    await expect(ghostPreview(page)).toContainText("we compute the")
    await expect(ghostPreview(page).locator("annotation")).toContainText("\\frac{d}{dx} x^3 = 3x^2")
    expect(await blockSource(page)).toBe("we compute the derivative here")

    await page.keyboard.press("Tab")
    expect(await blockSource(page)).toBe("we compute the $\\frac{d}{dx} x^3 = 3x^2$ here")
})

test("an @sidekick line runs on Ctrl+Enter, and the hint steps aside while the answer shows", async ({ page }) => {
    await startWriting(page, "sk_mention")
    await page.keyboard.type("@sidekick integral of x squared")

    const hint = page.locator('[data-sidekick-ghost="hint"]')
    await expect(hint).toBeVisible()
    await page.keyboard.press("Control+Enter")
    await expect(ghost(page)).toBeVisible()
    await expect(ghost(page)).toContainText("Suggested text")
    await expect(ghostPreview(page).locator("annotation")).toContainText(INTEGRAL)
    await expect(hint).toHaveCount(0)
    expect(await blockSource(page)).toBe("@sidekick integral of x squared")

    await page.keyboard.press("Tab")
    expect(await blockSource(page)).toBe(`$$\n${INTEGRAL}\n$$`)
})

test("the Sidekick slash command starts an @sidekick line, and /ai finds it too", async ({ page }) => {
    await startWriting(page, "sk_slash")
    await page.keyboard.type("/")
    await page.getByRole("button", { name: /Sidekick Describe what to write/ }).click()
    expect(await blockSource(page)).toBe("@sidekick ")
    await page.keyboard.type("sum")
    await page.keyboard.press("Control+Enter")
    await expect(ghostPreview(page).locator("annotation")).toContainText("\\sum_{k=1}^{n}")

    // /ai is another name for it
    await page.keyboard.press("Escape")
    await page.keyboard.press("Control+A")
    await page.keyboard.press("Delete")
    await page.keyboard.type("/ai")
    await expect(page.getByRole("button", { name: /Sidekick Describe what to write/ })).toBeVisible()
    await page.keyboard.press("Enter")
    expect(await blockSource(page)).toBe("@sidekick ")
})

test("the menu field and an @sidekick line go through the same code, so they give the same answer", async ({ page }) => {
    await startWriting(page, "sk_same")
    await page.keyboard.type("@sidekick integral of x squared")
    await page.keyboard.press("Control+Enter")
    await expect(ghostPreview(page).locator("annotation")).toContainText(INTEGRAL)
    await page.keyboard.press("Escape")
    await expect(ghost(page)).toHaveCount(0)

    await page.keyboard.press("Control+A")
    await page.keyboard.press("Delete")
    await openSidekickMenu(page)
    await page.getByTestId("sidekick-write-input").fill("integral of x squared")
    await page.getByTestId("sidekick-write-input").press("Enter")
    await expect(ghostPreview(page).locator("annotation")).toContainText(INTEGRAL)
    await expect(ghost(page)).toContainText("Suggested text")
    // the block is empty, so the text goes into it when accepted
    await ghost(page).getByTestId("sidekick-accept").click()
    expect(await allBlockSources(page)).toEqual([`$$\n${INTEGRAL}\n$$`])
})

test("a busy answer is a calm note right under the block, and nothing changes in the document", async ({ page }) => {
    await startWriting(page, "sk_busy")
    await page.keyboard.type("please __busy__")

    await runFromMenu(page, "Rewrite")

    await expect(noticeRow(page)).toContainText(/busy.*try again in 20s/i)
    expect(await isRightBelow(noticeRow(page), page.locator('[data-block-index="0"]'))).toBe(true)
    await expect(ghost(page)).toHaveCount(0)
    expect(await blockSource(page)).toBe("please __busy__")
    expect(await editorFocused(page)).toBe(true)

    // it can be dismissed, and Esc does too
    await noticeRow(page).getByRole("button", { name: "Dismiss" }).click()
    await expect(noticeRow(page)).toHaveCount(0)
})

test("when the sidekick is switched off the message is calm and in the same place", async ({ page }) => {
    await startWriting(page, "sk_off")
    await page.keyboard.type("x^2 + y^2 = z^2")
    await page.route("**/sidekick/explain", (route) =>
        route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: { code: "disabled" } }) })
    )

    await runFromMenu(page, "Explain")
    await expect(noticeRow(page)).toContainText("Sidekick is switched off on this server.")
    expect(await isRightBelow(noticeRow(page), page.locator('[data-block-index="0"]'))).toBe(true)
    expect(await blockSource(page)).toBe("x^2 + y^2 = z^2")
})

test("a backend older than the page gets a calm note, not a crash", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await startWriting(page, "sk_outdated")
    await page.keyboard.type("x^2 + y^2 = z^2")

    // an older backend answers Explain as a summary and steps, with no text
    await page.route("**/sidekick/explain", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ summary: "It squares x.", steps: ["Take x."], cached: false, mock: false }),
        })
    )
    await runFromMenu(page, "Explain")
    await expect(noticeRow(page)).toContainText("older version of the sidekick")
    await expect(explanationCard(page)).toHaveCount(0)
    expect(await isRightBelow(noticeRow(page), page.locator('[data-block-index="0"]'))).toBe(true)

    // and one that has no write endpoint yet
    await noticeRow(page).getByRole("button", { name: "Dismiss" }).click()
    await page.route("**/sidekick/write", (route) => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "Not Found" }) }))
    await page.keyboard.press("Control+A")
    await page.keyboard.press("Delete")
    await writeFromDescription(page, "a proof that there are infinitely many primes")
    await expect(noticeRow(page)).toContainText("older version of the sidekick")

    // the editor is still there, and nothing threw
    expect(await allBlockSources(page)).toEqual([""])
    expect(errors).toEqual([])
})

test("typing while the sidekick is thinking drops its answer instead of interrupting", async ({ page }) => {
    await startWriting(page, "sk_typing")
    await slowSidekick(page)
    await page.keyboard.type("integral of x squared")

    await runFromMenu(page, "Rewrite")
    await page.keyboard.type("!")
    await page.waitForTimeout(1200)

    await expect(ghost(page)).toHaveCount(0)
    await expect(thinking(page)).toHaveCount(0)
    expect(await blockSource(page)).toBe("integral of x squared!")
    expect(await editorFocused(page)).toBe(true)
})

test("Explain is a card right under the block, typeset, and dismissing it or inserting it as a note is an explicit click", async ({ page }) => {
    await startWriting(page, "sk_explain")
    await page.keyboard.type("$$x^2 + y^2 = z^2$$")

    await runFromMenu(page, "Explain")
    const card = explanationCard(page)
    await expect(card).toBeVisible()
    // specific to this equation, with its maths typeset (no raw dollar signs)
    await expect(card).toContainText("Pythagorean")
    await expect(card.locator(".katex").first()).toBeVisible()
    expect(await card.innerText()).not.toContain("$")
    expect(await isRightBelow(card, page.locator('[data-block-index="0"]'))).toBe(true)
    expect(await blockSource(page)).toBe("$$x^2 + y^2 = z^2$$")
    await expect(sidekickPanel(page)).toHaveCount(0) // not a floating popup

    // Esc closes it and the editor keeps the focus
    await page.keyboard.press("Escape")
    await expect(card).toHaveCount(0)
    expect(await editorFocused(page)).toBe(true)

    // "Insert as note" adds the explanation to the document as a paragraph after the block, and only when clicked
    await runFromMenu(page, "Explain")
    await expect(card).toBeVisible()
    expect(await allBlockSources(page)).toEqual(["$$x^2 + y^2 = z^2$$"])
    await card.getByRole("button", { name: "Insert as note" }).click()
    await expect(card).toHaveCount(0)
    const blocks = await allBlockSources(page)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toBe("$$x^2 + y^2 = z^2$$")
    expect(blocks[1]).toContain("This is the Pythagorean relation")
    expect(blocks[1]).toContain("$x$")
})

test("an empty block gets a calm hint, not a request", async ({ page }) => {
    await startWriting(page, "sk_empty")
    await runFromMenu(page, "Rewrite")
    await expect(noticeRow(page)).toContainText(/description/i)
    await expect(ghost(page)).toHaveCount(0)
})

test("the sidekick follows the dark theme", async ({ page }) => {
    await startWriting(page, "sk_dark")
    await page.keyboard.type("x^2 + y^2 = z^2")
    await page.evaluate(() => document.documentElement.classList.add("dark"))
    await runFromMenu(page, "Explain")
    await expect(explanationCard(page)).toBeVisible()
    // the card uses the theme's own tokens, so it is not the light-theme grey on a dark page
    const token = (name: string, property: "backgroundColor" | "color") =>
        page.evaluate(
            ([variable, prop]) => {
                const probe = document.createElement("span")
                probe.style[prop as "color"] = `var(${variable})`
                document.body.append(probe)
                const value = getComputedStyle(probe)[prop as "color"]
                probe.remove()
                return value
            },
            [name, property] as const
        )
    const card = explanationCard(page)
    await shot(page, "dark-explanation")
    expect(await card.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await token("--tint", "backgroundColor"))
    expect(await card.locator("h3").evaluate((el) => getComputedStyle(el).color)).toBe(await token("--ink-soft", "color"))
    expect(await token("--tint", "backgroundColor")).not.toBe("rgb(238, 240, 242)") // the dark tint, not the light one
})
