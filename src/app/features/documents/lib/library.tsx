import { toast } from "sonner"
import { createContext, useContext, useEffect } from "react"
import { useAll, useDb, useSession } from "jazz-tools/react"
import { schema } from "jazz-tools"
import { app, type DocumentRow } from "@/jazz/schema"
import { DEFAULT_EDITOR_SETTINGS } from "@/jazz/value-types"
import {
	getPath,
	getTags,
	parseFrontmatter,
	addBacklink,
	removeBacklink,
	togglePinned,
} from "@/app/features/editor/lib/frontmatter"
import { parseWikiLinks } from "@/app/features/editor/lib/wikilink-parser"
import { getDocumentTitle } from "./title"
import { watchWrite } from "./writes"

export {
	app,
	LibraryProvider,
	useLibrary,
	createDocument,
	updateContent,
	setPinned,
	canEdit,
	canAdmin,
}
export type { Database, LibraryDocument, SettingsRow }

type Database = ReturnType<typeof useDb>
type SettingsRow = schema.RowOf<typeof app.settings>
type LibraryDocument = Omit<DocumentRow, "deletedAt"> & {
	deletedAt?: Date
	path: string | null
	pinned: boolean
	canEdit: boolean
	canAdmin: boolean
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
	let ownerId = useSession()?.user
	if (!ownerId) throw new Error("Account missing")
	let { data: rows = [], isLoading } = useAll(app.documents.where({ ownerId }))
	let { data: entries = [] } = useAll(app.userDocuments.where({ ownerId }))
	let { data: preferences = [], isLoading: settingsLoading } = useAll(
		app.settings.where({ ownerId }),
	)
	let { data: profiles = [] } = useAll(app.profiles.where({ ownerId }))
	let { data: grants = [] } = useAll(
		app.documentGrants.where({ accountId: ownerId }),
	)
	useEffect(() => db.onMutationError(error => toast.error(error.reason)), [db])
	let settings = preferences[0]
	let documents: LibraryDocument[] = rows.map(row => ({
		...row,
		canEdit:
			row.ownerId === ownerId ||
			grants.some(
				grant => grant.documentId === row.id && grant.role !== "reader",
			),
		canAdmin:
			row.ownerId === ownerId ||
			grants.some(
				grant => grant.documentId === row.id && grant.role === "admin",
			),
		deletedAt: row.deletedAt ?? undefined,
		path: getPath(row.content),
		pinned:
			entries.find(entry => entry.documentId === row.id)?.pinned ??
			parseFrontmatter(row.content).frontmatter?.pinned === true,
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
		profile: profiles[0],
		grants,
		isLoading,
	}
}

async function createDocument(db: Database, ownerId: string, content = "") {
	let folderId = await ensureFolder(db, ownerId, getPath(content))
	let write = await db.transaction(tx => {
		let now = new Date()
		let doc = tx.insert(app.documents, {
			ownerId,
			content,
			title: getDocumentTitle(content),
			tags: getTags(content),
			createdAt: now,
			updatedAt: now,
		})
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

async function updateContent(
	db: Database,
	doc: DocumentRow | LibraryDocument,
	content: string,
	editedFrom = doc.content,
) {
	let write = await db.transaction(tx =>
		tx.update(
			app.documents,
			doc.id,
			{
				content,
				title: getDocumentTitle(content),
				tags: getTags(content),
				updatedAt: new Date(),
			},
			{ editedFrom: { content: editedFrom } },
		),
	)
	watchWrite(write)
	void write
		.wait({ tier: "local" })
		.then(() =>
			window.dispatchEvent(
				new CustomEvent("alkalye:document-saved", {
					detail: { documentId: doc.id, content },
				}),
			),
		)
		.catch(() => {})
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
		let targets = await db.all(app.documents)
		let entries = await db.all(app.userDocuments)
		let personalIds = new Set(entries.map(entry => entry.documentId))
		for (let target of targets) {
			if (
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
	let currentPinned = parseFrontmatter(doc.content).frontmatter?.pinned === true
	if (currentPinned !== pinned)
		await updateContent(db, doc, togglePinned(doc.content))
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
