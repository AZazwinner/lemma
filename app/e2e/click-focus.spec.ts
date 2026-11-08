import { expect, test } from "@playwright/test"
import { focusBlock, signUp } from "./helpers"

async function buildThreeBlocks(page: import("@playwright/test").Page) {
    await focusBlock(page)
    await page.keyboard.type("First block")
    await page.keyboard.press("End")
    await page.keyboard.press("Enter")
    await page.waitForTimeout(150)
    await page.keyboard.type("Second block")
    await page.keyboard.press("End")
    await page.keyboard.press("Enter")
    await page.waitForTimeout(150)
    await page.keyboard.type("Third block")
    await page.waitForTimeout(300)
    await page.keyboard.press("Escape")
    await page.locator("body").click({ position: { x: 5, y: 5 } })
    await page.waitForTimeout(400)
}

async function focusedBlockIndex(page: import("@playwright/test").Page): Promise<string | null> {
    return page.evaluate(() => {
        const wrapper = document.activeElement?.closest("[data-block-index]")
        return wrapper ? (wrapper as HTMLElement).dataset.blockIndex ?? null : null
    })
}

test.describe("clicking empty space focuses the nearest block", () => {
    test("clicking below the last block focuses it, cursor at the end", async ({ page }) => {
        await signUp(page, "clickbelow")
        await page.getByRole("button", { name: "New document" }).click()
        await page.waitForURL("**/docs/d/*")
        await page.waitForTimeout(800)
        await buildThreeBlocks(page)

        const lastBox = await page.locator("[data-block-index]").last().boundingBox()
        await page.mouse.click(700, lastBox!.y + lastBox!.height + 100)
        await page.waitForTimeout(300)

        expect(await focusedBlockIndex(page)).toBe("2")
        await page.keyboard.type(" APPENDED")
        await expect(page.locator(".cm-content").nth(2)).toContainText("Third block APPENDED")
    })

    test("clicking in the right margin beside a block focuses it, cursor at the end", async ({ page }) => {
        await signUp(page, "clickright")
        await page.getByRole("button", { name: "New document" }).click()
        await page.waitForURL("**/docs/d/*")
        await page.waitForTimeout(800)
        await buildThreeBlocks(page)

        const box = await page.locator('[data-block-index="1"]').boundingBox()
        await page.mouse.click(box!.x + box!.width + 150, box!.y + box!.height / 2)
        await page.waitForTimeout(300)

        expect(await focusedBlockIndex(page)).toBe("1")
        await page.keyboard.type("-RIGHT")
        await expect(page.locator(".cm-content").nth(1)).toContainText("Second block-RIGHT")
    })

    test("clicking in the left margin beside a block focuses it, cursor at the start", async ({ page }) => {
        await signUp(page, "clickleft")
        await page.getByRole("button", { name: "New document" }).click()
        await page.waitForURL("**/docs/d/*")
        await page.waitForTimeout(800)
        await buildThreeBlocks(page)

        const box = await page.locator('[data-block-index="1"]').boundingBox()
        await page.mouse.click(Math.max(5, box!.x - 150), box!.y + box!.height / 2)
        await page.waitForTimeout(300)

        expect(await focusedBlockIndex(page)).toBe("1")
        await page.keyboard.type("LEFT-")
        await expect(page.locator(".cm-content").nth(1)).toContainText("LEFT-Second block")
    })

    test("dragging a marquee selection in empty space still works and doesn't leave a block focused", async ({ page }) => {
        await signUp(page, "clickmarquee")
        await page.getByRole("button", { name: "New document" }).click()
        await page.waitForURL("**/docs/d/*")
        await page.waitForTimeout(800)
        await buildThreeBlocks(page)

        const firstBox = await page.locator('[data-block-index="0"]').boundingBox()
        const thirdBox = await page.locator('[data-block-index="2"]').boundingBox()
        const marqueeX = Math.max(5, firstBox!.x - 150)

        await page.mouse.move(marqueeX, firstBox!.y - 10)
        await page.mouse.down()
        await page.mouse.move(marqueeX, firstBox!.y + 20, { steps: 5 })
        await page.mouse.move(marqueeX, thirdBox!.y + thirdBox!.height + 10, { steps: 10 })
        await page.waitForTimeout(150)
        await page.mouse.up()
        await page.waitForTimeout(300)

        const selectedCount = await page.locator('[data-block-index] > div[class*="bg-[var(--wash)]"]').count()
        expect(selectedCount).toBe(3)
        expect(await focusedBlockIndex(page)).toBeNull()
    })
})
