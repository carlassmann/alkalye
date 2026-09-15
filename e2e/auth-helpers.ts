import { expect, type Page } from "@playwright/test"
import { testIds } from "@/app/lib/test-ids"

export {
	waitForEditorBoot,
	openSettings,
	createAccount,
	signOut,
	signIn,
	getRecoveryPhrase,
}

interface WaitForEditorBootArgs {
	path?: string
}

interface OpenSettingsArgs {
	fromPath?: string
}

interface CreateAccountArgs {
	openSettings?: boolean
}

interface SignInArgs {
	passphrase: string
	openSettings?: boolean
}

interface SignOutArgs {
	openSettings?: boolean
}

async function waitForEditorBoot(page: Page, args: WaitForEditorBootArgs = {}) {
	let path = args.path ?? "/app"
	await page.goto(path)
	await expect
		.poll(
			async () => {
				return page.evaluate(() => {
					return document.body.getAttribute("data-alkalye-ready")
				})
			},
			{ timeout: 30_000 },
		)
		.toBe("true")

	let route = await page.evaluate(() => {
		return (
			(window as { __alkalyeReadyRoute?: string }).__alkalyeReadyRoute ?? null
		)
	})

	return {
		ok: true,
		url: page.url(),
		route,
	}
}

async function openSettings(page: Page, args: OpenSettingsArgs = {}) {
	let fromPath = args.fromPath ?? "/app/settings"
	await page.goto(fromPath)
	await expect(page.getByText("Cloud Sync & Backup")).toBeVisible()

	return {
		ok: true,
		url: page.url(),
	}
}

async function createAccount(page: Page, args: CreateAccountArgs = {}) {
	if (args.openSettings ?? true) {
		await openSettings(page)
	}

	await page.getByTestId(testIds.auth.settingsSignIn).click()
	await page.getByTestId(testIds.auth.initialCreateAccount).click()

	let recovery = await getRecoveryPhrase(page)

	await page.getByTestId(testIds.auth.createCopy).click()
	await page.getByTestId(testIds.auth.createSubmit).click()

	let dialog = page.getByTestId(testIds.auth.dialog)
	let didClose = await expect(dialog)
		.toBeHidden({ timeout: 5_000 })
		.then(() => true)
		.catch(() => false)

	if (!didClose) {
		let dialogText = await dialog.innerText()
		throw new Error(`Create account dialog did not close: ${dialogText}`)
	}

	let createError = page.getByTestId(testIds.auth.createError)
	if (await createError.isVisible({ timeout: 2_000 }).catch(() => false)) {
		throw new Error(await createError.innerText())
	}

	await waitForAuthNavigation(page)
	await openSettings(page)
	await expect(page.getByTestId(testIds.auth.settingsSignOut)).toBeVisible({
		timeout: 30_000,
	})

	return {
		ok: true,
		signedIn: true,
		passphrase: recovery.passphrase,
	}
}

async function signOut(page: Page, args: SignOutArgs = {}) {
	if (args.openSettings ?? true) {
		await openSettings(page)
	}

	await page.getByTestId(testIds.auth.settingsSignOut).click()
	await expect(page.getByTestId(testIds.auth.settingsSignIn)).toBeVisible()

	return {
		ok: true,
		signedIn: false,
	}
}

async function signIn(page: Page, args: SignInArgs) {
	if (args.openSettings ?? true) {
		await openSettings(page)
	}

	await page.getByTestId(testIds.auth.settingsSignIn).click()
	await page.getByTestId(testIds.auth.initialSignIn).click()
	await page.getByTestId(testIds.auth.loginPassphrase).fill(args.passphrase)
	await page.getByTestId(testIds.auth.loginSubmit).click()

	let dialog = page.getByTestId(testIds.auth.dialog)
	let didClose = await expect(dialog)
		.toBeHidden({ timeout: 10_000 })
		.then(() => true)
		.catch(() => false)
	if (!didClose) {
		let dialogText = await dialog.innerText()
		throw new Error(`Sign in dialog did not close: ${dialogText}`)
	}

	let loginError = page.getByTestId(testIds.auth.loginError)
	if (await loginError.isVisible({ timeout: 2_000 }).catch(() => false)) {
		throw new Error(await loginError.innerText())
	}

	await waitForAuthNavigation(page)
	await openSettings(page)
	await expect(page.getByTestId(testIds.auth.settingsSignOut)).toBeVisible({
		timeout: 30_000,
	})

	return {
		ok: true,
		signedIn: true,
	}
}

async function waitForAuthNavigation(page: Page) {
	await page.waitForURL(
		url => url.pathname.startsWith("/app") && url.pathname !== "/app/settings",
		{ timeout: 30_000 },
	)
	await waitForEditorBoot(page)
}

async function getRecoveryPhrase(page: Page) {
	let passphrase = await page
		.getByTestId(testIds.auth.createPassphrase)
		.inputValue()

	expect(passphrase.trim().length).toBeGreaterThan(10)

	return {
		ok: true,
		passphrase,
	}
}
