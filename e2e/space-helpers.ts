import { expect, type Page } from "@playwright/test"
import { testIds } from "@/app/lib/test-ids"
import { waitForEditorBoot } from "./auth-helpers"

export {
	createSpace,
	readSpaceById,
	updateSpaceById,
	listSpaces,
	deleteSpaceById,
	createSpaceInvite,
	listSpaceInvites,
	revokeSpaceInvite,
	acceptSpaceInvite,
}

interface SpaceArgs {
	spaceId?: string
}

interface ListSpacesArgs {
	expectedSpaceId?: string
}

interface CreateSpaceArgs {
	name: string
}

interface UpdateSpaceByIdArgs {
	spaceId: string
	name: string
}

interface ReadSpaceByIdArgs {
	spaceId: string
}

interface DeleteSpaceByIdArgs {
	spaceId: string
}

interface CreateSpaceInviteArgs {
	spaceId: string
	role: "writer" | "reader"
}

interface RevokeSpaceInviteArgs {
	spaceId: string
	inviteGroupId?: string
}

interface AcceptSpaceInviteArgs {
	link: string
}

async function createSpace(page: Page, args: CreateSpaceArgs) {
	await waitForEditorBoot(page)
	await openSpaceSelector(page)
	await page.getByTestId(testIds.space.createButton).click()

	let dialog = page.getByTestId(testIds.space.createDialog)
	await expect(dialog).toBeVisible()

	await page.getByTestId(testIds.space.createNameInput).fill(args.name)
	await page.getByTestId(testIds.space.createSubmit).click()

	await expect
		.poll(() => page.url())
		.toMatch(/\/app\/spaces\/[^/]+\/doc\/[^/?#]+/)

	let spaceId = getSpaceIdFromUrl(page.url())
	if (!spaceId) throw new Error(`Could not parse space id from ${page.url()}`)

	return {
		ok: true,
		id: spaceId,
		name: args.name,
		url: page.url(),
	}
}

async function readSpaceById(page: Page, args: ReadSpaceByIdArgs) {
	await page.goto(`/app/spaces/${args.spaceId}/settings`)
	await expect(page.getByTestId(testIds.space.settingsNameInput)).toBeVisible()
	let name = await page
		.getByTestId(testIds.space.settingsNameInput)
		.inputValue()

	return {
		ok: true,
		space: {
			id: args.spaceId,
			name,
		},
	}
}

async function updateSpaceById(page: Page, args: UpdateSpaceByIdArgs) {
	await page.goto(`/app/spaces/${args.spaceId}/settings`)
	await expect(page.getByTestId(testIds.space.settingsNameInput)).toBeVisible()
	let input = page.getByTestId(testIds.space.settingsNameInput)
	await input.fill(args.name)

	await expect
		.poll(async () => {
			return input.inputValue()
		})
		.toBe(args.name)

	return {
		ok: true,
		space: {
			id: args.spaceId,
			name: args.name,
		},
	}
}

async function listSpaces(page: Page, args: ListSpacesArgs = {}) {
	await waitForEditorBoot(page)
	await openSpaceSelector(page)

	let items = await readSpaceSelectorItems(page)
	await expect
		.poll(async () => {
			items = await readSpaceSelectorItems(page)
			if (!args.expectedSpaceId) return items.length > 0
			return items.some(space => space.id === args.expectedSpaceId)
		})
		.toBe(true)

	await page.keyboard.press("Escape")

	return {
		ok: true,
		count: items.length,
		items,
	}
}

async function deleteSpaceById(page: Page, args: DeleteSpaceByIdArgs) {
	await page.goto(`/app/spaces/${args.spaceId}/settings`)
	await expect(page.getByTestId(testIds.space.settingsNameInput)).toBeVisible()

	let name = await page
		.getByTestId(testIds.space.settingsNameInput)
		.inputValue()
	await page.getByTestId(testIds.space.dangerDeleteButton).click()
	await page.getByTestId(testIds.space.dangerDeleteNameInput).fill(name)
	await page
		.getByTestId(testIds.space.dangerDeletePhraseInput)
		.fill("yes, delete permanently")
	await page.getByTestId(testIds.space.dangerDeleteConfirmButton).click()

	await expect.poll(() => page.url()).toContain("/app")

	return {
		ok: true,
		deleted: true,
		id: args.spaceId,
	}
}

async function createSpaceInvite(page: Page, args: CreateSpaceInviteArgs) {
	await openSpaceShareDialog(page, { spaceId: args.spaceId })

	let buttonId =
		args.role === "writer"
			? testIds.space.shareWriterInviteButton
			: testIds.space.shareReaderInviteButton

	await page.getByTestId(buttonId).click()

	let input = page.getByTestId(testIds.space.shareInviteLinkInput)
	await expect(input).toBeVisible({ timeout: 10_000 })
	let link = await input.inputValue()
	let inviteGroupId = parseInviteGroupId(link)

	return {
		ok: true,
		spaceId: args.spaceId,
		role: args.role,
		inviteGroupId,
		link,
	}
}

async function listSpaceInvites(page: Page, args: SpaceArgs) {
	if (!args.spaceId) throw new Error("spaceId required")
	await openSpaceShareDialog(page, { spaceId: args.spaceId })

	await expect(
		page.getByTestId(testIds.space.sharePendingInviteRow).first(),
	).toBeVisible()

	let invites = await page
		.getByTestId(testIds.space.sharePendingInviteRow)
		.evaluateAll(rows => {
			return rows.map(row => {
				return {
					inviteGroupId: row.getAttribute("data-invite-group-id") ?? "",
				}
			})
		})

	return {
		ok: true,
		spaceId: args.spaceId,
		count: invites.length,
		items: invites,
	}
}

async function revokeSpaceInvite(page: Page, args: RevokeSpaceInviteArgs) {
	await openSpaceShareDialog(page, { spaceId: args.spaceId })

	if (args.inviteGroupId) {
		await page
			.locator(
				`[data-testid="${testIds.space.sharePendingInviteRevoke}"][data-invite-group-id="${args.inviteGroupId}"]`,
			)
			.first()
			.click()
	} else {
		await page
			.getByTestId(testIds.space.sharePendingInviteRevoke)
			.first()
			.click()
	}

	if (args.inviteGroupId) {
		await expect
			.poll(async () => {
				return page
					.locator(
						`[data-testid="${testIds.space.sharePendingInviteRow}"][data-invite-group-id="${args.inviteGroupId}"]`,
					)
					.count()
			})
			.toBe(0)
	}

	return {
		ok: true,
		spaceId: args.spaceId,
		revoked: true,
		inviteGroupId: args.inviteGroupId ?? null,
	}
}

async function acceptSpaceInvite(page: Page, args: AcceptSpaceInviteArgs) {
	let browser = page.context().browser()
	if (!browser) throw new Error("Browser instance unavailable")

	let inviteGroupId = parseInviteGroupId(args.link)
	let spaceId = parseSpaceIdFromInviteLink(args.link)
	let context = await browser.newContext()
	let invitePage = await context.newPage()

	await invitePage.goto(args.link)
	await expect(invitePage).toHaveURL(/\/app\/invite/)
	await invitePage.getByTestId(testIds.invite.signInButton).click()

	await invitePage.getByTestId(testIds.auth.initialCreateAccount).click()
	await invitePage.getByTestId(testIds.auth.createCopy).click()
	await invitePage.getByTestId(testIds.auth.createSubmit).click()
	await expect(invitePage.getByTestId(testIds.auth.dialog)).toBeHidden({
		timeout: 30_000,
	})
	await waitForInviteSuccess(invitePage)

	if (spaceId) {
		await expect
			.poll(() => invitePage.url(), { timeout: 30_000 })
			.toMatch(new RegExp(`/app/spaces/${spaceId}/doc/`))
		await expect(invitePage.getByText("Space not found")).toBeHidden()
	}

	let url = invitePage.url()
	await context.close()

	return {
		ok: true,
		spaceId,
		inviteGroupId,
		url,
	}
}

async function openSpaceSelector(page: Page) {
	let trigger = page.getByTestId(testIds.space.selectorTrigger)
	let handle = await trigger.elementHandle()
	if (!handle) throw new Error("Could not find space selector trigger")
	await handle.evaluate(element => {
		element.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true }),
		)
	})
	await expect(page.getByTestId(testIds.space.createButton)).toBeVisible()
}

async function readSpaceSelectorItems(page: Page) {
	return page.getByTestId(testIds.space.listItem).evaluateAll(rows => {
		return rows.map(row => {
			let id = row.getAttribute("data-space-id") ?? ""
			let name = row.textContent?.trim() ?? ""
			return { id, name }
		})
	})
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

async function openSpaceShareDialog(page: Page, args: { spaceId: string }) {
	await page.goto(`/app/spaces/${args.spaceId}/settings`)
	await expect(page.getByTestId(testIds.space.inviteButton)).toBeVisible()
	await page.getByTestId(testIds.space.inviteButton).click()
	await expect(page.getByTestId(testIds.space.shareDialog)).toBeVisible()
}

function getSpaceIdFromUrl(url: string) {
	let match = url.match(/\/spaces\/([^/?#]+)/)
	return match?.[1] ?? null
}

function parseInviteGroupId(link: string) {
	let match = link.match(/\/invite\/([^/]+)\//)
	return match?.[1] ?? null
}

function parseSpaceIdFromInviteLink(link: string) {
	let match = link.match(/#\/space\/([^/]+)\//)
	return match?.[1] ?? null
}
