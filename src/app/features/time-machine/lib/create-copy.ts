import { app, type DocumentRow } from "@/jazz/schema"
import { getDocumentTitle, type Database } from "@/app/features/documents"
import {
	loadCommentDocument,
	getExportCommentsForContent,
	restoreExportedComments,
} from "@/app/features/comments"
import { getAssetsAtTime, formatEditDate } from "./time-machine"

export { createTimeMachineCopy }

async function createTimeMachineCopy(
	db: Database,
	ownerId: string,
	doc: DocumentRow,
	content: string,
	timestamp: number,
) {
	let source = await loadCommentDocument(db, doc)
	let assets = await getAssetsAtTime(db, doc.id, timestamp)
	let revisions = await db.all(
		app.tldrawRevisions.where({
			id: {
				in: assets.flatMap(asset =>
					asset.revisionId ? [asset.revisionId] : [],
				),
			},
		}),
	)
	let assetIds = new Map(assets.map(asset => [asset.id, crypto.randomUUID()]))
	for (let [before, after] of assetIds)
		content = content.replaceAll(`(asset:${before})`, `(asset:${after})`)
	let lines = content.split("\n"),
		title = `${doc.title} (restored)`
	if (lines[0]?.startsWith("#")) lines[0] = `# ${title}`
	else lines.unshift(`# ${title}`)
	let finalContent =
		`---\ntimemachine: restored from ${doc.title} at ${formatEditDate(new Date(timestamp))}\n---\n\n` +
		lines.join("\n")
	let comments = getExportCommentsForContent(source, finalContent)
	let write = await db.transaction(tx => {
		let now = new Date()
		let copy = tx.insert(app.documents, {
			ownerId,
			spaceId: doc.spaceId,
			title: getDocumentTitle(finalContent),
			content: finalContent,
			commentsDisabled: doc.commentsDisabled,
			createdAt: now,
			updatedAt: now,
		})
		if (!doc.spaceId)
			tx.insert(app.userDocuments, {
				ownerId,
				documentId: copy.id,
				rank: now.getTime(),
			})
		for (let asset of assets) {
			let { type, name, data, mimeType, muteAudio, width, height, revisionId } =
				asset
			let revision = revisions.find(revision => revision.id === revisionId)
			if (revision)
				revisionId = tx.insert(app.tldrawRevisions, {
					documentId: copy.id,
					snapshot: revision.snapshot,
					lightPreview: revision.lightPreview,
					darkPreview: revision.darkPreview,
					createdAt: now,
				}).id

			tx.insert(
				app.assets,
				{
					documentId: copy.id,
					type,
					name,
					data,
					mimeType,
					muteAudio,
					width,
					height,
					revisionId,
					createdAt: now,
				},
				{ id: assetIds.get(asset.id) },
			)
		}
		return copy
	})
	let copy = await write.wait({ tier: "local" })
	await restoreExportedComments({ ...copy, db, comments: [] }, comments)
	return copy
}
