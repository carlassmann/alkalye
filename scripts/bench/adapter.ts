import { readFile } from "node:fs/promises"
import { expect, type Page, type BrowserContext } from "@playwright/test"
import JSZip from "jszip"
import {
	createAccount as createTestAccount,
	signIn,
	waitForEditorBoot,
} from "../../e2e/auth-helpers"

export {
	createAccount,
	signIn,
	waitForEditorBoot,
	seed,
	resolveDocument,
	readContent,
	openDocument,
	replaceContent,
	configureEditor,
	captureCredentials,
	verifyExport,
	editor,
}

async function createAccount(page: Page) {
	await waitForEditorBoot(page)
	return createTestAccount(page)
}

function editor(page: Page) {
	return page.locator('[data-testid="doc-editor"] .cm-content').first()
}

async function seed(
	page: Page,
	documents: { title: string; content: string }[],
) {
	await waitForEditorBoot(page)
	await showDocumentList(page)
	await expect
		.poll(() => page.getByTestId("doc-list-item").count(), { timeout: 60_000 })
		.toBeGreaterThan(0)
	let zip = new JSZip()
	for (let document of documents)
		zip.file(`${document.title}.md`, document.content)
	let input = page.locator(
		'input[type="file"][accept*=".markdown"][accept*=".comments.json"][accept*=".zip"]',
	)
	await input.setInputFiles({
		name: "benchmark.zip",
		mimeType: "application/zip",
		buffer: await zip.generateAsync({
			type: "nodebuffer",
			compression: "DEFLATE",
		}),
	})
	await expect.poll(() => input.inputValue(), { timeout: 300_000 }).toBe("")

	console.error("ZIP import completed; resolving documents")
	let result: { id: string; title: string; content: string }[] = []
	for (let document of documents) {
		console.error(`Resolving ${document.title}`)
		result.push({
			...document,
			id: await resolveDocument(page, document.title),
		})
	}
	await page.getByTestId("doc-search-input").fill("")
	return result
}

async function resolveDocument(page: Page, title: string) {
	await showDocumentList(page)
	await page.getByTestId("doc-search-input").fill(title)
	let row = page
		.locator(
			`[data-testid="doc-list-item"][data-doc-title=${JSON.stringify(title)}]`,
		)
		.first()
	await expect(row)
		.toBeVisible({ timeout: 30_000 })
		.catch(async error => {
			console.error((await page.locator("body").innerText()).slice(0, 4000))
			throw error
		})
	let id = await row.getAttribute("data-doc-id")
	if (!id) throw new Error(`No document ID for ${title}`)
	return id
}

async function readContent(page: Page) {
	await page.bringToFront()
	await editor(page).focus()
	await page.keyboard.press("ControlOrMeta+A")
	await page
		.getByRole("button", { name: "Edit", exact: true })
		.dispatchEvent("click")
	await page.getByRole("menuitem", { name: /^Copy(?:\s|$)/ }).click()
	return page.evaluate(() => navigator.clipboard.readText())
}

async function openDocument(page: Page, target: { id: string; title: string }) {
	await page.bringToFront()
	await waitForEditorBoot(page, { path: `/app/doc/${target.id}` })
	await expect(page).toHaveTitle(target.title, { timeout: 120_000 })
	await editor(page).waitFor({ state: "visible" })
}

async function replaceContent(page: Page, content: string) {
	await page.bringToFront()
	await editor(page).focus()
	await page.keyboard.press("ControlOrMeta+A")
	await page.evaluate(text => navigator.clipboard.writeText(text), content)
	await page.keyboard.press("ControlOrMeta+Shift+V")
	await page.keyboard.press("ControlOrMeta+Home")
}

async function configureEditor(page: Page) {
	await page.goto("/app/settings?category=editor")
	for (let label of [
		"Smart bracket and quote pairs",
		"Wrap selections in Markdown markers",
		"Slash, link, asset, and language suggestions",
	]) {
		let toggle = page.getByRole("switch", { name: label, exact: true })
		await expect(toggle).toBeVisible()
		if ((await toggle.getAttribute("aria-checked")) === "true")
			await toggle.click()
		await expect(toggle).toHaveAttribute("aria-checked", "false")
	}
}

async function verifyExport(
	page: Page,
	documents: { title: string; content: string }[],
) {
	await page.bringToFront()
	await page.getByTestId("doc-search-input").fill("")
	await page
		.getByRole("button", { name: "File options", exact: true })
		.dispatchEvent("click")
	let downloading = page.waitForEvent("download", { timeout: 60_000 })
	await page
		.getByRole("menuitem", { name: "Export all", exact: true })
		.dispatchEvent("click")
	let download = await downloading
	let path = await download.path()
	if (!path) throw new Error("Export did not produce a local ZIP")
	let zip = await JSZip.loadAsync(await readFile(path))
	for (let document of documents) {
		let file = zip.file(`${document.title}.md`)
		if (!file) throw new Error(`Export missing ${document.title}`)
		expect(await file.async("string")).toBe(document.content)
	}
}

async function captureCredentials(context: BrowserContext) {
	let storage = await context.storageState({ indexedDB: false })
	let origins = storage.origins.flatMap(origin => {
		let auth = origin.localStorage.filter(
			entry => entry.name === "jazz-logged-in-secret",
		)
		return auth.length ? [{ origin: origin.origin, localStorage: auth }] : []
	})
	if (!origins.length)
		throw new Error(
			"No Classic auth credentials found; adapt captureCredentials for this build",
		)
	return { cookies: [], origins }
}

async function showDocumentList(page: Page) {
	let sidebar = page.locator('[data-slot="sidebar"][data-side="left"]')
	await sidebar.waitFor({ state: "attached" })
	if ((await sidebar.getAttribute("data-state")) === "collapsed")
		await page.getByRole("button", { name: "Documents" }).click()
	await page.getByTestId("doc-search-input").click()
}
