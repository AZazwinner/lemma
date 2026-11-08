import { expect, test } from "@playwright/test"
import { focusBlock, signUp } from "./helpers"
import {
    allBlockSources,
    blockSource,
    editorFocused,
    explanationCard,
    ghost,
    ghostPreview,
    isRightBelow,
    openNewDoc,
    openSidekickMenu,
    problemRow,
    runFromMenu,
    selectionToolbar,
    shot,
    sidekickButton,
    sidekickPanel,
    skipUnlessMock,
    slowSidekick,
    squiggle,
    startWriting,
    thinking,
    typeLines,
    writeFromDescription,
} from "./sidekick-helpers"

// The sidekick as part of the document: answers appear inline under the block they are about, not in a floating popup.
// Run against a backend started with SIDEKICK_MOCK=1: canned answers, no AI calls, no quota.

const block = (page: import("@playwright/test").Page, index: number) => page.locator(`[data-block-index="${index}"]`)

test("select a block, press Explain: a card appears right under it, with its maths typeset", async ({ page }) => {
    await startWriting(page, "sk_inl_explain")
    // (labelled, so the page numbers it: an equation nobody asked a number for would not have one)
    await typeLines(page, ["$$", "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a} \\label{quad}", "$$"])
    await page.keyboard.press("Enter")
    await page.keyboard.type("A later paragraph.")
    await expect(block(page, 0).locator(".katex-display")).toBeVisible() // the first block is typeset now
    await expect(block(page, 0).locator(".katex-display")).toHaveAttribute("data-eqnum", "1")

    // select the block as a whole, by dragging across it
    const box = (await block(page, 0).boundingBox())!
    await page.mouse.move(box.x + 80, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 160, box.y + box.height / 2, { steps: 6 })
    await page.mouse.up()

    // a small toolbar with the four labelled actions, next to the selection
    const toolbar = selectionToolbar(page)
    await expect(toolbar).toBeVisible()
    await expect(toolbar.getByRole("button")).toHaveText(["Explain", "Fix", "Next step", "Rewrite"])
    await shot(page, "explain-1-block-selected")

    await toolbar.getByRole("button", { name: "Explain" }).click()
    const card = explanationCard(page)
    await expect(card).toBeVisible()
    await shot(page, "explain-2-card")

    // titled with the equation's number, with the sparkle, directly below the block it explains
    await expect(card.locator("h3")).toHaveText("Explanation of (1)")
    await expect(card.locator("svg").first()).toBeVisible()
    expect(await isRightBelow(card, block(page, 0), 24)).toBe(true)
    expect(await card.evaluate((el) => getComputedStyle(el).position)).toBe("static") // in the page, not floating

    // short text with the maths typeset: no raw LaTeX or dollar signs, and no scrolling box
    await expect(card.locator(".katex").first()).toBeVisible()
    const text = await card.innerText()
    expect(text).not.toMatch(/\$|\\frac|\\pm|\\sqrt/)
    await expect(card).toContainText("quadratic formula")
    expect(await card.evaluate((el) => [...el.querySelectorAll("*")].some((n) => getComputedStyle(n).overflowY === "scroll" || getComputedStyle(n).overflowY === "auto"))).toBe(false)

    // there is no floating popup, the toolbar steps aside, and the document is untouched
    await expect(sidekickPanel(page)).toHaveCount(0)
    await expect(toolbar).toHaveCount(0)
    expect(await allBlockSources(page)).toEqual(["$$\nx = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a} \\label{quad}\n$$", "A later paragraph."])

    // the small x dismisses it
    await card.getByRole("button", { name: "Dismiss explanation" }).click()
    await expect(card).toHaveCount(0)
})

test("selecting text shows the toolbar next to it, and using it does not move the caret or the selection", async ({ page }) => {
    await startWriting(page, "sk_inl_toolbar")
    await page.keyboard.type("x^2 + y^2 = z^2")
    await expect(selectionToolbar(page)).toHaveCount(0) // a caret alone shows nothing

    await page.keyboard.press("Control+A")
    const toolbar = selectionToolbar(page)
    await expect(toolbar).toBeVisible()
    // next to the selection: just above the block's text
    const [bar, line] = await Promise.all([toolbar.boundingBox(), page.locator('[data-block-index="0"] .cm-line').boundingBox()])
    expect(Math.abs(bar!.y + bar!.height - line!.y)).toBeLessThan(60)

    await toolbar.getByRole("button", { name: "Explain" }).click()
    await expect(explanationCard(page)).toBeVisible()
    expect(await editorFocused(page)).toBe(true)
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("x^2 + y^2 = z^2")
    expect(await blockSource(page)).toBe("x^2 + y^2 = z^2")

    // moving the caret takes it away
    await page.keyboard.press("ArrowRight")
    await expect(selectionToolbar(page)).toHaveCount(0)
})

test("a squiggle under the step that doesn't follow, then Fix shows a ghost block, and Tab accepts it", async ({ page }) => {
    await startWriting(page, "sk_inl_fix")
    await slowSidekick(page)
    await typeLines(page, ["2x + 3 = 7", "x = 2", "x = 3"])
    await page.keyboard.press("Control+A")
    await shot(page, "fix-0-selected")

    await selectionToolbar(page).getByRole("button", { name: "Fix" }).click()
    await expect(thinking(page)).toBeVisible() // "Thinking…" where the answer will appear

    // the squiggle under the line, and one line saying so, with a Fix button beside it
    const row = problemRow(page)
    await expect(row).toContainText("This step doesn't follow from the line above.")
    await expect(squiggle(page)).toHaveText("x = 3")
    await expect(page.locator('[data-block-index="0"][data-flagged]')).toHaveCount(1) // the "!" in the margin
    const fix = row.getByRole("button", { name: "Fix" })
    await expect(fix).toBeVisible()
    const [rowBox, fixBox] = await Promise.all([row.boundingBox(), fix.boundingBox()])
    expect(fixBox!.y).toBeGreaterThanOrEqual(rowBox!.y - 4)
    expect(fixBox!.y + fixBox!.height).toBeLessThanOrEqual(rowBox!.y + rowBox!.height + 4)
    expect(await isRightBelow(row, block(page, 0), 24)).toBe(true)
    expect(await blockSource(page)).toBe("2x + 3 = 7\nx = 2\nx = 3")
    await shot(page, "fix-1-error-line")

    // Fix shows the proposed fix as a ghost block; nothing has changed yet
    await fix.click()
    await expect(ghost(page)).toBeVisible()
    await expect(ghost(page)).toContainText("Suggested fix")
    await expect(ghost(page).getByTestId("sidekick-accept")).toContainText("Tab")
    await expect(ghost(page).getByTestId("sidekick-dismiss")).toContainText("Esc")
    await expect(ghostPreview(page)).toContainText("x = 2")
    expect(await blockSource(page)).toBe("2x + 3 = 7\nx = 2\nx = 3")
    expect(await editorFocused(page)).toBe(true)
    await shot(page, "fix-2-ghost")

    await page.keyboard.press("Tab")
    expect(await blockSource(page)).toBe("2x + 3 = 7\nx = 2\nx = 2")
    await expect(ghost(page)).toHaveCount(0)
    await expect(row).toHaveCount(0)
    await expect(squiggle(page)).toHaveCount(0)
    expect(await editorFocused(page)).toBe(true)
    await shot(page, "fix-3-accepted")
})

test("the squiggle follows the step into the typeset text when the editor is left, and the margin keeps its mark", async ({ page }) => {
    await startWriting(page, "sk_inl_typeset")
    await typeLines(page, ["2x + 3 = 7", "x = 2", "x = 3"])
    await runFromMenu(page, "Fix")
    await expect(squiggle(page)).toHaveText("x = 3")

    // clicking away from the block leaves its editor: the block is drawn typeset, and the line stays under it
    await page.getByLabel("Document title").click()
    await expect(page.locator('[data-block-index="0"] > div.cursor-text')).toBeVisible()
    await expect(problemRow(page)).toBeVisible()
    await expect(page.locator('[data-block-index="0"][data-flagged]')).toHaveCount(1)
    await expect.poll(() => page.evaluate(() => CSS.highlights.get("sidekick-flag")?.size ?? 0)).toBe(1)
    expect(await page.evaluate(() => [...(CSS.highlights.get("sidekick-flag") ?? [])].map((range) => range.toString()))).toEqual(["x = 3"])
    await shot(page, "fix-4-squiggle-in-typeset-text")

    // dismissing the line takes the squiggle with it
    await problemRow(page).getByRole("button", { name: "Dismiss" }).click()
    await expect.poll(() => page.evaluate(() => CSS.highlights.get("sidekick-flag")?.size ?? 0)).toBe(0)
})

test("an inserted proof shows rendered maths, not raw delimiters", async ({ page }) => {
    await startWriting(page, "sk_inl_proof")
    await slowSidekick(page)
    await page.keyboard.type("Notes on primes")

    await writeFromDescription(page, "a proof that there are infinitely many primes")
    await expect(thinking(page)).toBeVisible()
    await expect(ghost(page)).toBeVisible()
    await shot(page, "proof-1-ghost")

    // the ghost already shows it typeset: the sets of primes, the product, the divisibility
    const preview = ghostPreview(page)
    expect(await preview.locator(".katex").count()).toBeGreaterThanOrEqual(8)
    const ghostText = await preview.innerText()
    expect(ghostText).toContain("Suppose, for contradiction")
    expect(ghostText).not.toMatch(/\$|\\\[|\\\(|\\\]|\\\)|\\boxed|\\mid|\\cdots/)
    expect(await allBlockSources(page)).toEqual(["Notes on primes"]) // nothing is written yet

    await ghost(page).getByTestId("sidekick-accept").click()
    await expect(ghost(page)).toHaveCount(0)
    await page.keyboard.press("Escape") // leave the editor, so every block is shown typeset

    // it went into the document as blocks, with the displayed equations as blocks of their own...
    const sources = await allBlockSources(page)
    expect(sources[0]).toBe("Notes on primes")
    expect(sources.length).toBeGreaterThanOrEqual(7)
    expect(sources.filter((s) => s.startsWith("$$\n") && s.endsWith("\n$$"))).toHaveLength(2)
    // ...and what the writer sees is typeset maths with no delimiters left over, and no equation numbers: nothing in a
    // proof like this is labelled or cited, so none of its equations asks for one
    const doc = page.locator(".editor-doc")
    expect(await doc.locator(".katex").count()).toBeGreaterThanOrEqual(8)
    await expect(doc.locator(".katex-display")).toHaveCount(2)
    await expect(doc.locator("[data-eqnum]")).toHaveCount(0)
    // (each block also holds a hidden editor with its source; the typeset layer is what is on screen)
    const visible = (await page.locator("[data-block-index] > div.cursor-text").allInnerTexts()).join("\n")
    expect(visible).not.toMatch(/\$|\\\[|\\\(|\\\]|\\\)|\\boxed/)
    expect(visible).toContain("There are infinitely many prime numbers.")
    await shot(page, "proof-2-inserted")
})

test("an answer stays under its own block: it moves with it, and goes if the block is deleted", async ({ page }) => {
    await startWriting(page, "sk_inl_anchor")
    await page.keyboard.type("Intro")
    await page.keyboard.press("Enter")
    await typeLines(page, ["$$", "x^2 + y^2 = z^2", "$$"])

    await runFromMenu(page, "Explain")
    const card = explanationCard(page)
    await expect(card).toBeVisible()
    expect(await isRightBelow(card, block(page, 1), 24)).toBe(true)
    // this equation has no number in the margin, so the card does not claim one
    await expect(card.locator("h3")).toHaveText("Explanation")

    // a block is added above it: the card goes down with its block
    await focusBlock(page, 0)
    await page.keyboard.press("Control+End")
    await page.keyboard.press("Enter")
    await expect(page.locator("[data-block-index]")).toHaveCount(3)
    await expect(card).toBeVisible()
    expect(await isRightBelow(card, block(page, 2), 24)).toBe(true)

    // the block is deleted (merged away): its card goes with it
    await focusBlock(page, 2)
    await page.keyboard.press("Control+Home")
    await page.keyboard.press("Backspace")
    await expect(page.locator("[data-block-index]")).toHaveCount(2)
    await expect(card).toHaveCount(0)
})

test("a long explanation folds to a few lines with Show more", async ({ page }) => {
    await startWriting(page, "sk_inl_more")
    await page.keyboard.type("E = \\frac{1}{2} m v^2 + \\frac{q_1 q_2}{4\\pi\\epsilon_0 r}")
    await runFromMenu(page, "Explain")
    const card = explanationCard(page)
    await expect(card).toBeVisible()

    const more = page.getByTestId("sidekick-show-more")
    await expect(more).toHaveText("Show more")
    const folded = (await card.boundingBox())!.height
    expect(folded).toBeLessThan(190)

    await more.click()
    await expect(more).toHaveText("Show less")
    await expect(more).toHaveAttribute("aria-expanded", "true")
    await expect.poll(async () => (await card.boundingBox())!.height).toBeGreaterThan(folded + 20)

    await more.click()
    await expect(more).toHaveText("Show more")
})

test("nothing the sidekick shows is saved: after a reload the document is as it was", async ({ page }) => {
    await startWriting(page, "sk_inl_saved")
    await page.keyboard.type("quadratic formula")
    await runFromMenu(page, "Rewrite")
    await expect(ghost(page)).toBeVisible()
    await page.keyboard.press("Escape") // dismiss, then ask again so a suggestion is showing at the reload
    await runFromMenu(page, "Explain")
    await expect(explanationCard(page)).toBeVisible()
    await page.waitForTimeout(1500) // let any autosave run

    await page.reload({ waitUntil: "networkidle" })
    await expect(page.locator("[data-block-index]").first()).toBeVisible()
    await page.waitForTimeout(800)
    await expect(ghost(page)).toHaveCount(0)
    await expect(explanationCard(page)).toHaveCount(0)
    expect(await allBlockSources(page)).toEqual(["quadratic formula"])
})

test("when the server has the sidekick switched off, the icon says so calmly and no toolbar appears", async ({ page }) => {
    await signUp(page, "sk_inl_off")
    await skipUnlessMock(page)
    await page.route("**/sidekick/status", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ enabled: false, mock: false, used_today: 0, daily_budget: 200, user_per_minute: 5, features: [] }),
        })
    )
    await openNewDoc(page)
    await focusBlock(page)
    await page.keyboard.type("x = 1")
    await page.keyboard.press("Control+A")
    await expect(selectionToolbar(page)).toHaveCount(0)

    await sidekickButton(page).click()
    await expect(page.getByTestId("sidekick-off")).toHaveText("Sidekick is switched off on this server.")
    await expect(sidekickPanel(page).getByRole("button")).toHaveCount(0)
})

test("the menu action works on the block you were in even after the focus has moved into the menu", async ({ page }) => {
    await startWriting(page, "sk_inl_menu")
    await page.keyboard.type("x^2 + y^2 = z^2")
    await openSidekickMenu(page)
    await shot(page, "menu-open")
    await page.getByTestId("sidekick-write-input").click() // the writer clicked into the field: this is the only thing that moves focus
    expect(await editorFocused(page)).toBe(false)

    await sidekickPanel(page).getByRole("button", { name: /^Explain/ }).click()
    await expect(explanationCard(page)).toBeVisible()
    expect(await isRightBelow(explanationCard(page), block(page, 0), 24)).toBe(true)
})
