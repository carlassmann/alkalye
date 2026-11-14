import { expect, test, type Page } from "@playwright/test"
import { createAccount, waitForEditorBoot } from "./auth-helpers"
import { create } from "./doc-helpers"
import {
	acceptDocumentInvite,
	createDocumentInvite,
	listDocumentInvites,
	openAcceptedDocumentInvite,
	revokeDocumentInvite,
} from "./document-collab-helpers"
import { createSpace } from "./space-helpers"
import { setOffline } from "./network-helpers"
import { testIds } from "@/app/lib/test-ids"

test("document invite CRUD helpers return JSON", async ({ page }) => {
	await waitForEditorBoot(page)
	await createAccount(page)

	let created = await create(page, {
		title: "Doc Invite CRUD",
		body: "content",
	})

	let invite = await createDocumentInvite(page, {
		docId: created.id,
		role: "writer",
	})
	expect(invite.ok).toBe(true)

	let pending = await listDocumentInvites(page, {
		docId: created.id,
	})
	expect(pending.ok).toBe(true)
	expect(
		pending.items.some(item => item.inviteGroupId === invite.inviteGroupId),
	).toBe(true)

	let revoked = await revokeDocumentInvite(page, {
		docId: created.id,
		inviteGroupId: invite.inviteGroupId ?? undefined,
	})
	expect(revoked.ok).toBe(true)
})

test("document invite accept helper returns JSON", async ({ page }) => {
	await waitForEditorBoot(page)
	await createAccount(page)

	let created = await create(page, {
		title: "Doc Invite Accept",
		body: "acceptance",
	})

	let invite = await createDocumentInvite(page, {
		docId: created.id,
		role: "reader",
	})

	let accepted = await acceptDocumentInvite(page, { link: invite.link })
	expect(accepted.ok).toBe(true)
	expect(accepted.docId).toBe(created.id)
	expect(accepted.url).toContain(`/app/doc/${created.id}`)
})

test("document-only collaborator can open a document inside a space", async ({
	page,
}) => {
	await waitForEditorBoot(page)
	await createAccount(page)
	let space = await createSpace(page, { name: "Document-only access" })
	let created = await create(page, {
		spaceId: space.id,
		title: "Shared space document",
		body: "Visible without joining the space",
	})
	let invite = await createDocumentInvite(page, {
		spaceId: space.id,
		docId: created.id,
		role: "reader",
	})
	let collaborator = await openAcceptedDocumentInvite(page, {
		link: invite.link,
	})

	try {
		await expect(editorFor(collaborator.page)).toContainText(
			"Visible without joining the space",
		)
	} finally {
		await collaborator.context.close()
	}
})

test("simultaneous writers converge without rolling back local text", async ({
	page,
}) => {
	await waitForEditorBoot(page)
	await createAccount(page)
	let created = await create(page, {
		title: "Concurrent editing",
		body: "alpha\n\nbeta",
	})
	let invite = await createDocumentInvite(page, {
		docId: created.id,
		role: "writer",
	})
	await page.keyboard.press("Escape")
	let original = await copyDocument(page)
	let collaborator = await openAcceptedDocumentInvite(page, {
		link: invite.link,
	})

	try {
		await waitForEditorBoot(collaborator.page, {
			path: `/app/doc/${created.id}`,
		})
		let ownerEditor = editorFor(page)
		let collaboratorEditor = editorFor(collaborator.page)
		let ownerMarker = "owner sequential ending ".repeat(4)
		let collaboratorMarker = "collaborator sequential beginning ".repeat(4)
		let expected = `${collaboratorMarker}\n${original}\n${ownerMarker}`
		await observeLocalRollback(page, ownerMarker)
		await observeLocalRollback(collaborator.page, collaboratorMarker)

		await ownerEditor.click()
		await ownerEditor.press("ControlOrMeta+End")
		await collaboratorEditor.click()
		await collaboratorEditor.press("ControlOrMeta+Home")
		await Promise.all([
			page.keyboard.type(`\n${ownerMarker}`, { delay: 12 }),
			collaborator.page.keyboard.type(`${collaboratorMarker}\n`, { delay: 17 }),
		])

		await expect(ownerEditor).toContainText(collaboratorMarker, {
			timeout: 20_000,
		})
		await expect(collaboratorEditor).toContainText(ownerMarker, {
			timeout: 20_000,
		})
		expect(await didLocalTextRollback(page)).toBe(false)
		expect(await didLocalTextRollback(collaborator.page)).toBe(false)
		await expect
			.poll(() => copyDocument(page), { timeout: 20_000 })
			.toBe(expected)
		await expect
			.poll(() => copyDocument(collaborator.page), { timeout: 20_000 })
			.toBe(expected)

		await Promise.all([page.reload(), collaborator.page.reload()])
		await expect(editorFor(page)).toContainText(ownerMarker)
		await expect(editorFor(page)).toContainText(collaboratorMarker)
		await expect(editorFor(collaborator.page)).toContainText(ownerMarker)
		await expect(editorFor(collaborator.page)).toContainText(collaboratorMarker)
		await expect.poll(() => copyDocument(page)).toBe(expected)
		await expect.poll(() => copyDocument(collaborator.page)).toBe(expected)
	} finally {
		await collaborator.context.close()
	}
})

test("large text merges concurrent offline typing exactly and survives reload", async ({
	page,
}) => {
	test.setTimeout(120_000)
	await waitForEditorBoot(page)
	await createAccount(page)
	let original =
		"# Offline writers\n\n" + "A paragraph with 👩🏽‍💻 and café.\n\n".repeat(4096)
	let created = await create(page, {
		title: "Offline writers",
		body: "initial",
	})
	let invite = await createDocumentInvite(page, {
		docId: created.id,
		role: "writer",
	})
	await page.keyboard.press("Escape")
	let collaborator = await openAcceptedDocumentInvite(page, {
		link: invite.link,
	})
	await collaborator.context.grantPermissions([
		"clipboard-read",
		"clipboard-write",
	])
	await page.bringToFront()
	await editorFor(page).focus()
	await page.keyboard.press("ControlOrMeta+a")
	await page.evaluate(text => navigator.clipboard.writeText(text), original)
	await page.keyboard.press("ControlOrMeta+Shift+v")
	await expect.poll(() => copyDocument(page)).toBe(original)
	await expect(page).toHaveTitle("Offline writers")
	await page.keyboard.press("Escape")
	try {
		await waitForEditorBoot(collaborator.page, {
			path: `/app/doc/${created.id}`,
		})
		await expect.poll(() => copyDocument(collaborator.page)).toBe(original)
		await Promise.all([
			setOffline(page, true),
			setOffline(collaborator.page, true),
		])
		let prefix = "offline collaborator insertion "
		let suffix = " offline owner ending"
		await editorFor(page).focus()
		await page.keyboard.press("ControlOrMeta+End")
		await editorFor(collaborator.page).focus()
		await collaborator.page.keyboard.press("ControlOrMeta+Home")
		await Promise.all([
			page.keyboard.type(suffix, { delay: 0 }),
			collaborator.page.keyboard.type(prefix, { delay: 0 }),
		])
		await expect.poll(() => copyDocument(page)).toBe(original + suffix)
		await expect
			.poll(() => copyDocument(collaborator.page))
			.toBe(prefix + original)
		await Promise.all([
			setOffline(page, false),
			setOffline(collaborator.page, false),
		])
		let merged = prefix + original + suffix
		await expect
			.poll(() => copyDocument(page), { timeout: 30_000 })
			.toBe(merged)
		await expect
			.poll(() => copyDocument(collaborator.page), { timeout: 30_000 })
			.toBe(merged)
		await Promise.all([page.reload(), collaborator.page.reload()])
		await expect.poll(() => copyDocument(page)).toBe(merged)
		await expect.poll(() => copyDocument(collaborator.page)).toBe(merged)
	} finally {
		await setOffline(page, false)
		await collaborator.context.close()
	}
})

async function copyDocument(page: Page) {
	await page.bringToFront()
	await editorFor(page).focus()
	await page.keyboard.press("ControlOrMeta+a")
	await page.keyboard.press("ControlOrMeta+c")
	return page.evaluate(() => navigator.clipboard.readText())
}

function editorFor(page: Page) {
	return page.getByTestId(testIds.doc.editor).locator(".cm-content")
}

async function observeLocalRollback(page: Page, marker: string) {
	await page.evaluate(localMarker => {
		document.documentElement.dataset.localTextRolledBack = "false"
		let seen = false
		function inspectEditor() {
			let editor = document.querySelector(".markdown-editor .cm-content")
			let text = editor?.cloneNode(true)
			if (text instanceof Element) {
				// Cursor labels are decorations, not the document's text.
				for (let cursor of text.querySelectorAll(".cm-remote-cursor"))
					cursor.remove()
			}
			let content = text?.textContent
			if (content?.includes(localMarker)) {
				seen = true
			} else if (seen) {
				document.documentElement.dataset.localTextRolledBack = "true"
			}
		}
		new MutationObserver(inspectEditor).observe(document.body, {
			childList: true,
			characterData: true,
			subtree: true,
		})
		inspectEditor()
	}, marker)
}

async function didLocalTextRollback(page: Page) {
	return page.evaluate(
		() => document.documentElement.dataset.localTextRolledBack === "true",
	)
}
