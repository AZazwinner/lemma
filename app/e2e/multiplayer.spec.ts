import { expect, test, type Browser, type Page } from "@playwright/test"
import { focusBlock, signUp } from "./helpers"
import {
    allBlockSources,
    blockSource,
    currentUserId,
    explanationCard,
    ghost,
    openNewDoc,
    openSidekickMenu,
    problemRow,
    runFromMenu,
    shareDoc,
    sidekickPanel,
    skipUnlessMock,
    squiggle,
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
        await skipUnlessMock(a)
        await focusBlock(a)
        await a.keyboard.type("integral of x squared")
        await expect.poll(() => blockSource(b)).toBe("integral of x squared")

        await runFromMenu(a, "Rewrite")
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

// the Sidekick's avatar in the presence stack (the sparkle button in the top bar has the same name, but is not inside it)
const sidekickInPresence = (page: Page) => page.locator('[aria-label$="people here"] [aria-label="Sidekick"]')
const INTEGRAL_BLOCK = "$$\n\\int_0^1 x^2 \\, dx\n$$"

test("the Sidekick joins as a collaborator: it shows in presence, its block reaches both users, then it leaves", async ({ browser }) => {
    const { a, b } = await twoWriters(browser, "mp_collab")
    try {
        await skipUnlessMock(a)
        await focusBlock(a)
        await a.keyboard.type("integral of x squared")
        await expect.poll(() => blockSource(b)).toBe("integral of x squared")

        await openSidekickMenu(a)
        const toggle = a.getByTestId("sidekick-collab-switch")
        await expect(toggle).toHaveAttribute("aria-checked", "false") // off unless asked for
        await toggle.click()
        await expect(toggle).toHaveAttribute("aria-checked", "true")
        const field = a.getByTestId("sidekick-write-input")
        await field.fill("integral of x squared")
        await field.press("Enter")

        // It is in the presence list for both people, as itself...
        await expect(sidekickInPresence(a)).toBeVisible()
        await expect(sidekickInPresence(b)).toBeVisible()
        // ...and what it writes is an ordinary synced block, right after the writer's, with no ghost involved.
        await expect.poll(() => blockSource(b, 1)).toBe(INTEGRAL_BLOCK)
        await expect.poll(() => blockSource(a, 1)).toBe(INTEGRAL_BLOCK)
        expect(await blockSource(a, 0)).toBe("integral of x squared")
        await expect(ghost(a)).toHaveCount(0)
        // its caret is in the block it wrote, labelled with its name
        await expect(b.locator('[data-block-index="1"] .cm-ySelectionInfo', { hasText: "Sidekick" })).toHaveCount(1)

        // people keep editing alongside it
        await focusBlock(b)
        await b.keyboard.press("Control+End")
        await b.keyboard.type(" (B)")
        await expect.poll(() => blockSource(a, 0)).toContain("(B)")

        // it does not stay: a few seconds after it finishes it is gone from both lists
        await expect(sidekickInPresence(a)).toHaveCount(0, { timeout: 20_000 })
        await expect(sidekickInPresence(b)).toHaveCount(0, { timeout: 20_000 })

        // and its block was saved like any other
        await b.reload({ waitUntil: "networkidle" })
        await expect.poll(() => blockSource(b, 1)).toBe(INTEGRAL_BLOCK)
    } finally {
        await a.context().close()
        await b.context().close()
    }
})

test("someone with view-only access can't make the Sidekick write", async ({ browser }) => {
    const a = await (await browser.newContext()).newPage()
    const b = await (await browser.newContext()).newPage()
    try {
        await signUp(a, "mp_ro_a")
        const url = await openNewDoc(a)
        await signUp(b, "mp_ro_b")
        await shareDoc(a, await currentUserId(b), "read")
        await b.goto(url, { waitUntil: "networkidle" })
        await b.waitForTimeout(1000)
        await skipUnlessMock(b)

        await focusBlock(b) // a block to act on, so only the document being view-only can disable things
        await openSidekickMenu(b)
        const panel = sidekickPanel(b)
        await expect(b.getByTestId("sidekick-collab-switch")).toHaveCount(0)
        await expect(panel.getByRole("button", { name: /^Explain/ })).toBeEnabled() // reading is fine
        for (const name of [/^Fix/, /^Next step/, /^Rewrite/, /Photo → LaTeX/]) {
            await expect(panel.getByRole("button", { name })).toBeDisabled()
        }
        await expect(b.getByTestId("sidekick-write-input")).toBeDisabled()
    } finally {
        await a.context().close()
        await b.context().close()
    }
})

test("an explanation is private to the person who asked, until they choose Insert as note", async ({ browser }) => {
    const { a, b } = await twoWriters(browser, "mp_explain")
    try {
        await skipUnlessMock(a)
        await focusBlock(a)
        await a.keyboard.type("x^2 + y^2 = z^2")
        await expect.poll(() => blockSource(b)).toBe("x^2 + y^2 = z^2")

        await runFromMenu(a, "Explain")
        await expect(explanationCard(a)).toBeVisible()

        // B sees no card and no new block: it is only on A's screen
        await b.waitForTimeout(800)
        await expect(explanationCard(b)).toHaveCount(0)
        expect(await allBlockSources(b)).toEqual(["x^2 + y^2 = z^2"])

        // Insert as note is the explicit choice to share it: it becomes an ordinary block that syncs to B
        await explanationCard(a).getByRole("button", { name: "Insert as note" }).click()
        await expect.poll(async () => (await allBlockSources(b)).length).toBe(2)
        expect((await allBlockSources(b))[1]).toContain("This is the Pythagorean relation")
        await expect(explanationCard(a)).toHaveCount(0)
        await expect(explanationCard(b)).toHaveCount(0)
    } finally {
        await a.context().close()
        await b.context().close()
    }
})

test("a flagged step is private to the person who asked, and its fix syncs like a normal edit once accepted", async ({ browser }) => {
    const { a, b } = await twoWriters(browser, "mp_check")
    try {
        await skipUnlessMock(a)
        await focusBlock(a)
        await a.keyboard.type("2x + 3 = 7")
        await a.keyboard.press("Shift+Enter")
        await a.keyboard.type("2x = 5")
        await expect.poll(() => blockSource(b)).toBe("2x + 3 = 7\n2x = 5")

        await runFromMenu(a, "Fix")
        await expect(squiggle(a)).toHaveText("2x = 5")
        await expect(problemRow(a)).toBeVisible()

        // nothing about it reaches B: no squiggle, no line under the block, no text change
        await b.waitForTimeout(600)
        await expect(squiggle(b)).toHaveCount(0)
        await expect(problemRow(b)).toHaveCount(0)
        expect(await blockSource(b)).toBe("2x + 3 = 7\n2x = 5")

        // the fix is a ghost on A's screen only, and accepting it syncs like a normal edit
        await a.getByTestId("sidekick-fix").click()
        await expect(ghost(a)).toBeVisible()
        await b.waitForTimeout(400)
        await expect(ghost(b)).toHaveCount(0)
        expect(await blockSource(b)).toBe("2x + 3 = 7\n2x = 5")
        await a.getByTestId("sidekick-accept").click()
        await expect.poll(() => blockSource(b)).toBe("2x + 3 = 7\n2x = 4")
    } finally {
        await a.context().close()
        await b.context().close()
    }
})
