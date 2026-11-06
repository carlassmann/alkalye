import { test, expect } from "@playwright/test"
import { create } from "./doc-helpers"
import { testIds } from "@/app/lib/test-ids"
import {
	createAccount,
	signIn,
	signOut,
	waitForEditorBoot,
} from "./auth-helpers"

test("auth flow: create account, sign out, sign in", async ({ page }) => {
	let boot = await waitForEditorBoot(page)
	expect(boot.ok).toBe(true)

	let created = await createAccount(page)
	expect(created.ok).toBe(true)
	expect(created.signedIn).toBe(true)
	expect(created.passphrase.trim().length).toBeGreaterThan(10)

	let signedOut = await signOut(page)
	expect(signedOut).toEqual({ ok: true, signedIn: false })

	let signedIn = await signIn(page, { passphrase: created.passphrase })
	expect(signedIn).toEqual({ ok: true, signedIn: true })
})

for (let entryPoint of ["sidebar", "settings"]) {
	test(`signing in from a fresh browser via ${entryPoint} opens an account document`, async ({
		page,
		browser,
	}) => {
		await waitForEditorBoot(page)
		let created = await createAccount(page)
		await create(page, {
			title: "My synced document",
			body: "Saved in my account.",
		})
		let accountDocumentUrl = page.url()

		let freshContext = await browser.newContext()
		try {
			let freshPage = await freshContext.newPage()
			await waitForEditorBoot(freshPage)
			expect(freshPage.url()).not.toBe(accountDocumentUrl)
			if (entryPoint === "settings") {
				await freshPage.goto("/app/settings")
				await freshPage.getByTestId(testIds.auth.settingsSignIn).click()
			} else {
				await freshPage
					.getByRole("button", { name: "Documents", exact: true })
					.click()
				await freshPage
					.getByRole("button", { name: "Anonymous user Local only" })
					.click()
				await freshPage
					.getByRole("menuitem", { name: "Sign in", exact: true })
					.click()
			}
			await freshPage.getByTestId(testIds.auth.initialSignIn).click()
			await freshPage
				.getByTestId(testIds.auth.loginPassphrase)
				.fill(created.passphrase)
			await freshPage.evaluate(() => {
				let observer = new MutationObserver(() => {
					if (document.body.innerText.includes("Access denied")) {
						document.documentElement.dataset.accessDeniedRendered = "true"
					}
				})
				observer.observe(document.body, { childList: true, subtree: true })
			})
			await freshPage.getByTestId(testIds.auth.loginSubmit).click()

			await expect(freshPage).toHaveURL(accountDocumentUrl)
			await expect(
				freshPage.getByTestId(testIds.doc.editor).locator(".cm-content"),
			).toBeVisible()
			expect(
				await freshPage.evaluate(
					() => document.documentElement.dataset.accessDeniedRendered,
				),
			).toBeUndefined()
			await freshPage.reload()
			await expect(
				freshPage.getByTestId(testIds.doc.editor).locator(".cm-content"),
			).toBeVisible({ timeout: 30_000 })
		} finally {
			await freshContext.close()
		}
	})
}
