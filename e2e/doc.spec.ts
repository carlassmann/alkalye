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
	let createdPath = `/app/doc/${created.id}`
	await startObservingDocumentNotFound(page, createdPath, "CRUD JSON Doc")
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
	await page.reload()

	let autosaved = await readById(page, { id: created.id })
	expect(autosaved.document.content).toContain("autosave persisted")

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
