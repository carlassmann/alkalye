import { getRandomWriterName } from "@/app/features/onboarding/lib/random-writer-name"
import type { JazzClient } from "jazz-tools/client"
import { toast } from "sonner"
import { createContext, useContext, useEffect, useState } from "react"
import { useAll, useDb, useSession, useJazzSession } from "jazz-tools/react"
import { schema, type WriteHandle } from "jazz-tools"
import { app, type DocumentRow } from "@/jazz/schema"
import { DEFAULT_EDITOR_SETTINGS } from "@/jazz/value-types"
import {
	getPath,
	parseFrontmatter,
	addBacklink,
	removeBacklink,
	togglePinned,
} from "@/app/features/editor/lib/frontmatter"
import { parseWikiLinks } from "@/app/features/editor/lib/wikilink-parser"
import { documentMetadata } from "./metadata"
import { watchWrite } from "./writes"
import type { TextEdit } from "./codemirror-sync"

export {
	app,
	LibraryProvider,
	useLibrary,
	createDocument,
	updateContent,
	setPinned,
	readDocument,
	documentMetadata,
	canEdit,
	canAdmin,
}
export type { Database, LibraryDocument, SettingsRow }

type Database = ReturnType<typeof useDb>
type SettingsRow = schema.RowOf<typeof app.settings>
type LibraryDocument = Omit<DocumentRow, "deletedAt" | "content"> & {
	deletedAt?: Date
	path: string | null
	pinned: boolean
	canEdit: boolean
	canAdmin: boolean
	shared?: boolean
}
type Library = ReturnType<typeof useLibraryData>
let LibraryContext = createContext<Library | null>(null)

function LibraryProvider({ children }: { children: React.ReactNode }) {
	let library = useLibraryData()
	return (
		<LibraryContext.Provider value={library}>
			{children}
		</LibraryContext.Provider>
	)
}

function useLibrary() {
	let library = useContext(LibraryContext)
	if (!library) throw new Error("LibraryProvider missing")
	return library
}

function useLibraryData() {
	let db = useDb()
	let auth = useJazzSession<JazzClient>()
	useEffect(() => {
		// Alpha.61's account-handle path omits this seed; API identity proofs need it.
		db.initLocalFirstAuth(
			auth.exportDeviceKey().replace(/^jazz-auth-v1:/, ""),
			60,
			false,
		)
	}, [db, auth])
	let ownerId = useSession()?.user
	if (!ownerId) throw new Error("Account missing")
	let documentSummaries = app.documents.select(
		"ownerId",
		"spaceId",
		"title",
		"tags",
		"path",
		"frontmatterPinned",
		"isPresentation",
		"publicRead",
		"commentsDisabled",
		"presentationLine",
		"highlightRange",
		"createdAt",
		"updatedAt",
		"deletedAt",
	)
	let { data: rows = [], isLoading } = useAll(documentSummaries)
	let { data: entries = [] } = useAll(app.userDocuments.where({ ownerId }))
	let { data: linkedRows = [] } = useAll(
		documentSummaries.where({
			id: { in: entries.map(entry => entry.documentId) },
		}),
	)
	let { data: folderRows = [] } = useAll(app.folders.where({ ownerId }))
	let { data: preferences = [], isLoading: settingsLoading } = useAll(
		app.settings.where({ ownerId }),
	)
	let { data: profiles = [], isLoading: profileLoading } = useAll(app.profiles)
	let { data: grants = [] } = useAll(app.documentGrants)
	useEffect(() => db.onMutationError(error => toast.error(error.reason)), [db])
	let { data: spaces = [] } = useAll(app.spaces)
	let { data: members = [] } = useAll(app.spaceMembers)
	let settings = preferences[0]
	useEffect(() => {
		if (
			!profileLoading &&
			!profiles.some(profile => profile.ownerId === ownerId) &&
			!sessionStorage.getItem("alkalye-restoring-account")
		)
			watchWrite(
				db.insert(app.profiles, { ownerId, name: getRandomWriterName() }),
			)
	}, [db, ownerId, profileLoading, profiles])

	let visibleRows = [
		...new Map([...rows, ...linkedRows].map(row => [row.id, row])).values(),
	]
	function folderPath(documentId: string) {
		let folderId = entries.find(
			entry => entry.documentId === documentId,
		)?.folderId
		let names: string[] = []
		let seen = new Set<string>()
		while (folderId && !seen.has(folderId)) {
			seen.add(folderId)
			let folder = folderRows.find(folder => folder.id === folderId)
			if (!folder) break
			names.unshift(folder.name)
			folderId = folder.parentId
		}
		return names.length ? names.join("/") : null
	}
	let [legacyMetadata, setLegacyMetadata] = useState<
		Record<string, ReturnType<typeof documentMetadata>>
	>({})
	useEffect(() => {
		let active = true
		async function load() {
			let missing = visibleRows.filter(
				row => row.frontmatterPinned === null && !legacyMetadata[row.id],
			)
			for (let row of missing) {
				let body = await db.one(
					app.documents.where({ id: row.id }).select("content"),
				)
				if (!active) return
				if (!body) continue
				let metadata = documentMetadata(body.content)
				setLegacyMetadata(current => ({ ...current, [row.id]: metadata }))
			}
		}
		void load().catch(console.error)
		return () => {
			active = false
		}
	}, [db, visibleRows, legacyMetadata])

	let documents: LibraryDocument[] = visibleRows
		.filter(
			row =>
				!entries.some(
					entry =>
						entry.documentId === row.id && entry.archived && !row.deletedAt,
				),
		)
		.map(row => ({
			...row,
			shared: grants.some(
				grant => grant.documentId === row.id && grant.accountId !== row.ownerId,
			),
			canEdit:
				row.ownerId === ownerId ||
				spaces.some(
					space => space.id === row.spaceId && space.ownerId === ownerId,
				) ||
				members.some(
					member =>
						member.spaceId === row.spaceId &&
						member.accountId === ownerId &&
						member.role !== "reader",
				) ||
				grants.some(
					grant =>
						grant.accountId === ownerId &&
						grant.documentId === row.id &&
						grant.role !== "reader",
				),
			canAdmin:
				row.ownerId === ownerId ||
				spaces.some(
					space => space.id === row.spaceId && space.ownerId === ownerId,
				) ||
				members.some(
					member =>
						member.spaceId === row.spaceId &&
						member.accountId === ownerId &&
						member.role === "admin",
				) ||
				grants.some(
					grant =>
						grant.accountId === ownerId &&
						grant.documentId === row.id &&
						grant.role === "admin",
				),
			deletedAt: row.deletedAt ?? undefined,
			path:
				(row.frontmatterPinned === null
					? (legacyMetadata[row.id]?.path ?? row.path)
					: row.path) ?? (!row.spaceId ? folderPath(row.id) : null),
			pinned:
				entries.find(entry => entry.documentId === row.id)?.pinned ??
				(row.frontmatterPinned ?? legacyMetadata[row.id]?.frontmatterPinned) ===
					true,
		}))
	useEffect(() => {
		if (
			settingsLoading ||
			settings ||
			sessionStorage.getItem("alkalye-restoring-account")
		)
			return
		watchWrite(
			db.insert(app.settings, { ownerId, editor: DEFAULT_EDITOR_SETTINGS }),
		)
	}, [db, ownerId, settings, settingsLoading])
	return {
		db,
		ownerId,
		documents,
		entries,
		settings,
		profile: profiles.find(profile => profile.ownerId === ownerId),
		profiles,
		grants,
		spaces,
		members,
		isLoading,
	}
}

async function createDocument(
	db: Database,
	ownerId: string,
	content = "",
	spaceId?: string,
) {
	let space = spaceId ? await db.one(app.spaces.where({ id: spaceId })) : null
	if (spaceId && !space) throw new Error("Space not found")
	let folderId = spaceId
		? undefined
		: await ensureFolder(db, ownerId, getPath(content))
	let write = await db.transaction(tx => {
		let now = new Date()
		let doc = tx.insert(app.documents, {
			ownerId: space?.ownerId ?? ownerId,
			spaceId,
			content,
			...documentMetadata(content),
			createdAt: now,
			updatedAt: now,
		})
		if (!spaceId)
			tx.insert(app.userDocuments, {
				ownerId,
				documentId: doc.id,
				folderId,
				pinned: parseFrontmatter(content).frontmatter?.pinned === true,
				rank: now.getTime(),
			})
		return doc
	})
	await write.wait({ tier: "local" })
	return write.value
}

function canEdit(doc: Pick<LibraryDocument, "canEdit">) {
	return doc.canEdit
}
function canAdmin(doc: Pick<LibraryDocument, "canAdmin">) {
	return doc.canAdmin
}

let pendingMetadata = new WeakMap<
	Database,
	Map<string, ReturnType<typeof setTimeout>>
>()

function scheduleMetadata(db: Database, id: string) {
	let pending = pendingMetadata.get(db)
	if (!pending) {
		pending = new Map()
		pendingMetadata.set(db, pending)
	}
	clearTimeout(pending.get(id))
	let updatedAt = new Date()
	pending.set(
		id,
		setTimeout(() => {
			pending.delete(id)
			void readDocument(db, id)
				.then(document => {
					watchWrite(
						db.update(app.documents, id, {
							...documentMetadata(document.content),
							updatedAt,
						}),
					)
				})
				.catch(error =>
					toast.error(
						error instanceof Error
							? error.message
							: "Could not save document metadata",
					),
				)
		}, 300),
	)
}

function writeDocumentContent(
	db: Database,
	id: string,
	content: string,
	original: string,
	deferMetadata: boolean,
	edit?: TextEdit,
) {
	function write() {
		let transaction = db.beginTransaction()
		try {
			transaction.update(
				app.documents,
				id,
				{
					content,
					...(deferMetadata
						? {}
						: { ...documentMetadata(content), updatedAt: new Date() }),
				},
				{
					editedFrom: { content: original },
					...(edit ? { editedSplices: { content: edit } } : {}),
				},
			)
			return transaction.commit()
		} catch (error) {
			void transaction.rollback().catch(() => {})
			throw error
		}
	}
	return deferMetadata ? afterPaint(write) : write()
}

let scheduledContentWrites: (() => void)[] = []

function afterPaint<T>(write: () => T) {
	if (document.visibilityState !== "visible") return Promise.resolve(write())
	let result = new Promise<T>((resolve, reject) => {
		scheduledContentWrites.push(() => {
			try {
				resolve(write())
			} catch (error) {
				reject(error)
			}
		})
	})
	if (scheduledContentWrites.length > 1) return result
	let flushed = false
	let frame = requestAnimationFrame(() => setTimeout(flush, 0))
	let deadline = setTimeout(flush, 40)
	window.addEventListener("pagehide", flush)
	document.addEventListener("visibilitychange", flushWhenHidden)
	function flushWhenHidden() {
		if (document.visibilityState !== "visible") flush()
	}
	function flush() {
		if (flushed) return
		flushed = true
		cancelAnimationFrame(frame)
		clearTimeout(deadline)
		window.removeEventListener("pagehide", flush)
		document.removeEventListener("visibilitychange", flushWhenHidden)
		let writes = scheduledContentWrites
		scheduledContentWrites = []
		// Stage and commit synchronously: navigation can discard Promise continuations.
		for (let submit of writes) submit()
	}
	return result
}

// Older durability waits must not retain a full document for every keystroke.
let saveNotifications = new WeakMap<
	Database,
	Map<string, { token: symbol; content: string }>
>()

function notifySaved(
	db: Database,
	id: string,
	content: string,
	write: WriteHandle<unknown, unknown>,
) {
	let pending = saveNotifications.get(db)
	if (!pending) {
		pending = new Map()
		saveNotifications.set(db, pending)
	}
	let token = Symbol()
	pending.set(id, { token, content })
	void write
		.wait({ tier: "local" })
		.then(() => {
			let saved = pending.get(id)
			if (saved?.token !== token) return
			pending.delete(id)
			window.dispatchEvent(
				new CustomEvent("alkalye:document-saved", {
					detail: { documentId: id, content: saved.content },
				}),
			)
		})
		.catch(() => {
			if (pending.get(id)?.token === token) pending.delete(id)
		})
}

async function updateContent(
	db: Database,
	doc: DocumentRow | LibraryDocument,
	content: string,
	editedFrom?: string,
	{
		deferMetadata = false,
		edit,
	}: { deferMetadata?: boolean; edit?: TextEdit } = {},
) {
	editedFrom ??= (await readDocument(db, doc.id)).content
	let original = editedFrom
	let write = await writeDocumentContent(
		db,
		doc.id,
		content,
		original,
		deferMetadata,
		edit,
	)
	watchWrite(write)
	if (deferMetadata) scheduleMetadata(db, doc.id)
	else clearTimeout(pendingMetadata.get(db)?.get(doc.id))
	if (parseFrontmatter(content).frontmatter?.["theme-source"]) {
		let { syncThemeFromSource } = await import("@/app/features/themes")
		await syncThemeFromSource(db, doc.id, content)
	}
	notifySaved(db, doc.id, content, write)
	let ownerId = db.getAuthState().session?.user
	if (ownerId && getPath(editedFrom) !== getPath(content)) {
		let folderId = await ensureFolder(db, ownerId, getPath(content))
		let entry = await db.one(
			app.userDocuments.where({ ownerId, documentId: doc.id }),
		)
		if (entry) watchWrite(db.update(app.userDocuments, entry.id, { folderId }))
	}
	// Preserve Classic's visible frontmatter backlinks, scoped to the same library.
	let before = new Set(parseWikiLinks(editedFrom).map(link => link.id))
	let after = new Set(parseWikiLinks(content).map(link => link.id))
	if ([...before].every(id => after.has(id)) && before.size === after.size)
		return
	await enqueueBacklinks(db, doc.id, async () => {
		let targets = await Promise.all(
			[...new Set([...before, ...after])]
				.filter(
					id =>
						/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
							id,
						) && before.has(id) !== after.has(id),
				)
				.map(id => db.one(app.documents.where({ id }))),
		)
		let entries = await db.all(app.userDocuments)
		let personalIds = new Set(entries.map(entry => entry.documentId))
		for (let target of targets) {
			if (
				!target ||
				target.id === doc.id ||
				target.deletedAt ||
				target.spaceId !== doc.spaceId ||
				(!doc.spaceId && !personalIds.has(target.id))
			)
				continue
			let next = target.content
			if (after.has(target.id) && !before.has(target.id))
				next = addBacklink(next, doc.id)
			if (before.has(target.id) && !after.has(target.id))
				next = removeBacklink(next, doc.id)
			if (next !== target.content)
				watchWrite(
					await db.transaction(tx =>
						tx.update(
							app.documents,
							target.id,
							{ content: next, updatedAt: new Date() },
							{ editedFrom: { content: target.content } },
						),
					),
				)
		}
	})
}

async function setPinned(
	db: Database,
	ownerId: string,
	doc: LibraryDocument,
	pinned: boolean,
) {
	let entries = await db.all(
		app.userDocuments.where({ ownerId, documentId: doc.id }),
	)
	let entry = entries[0]
	if (entry) watchWrite(db.update(app.userDocuments, entry.id, { pinned }))
	else
		watchWrite(
			db.insert(app.userDocuments, {
				ownerId,
				documentId: doc.id,
				rank: Date.now(),
				pinned,
			}),
		)
	let loaded = await readDocument(db, doc.id)
	let currentPinned =
		parseFrontmatter(loaded.content).frontmatter?.pinned === true
	if (currentPinned !== pinned)
		await updateContent(db, loaded, togglePinned(loaded.content))
}

async function ensureFolder(
	db: Database,
	ownerId: string,
	path: string | null,
): Promise<string | null> {
	if (!path) return null
	let parentId: string | null = null
	for (let name of path.split("/").filter(Boolean)) {
		let folder: schema.RowOf<typeof app.folders> | null = await db.one(
			app.folders.where({ ownerId, parentId, name }),
		)
		if (folder) parentId = folder.id
		else {
			let write = db.insert(app.folders, {
				ownerId,
				parentId,
				name,
				rank: Date.now(),
			})
			let created: schema.RowOf<typeof app.folders> = await write.wait({
				tier: "local",
			})
			parentId = created.id
		}
	}
	return parentId
}

let backlinkWrites = new WeakMap<Database, Map<string, Promise<void>>>()
function enqueueBacklinks(
	db: Database,
	documentId: string,
	update: () => Promise<void>,
) {
	let queue = backlinkWrites.get(db)
	if (!queue) {
		queue = new Map()
		backlinkWrites.set(db, queue)
	}
	let previous = queue.get(documentId) ?? Promise.resolve()
	let next = previous.catch(() => {}).then(update)
	queue.set(documentId, next)
	void next
		.finally(() => {
			if (queue.get(documentId) === next) queue.delete(documentId)
		})
		.catch(() => {})
	return next
}

async function readDocument(db: Database, id: string) {
	let doc = await db.one(app.documents.where({ id }))
	if (!doc) throw new Error("Document unavailable")
	return doc
}
