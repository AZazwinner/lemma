import { expect, test } from "@playwright/test"
import { signUp } from "./helpers"
import { shot } from "./sidekick-helpers"

// The dashboard has one starting point, a blank document. (The starter documents it once offered, Homework Template and
// the rest, are gone.)

test("the dashboard offers a blank document and no other starter documents", async ({ page }) => {
    await signUp(page, "blankonly")

    await expect(page.getByRole("button", { name: /Blank Document/ })).toBeVisible()
    for (const name of ["Math Notes", "Homework Template", "Lecture Summary", "Research Paper", "Proof Writing", "Exam Prep Sheet"]) {
        await expect(page.getByText(name)).toHaveCount(0)
    }
    await shot(page, "dashboard-blank-only")
})

test("Blank Document stays untitled and empty", async ({ page }) => {
    await signUp(page, "blanktemplate")

    await page.getByRole("button", { name: /Blank Document/ }).click()
    await page.waitForURL("**/docs/d/*")
    await page.waitForTimeout(1000)

    await expect(page.locator("input").first()).toHaveValue("Untitled")
    await expect(page.locator(".cm-content")).toHaveCount(1)
    await expect(page.locator(".cm-content").first()).toHaveText("")
})

test("the New document button in the header starts the same blank document", async ({ page }) => {
    await signUp(page, "blankbutton")

    await page.getByRole("button", { name: "New document" }).click()
    await page.waitForURL("**/docs/d/*")
    await page.waitForTimeout(1000)

    await expect(page.locator("input").first()).toHaveValue("Untitled")
    await expect(page.locator(".cm-content")).toHaveCount(1)
    await expect(page.locator(".cm-content").first()).toHaveText("")
})
