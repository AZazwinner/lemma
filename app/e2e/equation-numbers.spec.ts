import { expect, test } from "@playwright/test"
import { focusBlock, signUp } from "./helpers"
import { allBlockSources, openNewDoc, shot, typeLines } from "./sidekick-helpers"

// Which displayed equations get a number in the margin. A number is shown only for a real equation that the author asked
// for (\label or \tag) or that the text cites (\eqref{...}, "by equation (2)"). Never for a boxed result, a statement with no
// relation symbol, or anything marked \notag. See lib/equation-numbers.ts.

const block = (page: import("@playwright/test").Page, index: number) => page.locator(`[data-block-index="${index}"]`)

test("equations are numbered only when labelled or cited, never when boxed, text-only or \\notag", async ({ page }) => {
    await signUp(page, "eqnum")
    await openNewDoc(page)
    await focusBlock(page)

    const display = async (lines: string[]) => {
        await typeLines(page, ["$$", ...lines, "$$"])
        await page.keyboard.press("Enter")
    }
    await display(["a = b \\label{one}"]) // 0: real, labelled: it is equation 1, and shows it
    await display(["\\boxed{c = d} \\label{two}"]) // 1: boxed, so never, label or not
    await display(["\\text{Hence the claim holds.}"]) // 2: no relation symbol: a sentence, not an equation
    await display(["e = f"]) // 3: real but nobody asked: it is equation 2, and cited below
    await display(["g = h \\tag{T}"]) // 4: has its own tag, which KaTeX draws
    await display(["i = j \\notag"]) // 5: marked no number
    await page.keyboard.type("See \\eqref{one} and, by equation (2), the rest.") // 6
    await page.keyboard.press("Escape") // leave the editor: every block is typeset

    // the margin numbers: equation 1 (labelled) and equation 2 (cited), and nothing else
    const numbers = await page.locator(".editor-doc [data-eqnum]").evaluateAll((els) => els.map((el) => el.getAttribute("data-eqnum")))
    expect(numbers).toEqual(["1", "2"])
    await expect(block(page, 0).locator("[data-eqnum]")).toHaveAttribute("data-eqnum", "1")
    await expect(block(page, 3).locator("[data-eqnum]")).toHaveAttribute("data-eqnum", "2")
    for (const index of [1, 2, 4, 5]) await expect(block(page, index).locator("[data-eqnum]")).toHaveCount(0)

    // and the number is drawn in the margin
    const drawn = (index: number) => block(page, index).locator(".katex-display").evaluate((el) => getComputedStyle(el, "::after").content)
    expect(await drawn(0)).toBe('"(1)"')
    expect(await drawn(3)).toBe('"(2)"')
    expect(await drawn(1)).toBe("none")

    // a \tag is KaTeX's own, drawn inside the equation, and does not get a second number from the margin
    await expect(block(page, 4).locator(".tag")).toHaveCount(1)

    // \label does not show up as an error, and \eqref is written as the number it points to
    await expect(page.locator(".editor-doc .katex-error")).toHaveCount(0)
    const paragraph = await block(page, 6).locator("> div.cursor-text").innerText()
    expect(paragraph).toContain("See (1) and, by equation (2), the rest.")
    await shot(page, "numbers-1-rules")

    // the numbers follow the document: take the citation away and the unlabelled equation loses its number
    await focusBlock(page, 6)
    await page.keyboard.press("Control+A")
    await page.keyboard.type("See \\eqref{one}.")
    await page.keyboard.press("Escape")
    await expect.poll(() => page.locator(".editor-doc [data-eqnum]").evaluateAll((els) => els.map((el) => el.getAttribute("data-eqnum")))).toEqual(["1"])
    expect((await allBlockSources(page))[0]).toBe("$$\na = b \\label{one}\n$$") // the source is untouched
})
