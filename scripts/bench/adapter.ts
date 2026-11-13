import { expect, type Page } from "@playwright/test"
import JSZip from "jszip"
import {
	createAccount,
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
	editor,
}

function editor(page: Page) {
	return page.locator('[data-testid="doc-editor"] .cm-content').first()
}

async function seed(
	page: Page,
	documents: { title: string; content: string }[],
) {
	await waitForEditorBoot(page)
	let zip = new JSZip()
	for (let document of documents)
		zip.file(`${document.title}.md`, document.content)
	await page
		.locator('input[type="file"][accept*=".zip"]')
		.first()
		.setInputFiles({
			name: "benchmark.zip",
			mimeType: "application/zip",
			buffer: await zip.generateAsync({
				type: "nodebuffer",
				compression: "DEFLATE",
			}),
		})
	await page.waitForFunction(
		() =>
			document.querySelector<HTMLInputElement>(
				'input[type="file"][accept*=".zip"]',
			)?.value === "",
		undefined,
		{ timeout: 300_000 },
	)
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
	await editor(page).click()
	await page.keyboard.press("ControlOrMeta+A")
	await page.keyboard.press("ControlOrMeta+C")
	return page.evaluate(() => navigator.clipboard.readText())
}
