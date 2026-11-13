import { get, set, del } from "idb-keyval"
import { app, type Database } from "@/app/features/documents/lib/library"
import { exportComments } from "@/app/features/import-export/lib/comment-format"
import { isWelcomeDoc } from "@/app/features/documents/lib/welcome-doc"

export { saveGuestTransfer, restoreGuestTransfer }

async function saveGuestTransfer(
	db: Database,
	ownerId: string,
	targetKey: string,
) {
	let key = await transferKey(targetKey)
	let previous = await get<GuestSnapshot>(key)
	let snapshot = await captureGuest(db, ownerId)
	if (previous) {
		snapshot.documents = mergeRows(previous.documents, snapshot.documents)
		snapshot.folders = mergeRows(previous.folders, snapshot.folders)
		snapshot.entries = mergeRows(previous.entries, snapshot.entries)
		snapshot.assets = mergeRows(previous.assets, snapshot.assets)
		snapshot.revisions = mergeRows(previous.revisions, snapshot.revisions)
		snapshot.themes = mergeRows(previous.themes, snapshot.themes)
		snapshot.themeAssets = mergeRows(previous.themeAssets, snapshot.themeAssets)
		snapshot.comments = [
			...new Map(
				[...previous.comments, ...snapshot.comments].map(row => [
					row.documentId,
					row,
				]),
			).values(),
		]
		snapshot.ids = new Map([...snapshot.ids, ...previous.ids])
		snapshot.settings ??= previous.settings
	}
	await set(key, snapshot)
}

let activeTransfers = new WeakMap<Database, Promise<void>>()
function restoreGuestTransfer(
	db: Database,
	ownerId: string,
	deviceKey: string,
) {
	let active = activeTransfers.get(db)
	if (active) return active
	let transfer = applyGuestTransfer(db, ownerId, deviceKey).finally(() =>
		activeTransfers.delete(db),
	)
	activeTransfers.set(db, transfer)
	return transfer
}

async function captureGuest(db: Database, ownerId: string) {
	let documents = (await db.all(app.documents.where({ ownerId }))).filter(
		doc =>
			!doc.spaceId &&
			(!isWelcomeDoc(doc.content) ||
				doc.updatedAt.getTime() !== doc.createdAt.getTime()),
	)
	let documentIds = documents.map(doc => doc.id)
	let folders = await db.all(app.folders.where({ ownerId }))
	let entries = await db.all(
		app.userDocuments.where({ ownerId, documentId: { in: documentIds } }),
	)
	let settings = await db.one(app.settings.where({ ownerId }))
	let themes = await db.all(app.themes.where({ ownerId }))
	let themeAssets = await db.all(
		app.themeAssets.where({ themeId: { in: themes.map(theme => theme.id) } }),
	)
	let assets = await db.all(
		app.assets.where({ documentId: { in: documentIds } }),
	)
	let revisions = await db.all(
		app.tldrawRevisions.where({ documentId: { in: documentIds } }),
	)
	let comments = await Promise.all(
		documents.map(async doc => ({
			documentId: doc.id,
			threads: (await exportComments(db, doc.id)).map(comment => ({
				...comment,
				id: crypto.randomUUID(),
				replies: comment.replies.map(reply => ({
					...reply,
					id: crypto.randomUUID(),
				})),
			})),
		})),
	)
	let ids = new Map(
		[
			...documents,
			...folders,
			...entries,
			...assets,
			...revisions,
			...themes,
			...themeAssets,
			...(settings ? [settings] : []),
		].map(row => [row.id, crypto.randomUUID()]),
	)
	return {
		documents,
		folders,
		entries,
		settings,
		themes,
		themeAssets,
		assets,
		revisions,
		comments,
		ids,
	}
}

type GuestSnapshot = Awaited<ReturnType<typeof captureGuest>>

async function applyGuestTransfer(
	db: Database,
	ownerId: string,
	deviceKey: string,
) {
	let key = await transferKey(deviceKey)
	let snapshot = await get<GuestSnapshot>(key)
	if (!snapshot) return
	let {
		documents,
		folders,
		entries,
		settings,
		themes,
		themeAssets,
		assets,
		revisions,
		comments,
		ids,
	} = snapshot
	function mapped(id: string | null) {
		return id ? (ids.get(id) ?? id) : null
	}
	function required(id: string) {
		return ids.get(id) ?? id
	}
	function rewrite(content: string) {
		for (let [before, after] of ids) content = content.replaceAll(before, after)
		return content
	}
	let existing = new Set(
		(
			await db.all(
				app.documents
					.where({ id: { in: documents.map(doc => required(doc.id)) } })
					.select("id"),
			)
		).map(row => row.id),
	)
	let existingFolders = new Set(
		(await db.all(app.folders.where({ ownerId }))).map(row => row.id),
	)
	let existingThemes = new Set(
		(await db.all(app.themes.where({ ownerId }))).map(row => row.id),
	)
	let targetSettings = await db.one(
		app.settings.where({ ownerId }),
		db.getSyncStatus().link.state === "connected"
			? { tier: "remote" }
			: undefined,
	)
	if (
		documents.every(doc => existing.has(required(doc.id))) &&
		folders.every(folder => existingFolders.has(required(folder.id))) &&
		(!settings || targetSettings) &&
		themes.every(theme => existingThemes.has(required(theme.id)))
	) {
		await restoreCommentSettings(db, documents, required)
		void db
			.waitForSync()
			.then(() => del(key))
			.catch(console.error)
		return
	}
	let write = await db.transaction(tx => {
		for (let folder of folders)
			if (!existingFolders.has(required(folder.id)))
				tx.insert(
					app.folders,
					{
						...columns(folder),
						ownerId,
						parentId: mapped(folder.parentId),
					},
					{ id: required(folder.id) },
				)
		if (settings && !targetSettings)
			tx.insert(
				app.settings,
				{
					...columns(settings),
					ownerId,
					defaultPreviewTheme: mapped(settings.defaultPreviewTheme),
					defaultSlideshowTheme: mapped(settings.defaultSlideshowTheme),
				},
				{ id: required(settings.id) },
			)
		for (let theme of themes) {
			if (existingThemes.has(required(theme.id))) continue
			tx.insert(
				app.themes,
				{ ...columns(theme), ownerId, sourceDocId: mapped(theme.sourceDocId) },
				{ id: required(theme.id) },
			)
			for (let asset of themeAssets.filter(asset => asset.themeId === theme.id))
				tx.insert(
					app.themeAssets,
					{ ...columns(asset), themeId: required(theme.id) },
					{ id: required(asset.id) },
				)
		}
		for (let doc of documents) {
			if (existing.has(required(doc.id))) continue
			tx.insert(
				app.documents,
				{
					...columns(doc),
					ownerId,
					publicRead: false,
					// The policy admits comment inserts only while comments are enabled.
					commentsDisabled: false,
					content: rewrite(doc.content),
				},
				{ id: required(doc.id) },
			)
			for (let entry of entries.filter(entry => entry.documentId === doc.id))
				tx.insert(
					app.userDocuments,
					{
						...columns(entry),
						ownerId,
						documentId: required(doc.id),
						folderId: mapped(entry.folderId),
					},
					{ id: required(entry.id) },
				)
			for (let revision of revisions.filter(row => row.documentId === doc.id))
				tx.insert(
					app.tldrawRevisions,
					{
						...columns(revision),
						documentId: required(doc.id),
					},
					{ id: required(revision.id) },
				)
			for (let asset of assets.filter(row => row.documentId === doc.id))
				tx.insert(
					app.assets,
					{
						...columns(asset),
						documentId: required(doc.id),
						revisionId: mapped(asset.revisionId),
					},
					{ id: required(asset.id) },
				)
			for (let comment of comments.find(row => row.documentId === doc.id)
				?.threads ?? []) {
				tx.insert(
					app.commentThreads,
					{
						documentId: required(doc.id),
						authorId: ownerId,
						anchor: {
							quote: rewrite(comment.quote),
							contextBefore: rewrite(comment.contextBefore),
							contextAfter: rewrite(comment.contextAfter),
						},
						createdAt: new Date(comment.createdAt),
						updatedAt: new Date(comment.updatedAt),
						resolvedAt: comment.resolved ? new Date(comment.updatedAt) : null,
					},
					{ id: comment.id },
				)
				for (let reply of comment.replies)
					tx.insert(
						app.commentReplies,
						{
							...columns(reply),
							authorId: ownerId,
							threadId: comment.id,
							createdAt: new Date(reply.createdAt),
							updatedAt: reply.updatedAt ? new Date(reply.updatedAt) : null,
						},
						{ id: reply.id },
					)
			}
		}
	})
	await write.wait({ tier: "local" })
	await restoreCommentSettings(db, documents, required)
	// Keep the snapshot until the backend accepts the replay, including across offline reloads.
	void write
		.wait({ tier: "global" })
		.then(() => db.waitForSync())
		.then(() => del(key))
		.catch(console.error)
}

async function transferKey(secret: string) {
	let bytes = new TextEncoder().encode(secret.replace(/^jazz-auth-v1:/, ""))
	let digest = await crypto.subtle.digest("SHA-256", bytes)
	return `alkalye:guest-transfer:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`
}

function columns<T extends { id: string }>(row: T) {
	let { id, ...data } = row
	void id
	return data
}

function mergeRows<T extends { id: string }>(previous: T[], current: T[]) {
	return [
		...new Map([...previous, ...current].map(row => [row.id, row])).values(),
	]
}

async function restoreCommentSettings(
	db: Database,
	documents: GuestSnapshot["documents"],
	mapped: (id: string) => string,
) {
	for (let doc of documents) {
		if (!doc.commentsDisabled) continue
		let copy = await db.one(
			app.documents.where({ id: mapped(doc.id) }).select("commentsDisabled"),
		)
		if (copy && !copy.commentsDisabled)
			await db
				.update(app.documents, mapped(doc.id), { commentsDisabled: true })
				.wait({ tier: "local" })
	}
}
