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
	let collaborator = await openAcceptedDocumentInvite(page, {
		link: invite.link,
	})

	try {
		await waitForEditorBoot(collaborator.page, {
			path: `/app/doc/${created.id}`,
		})
		let ownerEditor = editorFor(page)
		let collaboratorEditor = editorFor(collaborator.page)
		let ownerMarker = "owner ending"
		let collaboratorMarker = "collaborator beginning"
		await observeLocalRollback(page, ownerMarker)
		await observeLocalRollback(collaborator.page, collaboratorMarker)

		await ownerEditor.click()
		await ownerEditor.press("ControlOrMeta+End")
		await collaboratorEditor.click()
		await collaboratorEditor.press("ControlOrMeta+Home")
		await Promise.all([
			page.keyboard.insertText(`\n${ownerMarker}`),
			collaborator.page.keyboard.insertText(`${collaboratorMarker}\n`),
		])

		await expect(ownerEditor).toContainText(collaboratorMarker, {
			timeout: 20_000,
		})
		await expect(collaboratorEditor).toContainText(ownerMarker, {
			timeout: 20_000,
		})
		expect(await didLocalTextRollback(page)).toBe(false)
		expect(await didLocalTextRollback(collaborator.page)).toBe(false)

		await Promise.all([page.reload(), collaborator.page.reload()])
		await expect(editorFor(page)).toContainText(ownerMarker)
		await expect(editorFor(page)).toContainText(collaboratorMarker)
		await expect(editorFor(collaborator.page)).toContainText(ownerMarker)
		await expect(editorFor(collaborator.page)).toContainText(collaboratorMarker)
	} finally {
		await collaborator.context.close()
	}
})

function editorFor(page: Page) {
	return page.getByTestId(testIds.doc.editor).locator(".cm-content")
}

async function observeLocalRollback(page: Page, marker: string) {
	await page.evaluate(localMarker => {
		document.documentElement.dataset.localTextRolledBack = "false"
		let seen = false
		function inspectEditor() {
			let content = document.querySelector(
				".markdown-editor .cm-content",
			)?.textContent
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
