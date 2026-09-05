import { expect, type Page } from "@playwright/test"
import { testIds } from "@/app/lib/test-ids"
import { waitForEditorBoot } from "./auth-helpers"

export {
	create,
	readById,
	updateById,
	list,
	deleteById,
	startObservingDocumentNotFound,
	didDocumentNotFoundRender,
}

interface CreateArgs {
	spaceId?: string
	title?: string
	body?: string
	content?: string
	tags?: string[]
	path?: string
}

interface ReadByIdArgs {
	id: string
	spaceId?: string
}

interface UpdateByIdArgs {
	id: string
	spaceId?: string
	content?: string
	title?: string
	body?: string
	tags?: string[]
	path?: string
}

interface ListArgs {
	spaceId?: string
	search?: string
}

interface DeleteByIdArgs {
	id: string
	spaceId?: string
}

async function create(page: Page, args: CreateArgs = {}) {
	let query = args.spaceId ? `?spaceId=${encodeURIComponent(args.spaceId)}` : ""
	await waitForEditorBoot(page, { path: `/app/new${query}` })

	let id = getDocIdFromUrl(page.url())
	if (!id) {
		throw new Error(`Could not parse doc id from URL: ${page.url()}`)
	}

	let desiredContent =
		args.content ??
		buildContent({
			title: args.title,
			body: args.body,
			tags: args.tags,
			path: args.path,
		})

	let updated = await updateById(page, {
		id,
		spaceId: args.spaceId,
		content: desiredContent,
	})

	return {
		ok: true,
		id,
		spaceId: args.spaceId ?? null,
		url: page.url(),
		document: updated.document,
	}
}

async function readById(page: Page, args: ReadByIdArgs) {
	let targetPath = getDocPath(args.id, args.spaceId)
	await waitForEditorBoot(page, { path: targetPath })

	let content = await getEditorContent(page)
	let item = await readListItemById(page, args.id)
	let fallbackTitle = inferTitleFromContent(content)

	let document = {
		id: args.id,
		title: item?.title ?? fallbackTitle,
		tags: item?.tags ?? [],
		path: item?.path ?? null,
		date: item?.date ?? new Date().toISOString(),
		content,
		spaceId: args.spaceId ?? null,
	}

	return {
		ok: true,
		url: page.url(),
		document,
	}
}

async function updateById(page: Page, args: UpdateByIdArgs) {
	let targetPath = getDocPath(args.id, args.spaceId)
	await waitForEditorBoot(page, { path: targetPath })

	let content =
		args.content ??
		buildContent({
			title: args.title,
			body: args.body,
			tags: args.tags,
			path: args.path,
		})

	await setEditorContent(page, content)
	await waitForDocumentTitle(page, args.id, inferTitleFromContent(content))

	let latest = await readById(page, { id: args.id, spaceId: args.spaceId })

	return {
		ok: true,
		document: latest.document,
	}
}

async function list(page: Page, args: ListArgs = {}) {
	let appPath = args.spaceId ? `/app/spaces/${args.spaceId}` : "/app"
	await waitForEditorBoot(page, { path: appPath })
	await expect(page.getByTestId(testIds.sidebar.documentList)).toHaveAttribute(
		"aria-busy",
		"false",
	)

	let search = args.search ?? ""
	await page.getByTestId(testIds.doc.searchInput).fill(search)

	let rows = page.getByTestId(testIds.doc.listItem)
	let items = await rows.evaluateAll(elements => {
		return elements.map(element => {
			let id = element.getAttribute("data-doc-id") ?? ""
			let title = element.getAttribute("data-doc-title") ?? ""
			let tagsRaw = element.getAttribute("data-doc-tags") ?? ""
			let path = element.getAttribute("data-doc-path") ?? ""
			let date = element.getAttribute("data-doc-date") ?? ""

			return {
				id,
				title,
				tags: tagsRaw ? tagsRaw.split(",").filter(Boolean) : [],
				path: path || null,
				date,
			}
		})
	})

	return {
		ok: true,
		spaceId: args.spaceId ?? null,
		search,
		count: items.length,
		items,
	}
}

async function deleteById(page: Page, args: DeleteByIdArgs) {
	let targetPath = getDocPath(args.id, args.spaceId)
	await waitForEditorBoot(page, { path: targetPath })

	let fileMenuButton = page.getByTestId(testIds.doc.fileMenuButton)
	let fileMenuHandle = await fileMenuButton.elementHandle()
	if (!fileMenuHandle) {
		throw new Error("Could not find file menu button")
	}
	await fileMenuHandle.evaluate(element => {
		element.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true }),
		)
	})
	await page.getByTestId(testIds.doc.deleteButton).click()
	await page.getByTestId(testIds.dialog.deleteConfirm).click()

	await expect
		.poll(async () => {
			let target = page.locator(`[data-doc-id="${args.id}"]`)
			return target.count()
		})
		.toBe(0)

	return {
		ok: true,
		id: args.id,
		spaceId: args.spaceId ?? null,
		deleted: true,
	}
}

async function startObservingDocumentNotFound(page: Page) {
	await page.evaluate(selector => {
		document.documentElement.dataset.documentNotFoundRendered = "false"
		let observer = new MutationObserver(() => {
			if (document.querySelector(selector)) {
				document.documentElement.dataset.documentNotFoundRendered = "true"
			}
		})
		observer.observe(document.body, {
			childList: true,
			subtree: true,
		})
	}, `[data-testid="${testIds.error.documentNotFound}"]`)
}

async function didDocumentNotFoundRender(page: Page) {
	return page.evaluate(
		() => document.documentElement.dataset.documentNotFoundRendered === "true",
	)
}

function getDocPath(id: string, spaceId?: string) {
	if (spaceId) {
		return `/app/spaces/${spaceId}/doc/${id}`
	}
	return `/app/doc/${id}`
}

function getDocIdFromUrl(url: string) {
	let match = url.match(/\/doc\/([^/?#]+)/)
	return match?.[1] ?? null
}

function buildContent(args: {
	title?: string
	body?: string
	tags?: string[]
	path?: string
}) {
	let title = args.title?.trim() || "Untitled"
	let body = args.body ?? ""
	let frontmatterLines: string[] = []

	if (args.path && args.path.trim()) {
		frontmatterLines.push(`path: ${args.path.trim()}`)
	}

	if (args.tags && args.tags.length > 0) {
		frontmatterLines.push(`tags: ${args.tags.join(", ")}`)
	}

	let frontmatter =
		frontmatterLines.length > 0
			? `---\n${frontmatterLines.join("\n")}\n---\n\n`
			: ""

	if (!body) {
		return `${frontmatter}# ${title}\n`
	}

	return `${frontmatter}# ${title}\n\n${body}`
}

function inferTitleFromContent(content: string) {
	let heading = content.match(/^#\s+(.+)$/m)
	if (!heading) return "Untitled"
	return heading[1].trim()
}

async function setEditorContent(page: Page, content: string) {
	let editor = getEditorLocator(page)
	await editor.click()
	await editor.press(selectAllShortcut())
	await page.keyboard.insertText(content)
	await expect
		.poll(async () => normalizeEditorText(await getEditorContent(page)))
		.toBe(normalizeEditorText(content))
}

async function getEditorContent(page: Page) {
	let editor = getEditorLocator(page)
	return editor.innerText()
}

function getEditorLocator(page: Page) {
	return page.locator('[data-testid="doc-editor"] .cm-content').first()
}

function normalizeEditorText(value: string) {
	return value.replace(/\n{2,}/g, "\n").trim()
}

function selectAllShortcut() {
	return process.platform === "darwin" ? "Meta+A" : "Control+A"
}

async function readListItemById(page: Page, docId: string) {
	let row = page.locator(
		`[data-testid="${testIds.doc.listItem}"][data-doc-id="${docId}"]`,
	)
	if ((await row.count()) === 0) {
		return null
	}

	let first = row.first()
	let title = (await first.getAttribute("data-doc-title")) ?? ""
	let tagsRaw = (await first.getAttribute("data-doc-tags")) ?? ""
	let path = (await first.getAttribute("data-doc-path")) ?? ""
	let date = (await first.getAttribute("data-doc-date")) ?? ""

	return {
		title,
		tags: tagsRaw ? tagsRaw.split(",").filter(Boolean) : [],
		path: path || null,
		date,
	}
}

async function waitForDocumentTitle(page: Page, docId: string, title: string) {
	await expect
		.poll(async () => {
			let item = await readListItemById(page, docId)
			return item?.title ?? null
		})
		.toBe(title)
}
