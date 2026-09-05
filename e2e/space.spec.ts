import { expect, test } from "@playwright/test"
import { createAccount, waitForEditorBoot } from "./auth-helpers"
import {
	create,
	deleteById,
	list,
	startObservingDocumentNotFound,
	didDocumentNotFoundRender,
} from "./doc-helpers"
import { testIds } from "@/app/lib/test-ids"
import {
	acceptSpaceInvite,
	createSpace,
	createSpaceInvite,
	deleteSpaceById,
	listSpaceInvites,
	listSpaces,
	readSpaceById,
	revokeSpaceInvite,
	updateSpaceById,
} from "./space-helpers"

test("space CRUD + invite helpers return JSON", async ({ page }) => {
	await waitForEditorBoot(page)
	await createAccount(page)

	let created = await createSpace(page, { name: "E2E Space" })
	expect(created.ok).toBe(true)
	let firstDocumentId = page.url().match(/\/doc\/([^/?#]+)/)?.[1]
	if (!firstDocumentId) throw new Error("Expected the space's first document")
	let newButton = page.getByTestId(testIds.doc.newButton)
	let beforeHover = await list(page, { spaceId: created.id })
	await newButton.dispatchEvent("mouseover")
	await page.waitForTimeout(250)
	let afterHover = await list(page, { spaceId: created.id })
	expect(afterHover.count).toBe(beforeHover.count)

	let secondDocument = await create(page, {
		spaceId: created.id,
		title: "Second space document",
	})
	await startObservingDocumentNotFound(page)
	await page
		.locator(`[data-doc-id="${firstDocumentId}"] a`)
		.dispatchEvent("click")
	await expect(page).toHaveURL(
		new RegExp(`/spaces/${created.id}/doc/${firstDocumentId}`),
	)
	await page
		.locator(`[data-doc-id="${secondDocument.id}"] a`)
		.dispatchEvent("click")
	await expect(page).toHaveURL(
		new RegExp(`/spaces/${created.id}/doc/${secondDocument.id}`),
	)
	await expect(
		page.getByTestId(testIds.doc.editor).locator(".cm-content"),
	).toContainText("Second space document")
	expect(await didDocumentNotFoundRender(page)).toBe(false)

	let editor = page.getByTestId(testIds.doc.editor).locator(".cm-content")
	await editor.click()
	await editor.press("ControlOrMeta+End")
	await page.keyboard.insertText("\nspace autosave persisted")
	await page
		.locator(`[data-doc-id="${firstDocumentId}"] a`)
		.dispatchEvent("click")
	await page
		.locator(`[data-doc-id="${secondDocument.id}"] a`)
		.dispatchEvent("click")
	await expect(editor).toContainText("space autosave persisted")

	let listed = await listSpaces(page, { expectedSpaceId: created.id })
	expect(listed.ok).toBe(true)
	expect(listed.items.some(space => space.id === created.id)).toBe(true)

	let read = await readSpaceById(page, { spaceId: created.id })
	expect(read.ok).toBe(true)
	expect(read.space.name).toBe("E2E Space")

	let updated = await updateSpaceById(page, {
		spaceId: created.id,
		name: "E2E Space Updated",
	})
	expect(updated.ok).toBe(true)

	let invite = await createSpaceInvite(page, {
		spaceId: created.id,
		role: "reader",
	})
	expect(invite.ok).toBe(true)
	expect(invite.link).toContain("invite")

	let pending = await listSpaceInvites(page, { spaceId: created.id })
	expect(pending.ok).toBe(true)
	expect(
		pending.items.some(i => i.inviteGroupId === invite.inviteGroupId),
	).toBe(true)

	let revoked = await revokeSpaceInvite(page, {
		spaceId: created.id,
		inviteGroupId: invite.inviteGroupId ?? undefined,
	})
	expect(revoked.ok).toBe(true)

	let removed = await deleteSpaceById(page, { spaceId: created.id })
	expect(removed.ok).toBe(true)
})

test("reloading root returns to last opened space doc", async ({ page }) => {
	await waitForEditorBoot(page)
	await createAccount(page)

	let created = await createSpace(page, { name: "Reload Space" })
	await expect
		.poll(() => page.url(), { timeout: 10_000 })
		.toMatch(new RegExp(`/app/spaces/${created.id}/doc/`))

	// Give useTrackLastOpened effect time to persist to IndexedDB.
	await page.waitForTimeout(2000)

	await page.goto("/app/")
	await waitForEditorBoot(page)
	await expect
		.poll(() => page.url(), { timeout: 10_000 })
		.toMatch(new RegExp(`/app/spaces/${created.id}/doc/`))
})

test("deleting current space doc stays in that space", async ({ page }) => {
	await waitForEditorBoot(page)
	await createAccount(page)

	let created = await createSpace(page, { name: "Delete Current Space Doc" })
	let deletedDocId = page.url().match(/\/doc\/([^/?#]+)/)?.[1]
	if (!deletedDocId)
		throw new Error(`Could not parse doc id from ${page.url()}`)

	await deleteById(page, { id: deletedDocId, spaceId: created.id })

	await expect
		.poll(() => page.url(), { timeout: 10_000 })
		.toMatch(new RegExp(`/app/spaces/${created.id}/doc/(?!${deletedDocId})`))
})

test("space invite accept helper returns JSON", async ({ page }) => {
	await waitForEditorBoot(page)
	await createAccount(page)

	let created = await createSpace(page, { name: "Invite Accept Space" })
	let invite = await createSpaceInvite(page, {
		spaceId: created.id,
		role: "reader",
	})

	let accepted = await acceptSpaceInvite(page, { link: invite.link })
	expect(accepted.ok).toBe(true)
	expect(accepted.spaceId).toBe(created.id)
	expect(accepted.url).toContain(`/app/spaces/${created.id}`)
})
