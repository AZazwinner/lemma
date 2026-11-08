import { expect, test, type Page } from "@playwright/test"
import { focusBlock, signUp } from "./helpers"
import { editorFocused, openNewDoc, shot, typeLines } from "./sidekick-helpers"

// The Outline panel: the document's headings, and under them the equations that show a number in the margin. It reads the
// same value the margin does (lib/doc-outline.ts), so the two cannot disagree.

const toggle = (page: Page) => page.getByTestId("outline-toggle")
const panel = (page: Page) => page.getByTestId("outline-panel")
const drawer = (page: Page) => page.getByTestId("outline-drawer")
const headingRows = (page: Page) => page.getByTestId("outline-heading")
const equationRows = (page: Page) => page.getByTestId("outline-equation")
const scroller = (page: Page) => page.locator(".editor-desk")
const block = (page: Page, index: number) => page.locator(`[data-block-index="${index}"]`)

/** Types the blocks one after another (Enter starts the next block), then leaves the editor so every block is typeset. */
async function write(page: Page, blocks: string[][]) {
    for (const [i, lines] of blocks.entries()) {
        await typeLines(page, lines)
        if (i < blocks.length - 1) await page.keyboard.press("Enter")
    }
    await page.keyboard.press("Escape")
}

const display = (...lines: string[]) => ["$$", ...lines, "$$"]
const filler = (count: number, label: string) => Array.from({ length: count }, (_, i) => [`${label} paragraph ${i + 1}, with a few words in it.`])

async function startDoc(page: Page, prefix: string) {
    await signUp(page, prefix)
    await openNewDoc(page)
    await focusBlock(page)
}

/** The numbers the page margin draws, in order, read from what the browser paints ("(3)"). */
const marginDrawn = (page: Page) =>
    page.locator(".editor-doc .katex-display[data-eqnum]").evaluateAll((els) => els.map((el) => getComputedStyle(el, "::after").content.replace(/"/g, "")))

const outlineNumbers = (page: Page) => equationRows(page).evaluateAll((rows) => rows.map((row) => (row.textContent ?? "").match(/^\((\d+)\)/)?.[0] ?? ""))

test("the toggle opens the panel, and its state is remembered across reloads", async ({ page }) => {
    await signUp(page, "outline")
    await openNewDoc(page)

    await expect(panel(page)).toHaveCount(0)
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "false")

    await toggle(page).click()
    await expect(panel(page)).toBeVisible()
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "true")
    await expect(page.getByTestId("outline-empty")).toHaveText("Headings you add to the document will appear here.")

    await page.reload()
    await expect(panel(page)).toBeVisible() // open stays open

    await toggle(page).click()
    await expect(panel(page)).toHaveCount(0)
    await page.reload()
    await expect(toggle(page)).toBeVisible()
    await expect(panel(page)).toHaveCount(0) // and closed stays closed
})

test("lists the headings in order, indented by level, and updates as the writer types without losing what is collapsed", async ({ page }) => {
    await startDoc(page, "outline")
    await write(page, [["# Alpha"], ["Some intro text."], ["## Beta"], ["### Gamma"], ["# Delta"], ["A closing paragraph."]])
    await toggle(page).click()

    await expect(headingRows(page)).toHaveText(["Alpha", "Beta", "Gamma", "Delta"])
    await expect(headingRows(page)).toHaveCount(4)
    expect(await headingRows(page).evaluateAll((rows) => rows.map((r) => r.getAttribute("aria-level")))).toEqual(["1", "2", "3", "1"])
    const indent = await headingRows(page).evaluateAll((rows) => rows.map((r) => parseFloat(getComputedStyle(r).paddingLeft)))
    expect(indent[0]).toBeLessThan(indent[1])
    expect(indent[1]).toBeLessThan(indent[2])
    expect(indent[3]).toBe(indent[0])
    await shot(page, "outline-1-headings")

    // a chevron collapses the section under a heading
    const alpha = headingRows(page).nth(0)
    await expect(alpha).toHaveAttribute("aria-expanded", "true")
    await alpha.getByTestId("outline-chevron").click()
    await expect(alpha).toHaveAttribute("aria-expanded", "false")
    await expect(headingRows(page)).toHaveText(["Alpha", "Delta"])

    // the writer renames a heading: the outline follows, and Alpha is still collapsed
    await focusBlock(page, 4)
    await page.keyboard.press("End")
    await page.keyboard.type(" II")
    await expect(headingRows(page)).toHaveText(["Alpha", "Delta II"])
    await expect(headingRows(page).nth(0)).toHaveAttribute("aria-expanded", "false")

    // a new heading appears; the collapsed section is still collapsed
    await focusBlock(page, 5)
    await page.keyboard.press("Home")
    await page.keyboard.type("# ")
    await expect(headingRows(page)).toHaveText(["Alpha", "Delta II", "A closing paragraph."])
    await expect(headingRows(page).nth(0)).toHaveAttribute("aria-expanded", "false")
    await expect(headingRows(page).first().getByTestId("outline-chevron")).toBeVisible()
})

test("typing inside a paragraph does not touch the outline at all", async ({ page }) => {
    await startDoc(page, "outline")
    await write(page, [["# Alpha"], ["A paragraph."], ["## Beta"]])
    await toggle(page).click()
    await expect(headingRows(page)).toHaveText(["Alpha", "Beta"])

    await focusBlock(page, 1)
    await page.keyboard.press("End")
    await page.evaluate(() => {
        const w = window as unknown as { __mutations: number }
        w.__mutations = 0
        new MutationObserver((records) => {
            w.__mutations += records.length
        }).observe(document.querySelector('[data-testid="outline-body"]')!, { subtree: true, childList: true, attributes: true, characterData: true })
    })
    await page.keyboard.type(" and then some more words, typed a letter at a time.")
    await page.waitForTimeout(700) // past the pause the outline waits for before it looks again
    expect(await page.evaluate(() => (window as unknown as { __mutations: number }).__mutations)).toBe(0)
})

test("clicking a heading scrolls to it and flashes it; the current section follows the scroll and the cursor", async ({ page }) => {
    await startDoc(page, "outline")
    // Alpha is block 0, Beta 15, Gamma 30
    await write(page, [["# Alpha"], ...filler(14, "First"), ["## Beta"], ...filler(14, "Second"), ["# Gamma"], ...filler(14, "Third")])
    await toggle(page).click()
    await expect(headingRows(page)).toHaveText(["Alpha", "Beta", "Gamma"])

    await scroller(page).evaluate((el) => (el.scrollTop = 0))
    await expect(headingRows(page).nth(0)).toHaveAttribute("aria-current", "location")

    // go to Gamma: it scrolls there, lights up briefly, and is the current section when it arrives
    await headingRows(page).nth(2).click()
    await expect(block(page, 30).locator("h1")).toHaveClass(/mb-flash/)
    await expect.poll(() => scroller(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(500)
    await expect(headingRows(page).nth(2)).toHaveAttribute("aria-current", "location")
    await expect(block(page, 30).locator("h1")).not.toHaveClass(/mb-flash/) // the highlight is brief
    const top = await block(page, 30).locator("h1").evaluate((el) => el.getBoundingClientRect().top - document.querySelector(".editor-desk")!.getBoundingClientRect().top)
    expect(top).toBeGreaterThanOrEqual(0)
    expect(top).toBeLessThan(120)
    await shot(page, "outline-2-navigated")

    // scrolling back up changes the current section
    await scroller(page).evaluate((el) => (el.scrollTop = 0))
    await expect(headingRows(page).nth(0)).toHaveAttribute("aria-current", "location")
    await block(page, 20).evaluate((el) => el.scrollIntoView({ block: "start" }))
    await expect(headingRows(page).nth(1)).toHaveAttribute("aria-current", "location")

    // and so does moving the cursor into another section
    await focusBlock(page, 3)
    await expect(headingRows(page).nth(0)).toHaveAttribute("aria-current", "location")
})

test("the equations listed are exactly the ones the margin numbers, with the same numbers, and a click goes to the equation", async ({ page }) => {
    await startDoc(page, "outline")
    await write(page, [["Intro."], display("a = b \\label{one}"), ["Between."], display("c = d \\label{two}"), ["The end."]])
    await toggle(page).click()

    await expect(equationRows(page)).toHaveCount(2)
    expect(await outlineNumbers(page)).toEqual(["(1)", "(2)"])
    expect(await marginDrawn(page)).toEqual(["(1)", "(2)"]) // what the browser paints in the margin: the same
    await expect(equationRows(page).first().locator(".katex")).toBeVisible() // a small typeset preview
    await shot(page, "outline-3-equations")

    await equationRows(page).nth(1).click()
    await expect(block(page, 3).locator(".katex-display")).toHaveClass(/mb-flash/)
})

test("a block being edited does not hold back or shift the numbers of the blocks below it", async ({ page }) => {
    await startDoc(page, "outline")
    await write(page, [display("a = b \\label{one}"), display("c = d \\label{two}"), ["The end."]])
    await toggle(page).click()
    expect(await outlineNumbers(page)).toEqual(["(1)", "(2)"])
    expect(await marginDrawn(page)).toEqual(["(1)", "(2)"])

    // the cursor goes into the first block and deletes its equation. The block's typeset preview stays on the page, frozen,
    // until the cursor leaves it.
    await focusBlock(page, 0)
    await page.keyboard.press("Control+A")
    await page.keyboard.press("Backspace")
    expect(await editorFocused(page)).toBe(true)

    // the equation below is now the first: in the margin and in the panel, while the cursor is still in the block above
    await expect.poll(() => marginDrawn(page)).toEqual(["(1)"])
    await expect.poll(() => outlineNumbers(page)).toEqual(["(1)"])
    expect(await editorFocused(page)).toBe(true)

    // and nothing changes when the cursor leaves
    await page.keyboard.press("Escape")
    expect(await marginDrawn(page)).toEqual(["(1)"])
    expect(await outlineNumbers(page)).toEqual(["(1)"])
})

test("works from the keyboard", async ({ page }) => {
    await startDoc(page, "outline")
    await write(page, [["# Alpha"], ["text"], ["## Beta"], ["### Gamma"], ["# Delta"]])
    await toggle(page).click()
    await expect(headingRows(page)).toHaveText(["Alpha", "Beta", "Gamma", "Delta"])

    // one stop in the tree, then arrows
    await expect(page.locator('[data-testid="outline-heading"][tabindex="0"]')).toHaveCount(1)
    await headingRows(page).nth(0).focus()
    await page.keyboard.press("ArrowDown")
    await expect(headingRows(page).nth(1)).toBeFocused()

    await page.keyboard.press("ArrowLeft") // collapses Beta
    await expect(headingRows(page).nth(1)).toHaveAttribute("aria-expanded", "false")
    await expect(headingRows(page)).toHaveText(["Alpha", "Beta", "Delta"])
    await page.keyboard.press("ArrowRight") // opens it again
    await expect(headingRows(page).nth(1)).toHaveAttribute("aria-expanded", "true")
    await page.keyboard.press("ArrowRight") // and goes in
    await expect(headingRows(page).nth(2)).toBeFocused()
    await page.keyboard.press("ArrowLeft") // a leaf: out to its parent
    await expect(headingRows(page).nth(1)).toBeFocused()

    await page.keyboard.press("End")
    await expect(headingRows(page).nth(3)).toBeFocused()
    await page.keyboard.press("Home")
    await expect(headingRows(page).nth(0)).toBeFocused()

    await page.keyboard.press("Enter") // go to it
    await expect(block(page, 0).locator("h1")).toHaveClass(/mb-flash/)
    await expect(headingRows(page).nth(0)).toBeFocused() // focus stays in the panel, so the next arrow key still works
    await expect(toggle(page)).toHaveAttribute("aria-controls", "doc-outline")
})

test("shows up in both light and dark", async ({ page }) => {
    await startDoc(page, "outline")
    await write(page, [["# Alpha"], display("a = b \\label{one}")])
    await toggle(page).click()
    await expect(headingRows(page)).toHaveText(["Alpha"])

    const colours = () => panel(page).evaluate((el) => {
        const row = el.querySelector('[data-testid="outline-heading"]') as HTMLElement
        return { background: getComputedStyle(el).backgroundColor, text: getComputedStyle(row).color }
    })
    await page.evaluate(() => document.documentElement.classList.remove("dark"))
    const light = await colours()
    await shot(page, "outline-4-light")
    await page.evaluate(() => document.documentElement.classList.add("dark"))
    const dark = await colours()
    await shot(page, "outline-5-dark")

    expect(dark.background).not.toBe(light.background)
    await expect.poll(async () => (await colours()).text).not.toBe(light.text) // the rows fade between the two, so give it a moment
    await expect(panel(page)).toBeVisible()
})

test.describe("on a narrow screen", () => {
    test.use({ viewport: { width: 480, height: 800 } })

    test("the outline is a drawer over the page, which starts closed, closes itself when you go somewhere, and closes with Escape", async ({ page }) => {
        // an answer given on a wide screen must not cover the document on a phone
        await page.addInitScript(() => window.localStorage.setItem("lemma:outline-open", "1"))
        await startDoc(page, "outline")
        await write(page, [["# Alpha"], ...filler(10, "First"), ["## Beta"], ...filler(10, "Second")])

        await expect(drawer(page)).toHaveCount(0)
        await expect(panel(page)).toHaveCount(0)

        await toggle(page).click()
        await expect(drawer(page)).toBeVisible()
        await expect(page.getByRole("dialog", { name: "Document outline" })).toBeVisible()
        await expect(headingRows(page)).toHaveText(["Alpha", "Beta"])
        await shot(page, "outline-6-drawer")

        await headingRows(page).nth(1).click()
        await expect(drawer(page)).toHaveCount(0) // out of the way of where you went
        await expect.poll(() => scroller(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(300)
        await expect(block(page, 11).locator("h2")).toBeVisible()

        await toggle(page).click()
        await expect(drawer(page)).toBeVisible()
        await page.keyboard.press("Escape")
        await expect(drawer(page)).toHaveCount(0)
        await expect(toggle(page)).toBeFocused() // focus goes back to where it was
    })
})
