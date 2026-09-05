import { expect, type BrowserContext, type Page } from "@playwright/test"
import { testIds } from "@/app/lib/test-ids"
import { waitForEditorBoot } from "./auth-helpers"

export {
	createDocumentInvite,
	listDocumentInvites,
	revokeDocumentInvite,
	acceptDocumentInvite,
	openAcceptedDocumentInvite,
}

interface DocArgs {
	docId: string
	spaceId?: string
}

interface CreateDocumentInviteArgs extends DocArgs {
	role: "writer" | "reader"
}

interface RevokeDocumentInviteArgs extends DocArgs {
	inviteGroupId?: string
}

interface AcceptDocumentInviteArgs {
	link: string
}

interface AcceptedDocumentInvite {
	context: BrowserContext
	page: Page
	docId: string | null
	inviteGroupId: string | null
	url: string
}

async function createDocumentInvite(
	page: Page,
	args: CreateDocumentInviteArgs,
) {
	await openDocumentShareDialog(page, args)

	let buttonId =
		args.role === "writer"
			? testIds.collab.docShareInviteWriterButton
			: testIds.collab.docShareInviteReaderButton

	await page.getByTestId(buttonId).click()
	let input = page.getByTestId(testIds.collab.docShareInviteLinkInput)
	await expect(input).toBeVisible({ timeout: 10_000 })
	let link = await input.inputValue()
	let inviteGroupId = parseInviteGroupId(link)
	await page.waitForTimeout(3_000)

	return {
		ok: true,
		docId: args.docId,
		spaceId: args.spaceId ?? null,
		role: args.role,
		inviteGroupId,
		link,
	}
}

async function listDocumentInvites(page: Page, args: DocArgs) {
	await openDocumentShareDialog(page, args)

	let items = await page
		.getByTestId(testIds.collab.docSharePendingInviteRow)
		.evaluateAll(rows => {
			return rows.map(row => ({
				inviteGroupId: row.getAttribute("data-invite-group-id") ?? "",
			}))
		})

	return {
		ok: true,
		docId: args.docId,
		spaceId: args.spaceId ?? null,
		count: items.length,
		items,
	}
}

async function revokeDocumentInvite(
	page: Page,
	args: RevokeDocumentInviteArgs,
) {
	await openDocumentShareDialog(page, args)

	if (args.inviteGroupId) {
		await page
			.locator(
				`[data-testid="${testIds.collab.docSharePendingInviteRevoke}"][data-invite-group-id="${args.inviteGroupId}"]`,
			)
			.first()
			.click()
	} else {
		await page
			.getByTestId(testIds.collab.docSharePendingInviteRevoke)
			.first()
			.click()
	}

	return {
		ok: true,
		docId: args.docId,
		spaceId: args.spaceId ?? null,
		revoked: true,
		inviteGroupId: args.inviteGroupId ?? null,
	}
}

async function acceptDocumentInvite(
	page: Page,
	args: AcceptDocumentInviteArgs,
) {
	let accepted = await openAcceptedDocumentInvite(page, args)
	await accepted.context.close()

	return {
		ok: true,
		docId: accepted.docId,
		inviteGroupId: accepted.inviteGroupId,
		url: accepted.url,
	}
}

async function openAcceptedDocumentInvite(
	page: Page,
	args: AcceptDocumentInviteArgs,
): Promise<AcceptedDocumentInvite> {
	let browser = page.context().browser()
	if (!browser) throw new Error("Browser instance unavailable")

	let docId = parseDocIdFromInviteLink(args.link)
	let inviteGroupId = parseInviteGroupId(args.link)

	let context = await browser.newContext()
	let invitePage = await context.newPage()

	await invitePage.goto(args.link)
	await expect(invitePage).toHaveURL(/\/app\/invite/)
	await invitePage.getByTestId(testIds.invite.signInButton).click()
	await invitePage.getByTestId(testIds.auth.initialCreateAccount).click()
	await invitePage.getByTestId(testIds.auth.createCopy).click()
	await invitePage.getByTestId(testIds.auth.createSubmit).click()
	await expect(invitePage.getByTestId(testIds.auth.dialog)).toBeHidden({
		timeout: 10_000,
	})
	await waitForInviteSuccess(invitePage)

	if (docId) {
		await expect.poll(() => invitePage.url()).toContain(`/app/doc/${docId}`)
	}

	return {
		context,
		page: invitePage,
		docId,
		inviteGroupId,
		url: invitePage.url(),
	}
}

async function openDocumentShareDialog(page: Page, args: DocArgs) {
	let path = args.spaceId
		? `/app/spaces/${args.spaceId}/doc/${args.docId}`
		: `/app/doc/${args.docId}`

	await waitForEditorBoot(page, { path })
	let shareButton = page.getByTestId(testIds.collab.docShareOpenButton)
	let handle = await shareButton.elementHandle()
	if (!handle) throw new Error("Could not find document share button")
	await handle.evaluate(element => {
		element.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true }),
		)
	})
	await expect(page.getByTestId(testIds.collab.docShareDialog)).toBeVisible()
}

function parseInviteGroupId(link: string) {
	let match = link.match(/\/invite\/(co_[^/]+)\//)
	return match?.[1] ?? null
}

function parseDocIdFromInviteLink(link: string) {
	let match = link.match(/#\/doc\/(co_[^/]+)\//)
	return match?.[1] ?? null
}

async function waitForInviteSuccess(invitePage: Page) {
	let success = invitePage.getByTestId(testIds.invite.successState)
	let error = invitePage.getByTestId(testIds.invite.errorState)
	let didSucceed = await expect(success)
		.toBeVisible({ timeout: 30_000 })
		.then(() => true)
		.catch(() => false)

	if (didSucceed) return

	let errorText = (await error.isVisible().catch(() => false))
		? await error.innerText()
		: await invitePage.locator("body").innerText()
	throw new Error(`Invite did not succeed at ${invitePage.url()}: ${errorText}`)
}
