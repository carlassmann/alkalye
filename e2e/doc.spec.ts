import { test, expect } from "@playwright/test"
import { testIds } from "@/app/lib/test-ids"
import { waitForEditorBoot, createAccount } from "./auth-helpers"
import { create, readById, updateById, list, deleteById } from "./doc-helpers"

test("document CRUD helpers return JSON", async ({ page }) => {
	await waitForEditorBoot(page)
	await createAccount(page)

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
