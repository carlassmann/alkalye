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
		// The editor guarantees local durability; the next profile needs the server copy.
		await page.evaluate("window.__jazz.waitForSync()")
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
				await freshPage.getByTestId(testIds.sidebar.syncStatus).click()
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

			await expect(freshPage).toHaveURL(accountDocumentUrl, { timeout: 10_000 })
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
			).toBeVisible({ timeout: 10_000 })
		} finally {
			await freshContext.close()
		}
	})
}

test("signing in from a private document link keeps the requested document", async ({
	page,
	browser,
}) => {
	await waitForEditorBoot(page)
	let account = await createAccount(page)
	await create(page, { title: "Requested private document" })
	let requestedUrl = page.url()
	await create(page, { title: "Newer account document" })
	await page.evaluate("window.__jazz.waitForSync()")

	let freshContext = await browser.newContext()
	try {
		let freshPage = await freshContext.newPage()
		await freshPage.goto(requestedUrl)
		await expect(
			freshPage.getByText("Sign in to access this document."),
		).toBeVisible()
		await freshPage
			.getByRole("button", { name: "Sign in", exact: true })
			.click()
		await freshPage.getByTestId(testIds.auth.initialSignIn).click()
		await freshPage
			.getByTestId(testIds.auth.loginPassphrase)
			.fill(account.passphrase)
		await freshPage.getByTestId(testIds.auth.loginSubmit).click()
		await expect(freshPage.getByTestId(testIds.doc.editor)).toContainText(
			"Requested private document",
			{ timeout: 10_000 },
		)
		await expect(freshPage).toHaveURL(requestedUrl)
	} finally {
		await freshContext.close()
	}
})

test("offline guest notes survive signing in and reach a fresh device once", async ({
	page,
	browser,
}) => {
	await waitForEditorBoot(page)
	let account = await createAccount(page)
	await create(page, { title: "Existing account note" })
	await page.evaluate("window.__jazz.waitForSync()")
	await signOut(page)
	await create(page, {
		title: "Guest draft",
		body: "Before going offline",
		path: "Guest folder",
	})
	await page.context().setOffline(true)
	let editor = page.getByTestId(testIds.doc.editor).locator(".cm-content")
	await editor.click()
	await editor.press("ControlOrMeta+End")
	await page.keyboard.insertText("\nWritten without a connection")
	await expect(editor).toContainText("Written without a connection")
	await page.context().setOffline(false)
	await signIn(page, { passphrase: account.passphrase })
	await page.evaluate("window.__jazz.waitForSync()")
	await waitForEditorBoot(page)
	let flatView = page.getByRole("button", { name: "Switch to flat view" })
	if (await flatView.isVisible()) await flatView.click()
	await expect(
		page.locator("[data-doc-id]").filter({ hasText: "Guest draft" }),
	).toHaveCount(1)
	let guestNote = page
		.locator("[data-doc-id]")
		.filter({ hasText: "Guest draft" })
	await guestNote.locator("a").click()
	await expect(editor).toContainText("Written without a connection")
	await expect(editor).toContainText("Guest folder")

	let freshContext = await browser.newContext()
	try {
		let fresh = await freshContext.newPage()
		await waitForEditorBoot(fresh)
		await signIn(fresh, { passphrase: account.passphrase })
		await waitForEditorBoot(fresh)
		let flatView = fresh.getByRole("button", { name: "Switch to flat view" })
		if (await flatView.isVisible()) await flatView.click()
		await expect(
			fresh.locator("[data-doc-id]").filter({ hasText: "Guest draft" }),
		).toHaveCount(1)
		await fresh
			.locator("[data-doc-id]")
			.filter({ hasText: "Guest draft" })
			.locator("a")
			.click()
		await expect(fresh.getByTestId(testIds.doc.editor)).toContainText(
			"Written without a connection",
		)
	} finally {
		await freshContext.close()
	}
})
