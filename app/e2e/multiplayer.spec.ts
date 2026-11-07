import { expect, test, type Browser, type Page } from "@playwright/test"
import { focusBlock, signUp } from "./helpers"
import {
    blockSource,
    currentUserId,
    ghost,
    openNewDoc,
    openSidekickMenu,
    shareDoc,
} from "./sidekick-helpers"

// Two browsers (separate contexts, so separate logins) on the same document.
async function twoWriters(browser: Browser, prefix: string): Promise<{ a: Page; b: Page }> {
    const a = await (await browser.newContext()).newPage()
    const b = await (await browser.newContext()).newPage()

    await signUp(a, `${prefix}_a`)
    const url = await openNewDoc(a)

    await signUp(b, `${prefix}_b`)
    await shareDoc(a, await currentUserId(b))
    await b.goto(url, { waitUntil: "networkidle" })
    await b.waitForTimeout(1000)
    await expect(b.locator("[data-block-index]").first()).toBeVisible()
    return { a, b }
}

test("edits from two users on one document reach each other, both ways", async ({ browser }) => {
    const { a, b } = await twoWriters(browser, "mp_sync")
    try {
        await focusBlock(a)
        await a.keyboard.type("hello from A")
        await expect.poll(() => blockSource(b)).toBe("hello from A")

        await focusBlock(b)
        await b.keyboard.press("End")
        await b.keyboard.type(" and B")
        await expect.poll(() => blockSource(a)).toBe("hello from A and B")
    } finally {
        await a.context().close()
        await b.context().close()
    }
})

test("a sidekick suggestion stays private until it is accepted, then syncs like any edit", async ({ browser }) => {
    const { a, b } = await twoWriters(browser, "mp_ghost")
    try {
        await focusBlock(a)
        await a.keyboard.type("integral of x squared")
        await expect.poll(() => blockSource(b)).toBe("integral of x squared")

        await openSidekickMenu(a)
        await a.getByRole("button", { name: /Describe → LaTeX/ }).click()
        await expect(ghost(a)).toBeVisible()

        // B never sees the suggestion, and nothing was written to the shared text
        await b.waitForTimeout(800)
        expect(await blockSource(b)).toBe("integral of x squared")
        await expect(ghost(b)).toHaveCount(0)

        await a.keyboard.press("Tab")
        await expect.poll(() => blockSource(b)).toBe("$$\n\\int_0^1 x^2 \\, dx\n$$")

        // and B can keep editing the same block afterwards
        await focusBlock(b)
        await b.keyboard.press("Control+End")
        await b.keyboard.type(" (from B)")
        await expect.poll(() => blockSource(a)).toContain("(from B)")
    } finally {
        await a.context().close()
        await b.context().close()
    }
})
