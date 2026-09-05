import { test, expect } from "@playwright/test"
import { testIds } from "@/app/lib/test-ids"
import { waitForEditorBoot, createAccount } from "./auth-helpers"
import {
	create,
	readById,
	updateById,
	list,
	deleteById,
	startObservingDocumentNotFound,
	didDocumentNotFoundRender,
} from "./doc-helpers"

test("document CRUD helpers return JSON", async ({ page }) => {
	await waitForEditorBoot(page)
	await createAccount(page)

	let newButton = page.getByTestId(testIds.doc.newButton)
	let beforeHover = await list(page)
	await newButton.dispatchEvent("mouseover")
	await page.waitForTimeout(250)
	let afterHover = await list(page)
	expect(afterHover.count).toBe(beforeHover.count)

	await Promise.all([
		page.waitForURL(/\/app\/doc\/co_/),
		newButton.dispatchEvent("click"),
	])
	let createdFromButtonId = new URL(page.url()).pathname.split("/").at(-1)
	expect(createdFromButtonId).toBeTruthy()
	if (!createdFromButtonId) throw new Error("New document URL has no ID")
	await expect
		.poll(() => page.getByTestId(testIds.doc.listItem).count())
		.toBe(beforeHover.count + 1)
	await page.waitForTimeout(250)
	expect(await page.getByTestId(testIds.doc.listItem).count()).toBe(
		beforeHover.count + 1,
	)
	await deleteById(page, { id: createdFromButtonId })

	let before = await list(page)
	expect(before.ok).toBe(true)

	let created = await create(page, {
		title: "CRUD JSON Doc",
		tags: ["e2e", "json"],
		path: "tests",
		body: "create body",
	})
	expect(created.ok).toBe(true)
	expect(created.id.length).toBeGreaterThan(10)

	let existingId = before.items[0]?.id
	if (!existingId) throw new Error("Expected an existing document")
	await startObservingDocumentNotFound(page)
	await page.locator(`[data-doc-id="${existingId}"] a`).dispatchEvent("click")
	await expect(page).toHaveURL(new RegExp(`/doc/${existingId}`))
	await page.locator(`[data-doc-id="${created.id}"] a`).dispatchEvent("click")
	await expect(page).toHaveURL(new RegExp(`/doc/${created.id}`))
	await expect(
		page.getByTestId(testIds.doc.editor).locator(".cm-content"),
	).toContainText("CRUD JSON Doc")
	expect(await didDocumentNotFoundRender(page)).toBe(false)

	let editor = page.getByTestId(testIds.doc.editor).locator(".cm-content")
	await editor.click()
	await editor.press("ControlOrMeta+End")
	await page.keyboard.insertText("\nautosave persisted")
	await page.locator(`[data-doc-id="${existingId}"] a`).dispatchEvent("click")
	await expect(page).toHaveURL(new RegExp(`/doc/${existingId}`))
	await page.locator(`[data-doc-id="${created.id}"] a`).dispatchEvent("click")
	await expect(editor).toContainText("autosave persisted")
	await page.reload()

	let autosaved = await readById(page, { id: created.id })
	expect(autosaved.document.content).toContain("autosave persisted")

	await editor.click()
	await editor.press("ControlOrMeta+A")
	let largeMarker = "large-document-durable-tail"
	let durableSave = page.evaluate(
		({ documentId, marker }) =>
			new Promise<void>(resolve => {
				function handleSaved(event: Event) {
					if (!(event instanceof CustomEvent)) return
					if (event.detail.documentId !== documentId) return
					if (!event.detail.content.endsWith(marker)) return
					window.removeEventListener("alkalye:document-saved", handleSaved)
					resolve()
				}
				window.addEventListener("alkalye:document-saved", handleSaved)
			}),
		{ documentId: created.id, marker: largeMarker },
	)
	await page.keyboard.insertText(`${"x".repeat(128 * 1024)}${largeMarker}`)
	await expect(editor).toHaveAttribute("spellcheck", "false")
	await durableSave
	await page.reload()
	await waitForEditorBoot(page, { path: `/app/doc/${created.id}` })
	editor = page.getByTestId(testIds.doc.editor).locator(".cm-content")
	await editor.click()
	await editor.press("ControlOrMeta+A")
	await editor.press("ControlOrMeta+C")
	let durableLargeContent = await page.evaluate(() =>
		navigator.clipboard.readText(),
	)
	expect(durableLargeContent).toHaveLength(128 * 1024 + largeMarker.length)
	expect(durableLargeContent).toContain(largeMarker)
	await editor.press("ControlOrMeta+A")
	let restoredSave = page.evaluate(
		documentId =>
			new Promise<void>(resolve => {
				function handleSaved(event: Event) {
					if (!(event instanceof CustomEvent)) return
					if (event.detail.documentId !== documentId) return
					window.removeEventListener("alkalye:document-saved", handleSaved)
					resolve()
				}
				window.addEventListener("alkalye:document-saved", handleSaved)
			}),
		created.id,
	)
	await page.keyboard.insertText("# CRUD JSON Doc\n\ncreate body")
	await expect(editor).toHaveAttribute("spellcheck", "true")
	await restoredSave
	await expect
		.poll(() =>
			page
				.locator(`[data-doc-id="${created.id}"]`)
				.getAttribute("data-doc-title"),
		)
		.toBe("CRUD JSON Doc")

	let read = await readById(page, { id: created.id })
	expect(read.ok).toBe(true)
	expect(read.document.id).toBe(created.id)
	expect(read.document.title).toContain("CRUD JSON Doc")

	let updated = await updateById(page, {
		id: created.id,
		title: "CRUD JSON Doc Updated",
		body: "updated body",
		tags: ["e2e", "updated"],
		path: "tests/updated",
	})
	expect(updated.ok).toBe(true)
	expect(updated.document.title).toContain("CRUD JSON Doc Updated")
	expect(updated.document.content).toContain("updated body")

	let filtered = await list(page, { search: "CRUD JSON Doc Updated" })
	expect(filtered.ok).toBe(true)
	expect(filtered.items.some(item => item.id === created.id)).toBe(true)

	let deleted = await deleteById(page, { id: created.id })
	expect(deleted).toEqual({
		ok: true,
		id: created.id,
		spaceId: null,
		deleted: true,
	})

	let after = await list(page)
	expect(after.ok).toBe(true)
	expect(after.count).toBe(before.count)
})
