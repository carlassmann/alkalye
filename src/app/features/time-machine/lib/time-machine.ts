import { app } from "@/jazz/schema"
import type { Database } from "@/app/features/documents"
import type { schema } from "jazz-tools"

export {
	getEditHistory,
	restoreAssetsAtTime,
	formatEditDate,
	groupEditsByDay,
	getDateKey,
	historyQuery,
	getAssetsAtTime,
}
export type { EditHistoryItem, DayGroup }

function historyQuery(id: string) {
	return app.$history.documents
		.where({ id })
		.orderBy("$acceptedAt", "asc")
		.select("content", "$acceptedAt", "$transactionId", "$updatedBy")
}
type EditHistoryItem = {
	index: number
	madeAt: Date
	accountId: string | null
	authorName?: string | null
	content: string
	key: string
}
function getEditHistory(
	versions: {
		content: string
		$acceptedAt: Date
		$transactionId: string
		$updatedBy: { account: string | null; identity: { subject: string } }
	}[],
	imported: schema.RowOf<typeof app.documentVersions>[],
): EditHistoryItem[] {
	let edits = [
		...versions.map(version => ({
			madeAt: version.$acceptedAt,
			accountId:
				version.$updatedBy.account ?? version.$updatedBy.identity.subject,
			content: version.content,
			key: version.$transactionId,
			authorName: null,
		})),
		...imported.map(version => ({
			madeAt: version.createdAt,
			accountId: version.authorId,
			authorName: version.authorName,
			content: version.content,
			key: version.id,
		})),
	].sort(
		(a, b) =>
			a.madeAt.getTime() - b.madeAt.getTime() || a.key.localeCompare(b.key),
	)
	// Presentation and sharing changes produce document versions without text edits.
	return edits
		.filter(
			(edit, index) => index === 0 || edit.content !== edits[index - 1].content,
		)
		.map((edit, index) => ({ ...edit, index }))
}
async function restoreAssetsAtTime(
	db: Database,
	documentId: string,
	timestamp: number,
) {
	let assets = await db.all(
		app.assets.where({ documentId }).includeDeleted().select("*", "$deletedAt"),
	)
	let versions = await getAssetsAtTime(db, documentId, timestamp)
	let restorations = assets.map(asset => ({
		asset,
		version: versions.find(version => version.id === asset.id),
	}))

	if (!restorations.some(({ asset, version }) => version || !asset.$deletedAt))
		return
	let write = await db.transaction(tx => {
		for (let { asset, version } of restorations) {
			if (
				!version ||
				(asset.$deletedAt && asset.$deletedAt.getTime() <= timestamp)
			) {
				if (!asset.$deletedAt) tx.delete(app.assets, asset.id)
				continue
			}
			let {
				type,
				name,
				data,
				mimeType,
				muteAudio,
				width,
				height,
				revisionId,
				createdAt,
			} = version
			let values = {
				documentId,
				type,
				name,
				data,
				mimeType,
				muteAudio,
				width,
				height,
				revisionId,
				createdAt,
			}
			if (asset.$deletedAt) tx.restore(app.assets, asset.id, values)
			else tx.update(app.assets, asset.id, values)
		}
	})
	await write.wait({ tier: "local" })
}

function formatEditDate(date: Date): string {
	return date.toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
	})
}

interface DayGroup {
	dateKey: string
	date: Date
	edits: EditHistoryItem[]
	lastEditIndex: number
}

function getDateKey(date: Date): string {
	let year = date.getFullYear()
	let month = String(date.getMonth() + 1).padStart(2, "0")
	let day = String(date.getDate()).padStart(2, "0")
	return `${year}-${month}-${day}`
}

function groupEditsByDay(edits: EditHistoryItem[]): DayGroup[] {
	let dayMap = new Map<string, DayGroup>()

	for (let edit of edits) {
		let dateKey = getDateKey(edit.madeAt)

		if (!dayMap.has(dateKey)) {
			let startOfDay = new Date(edit.madeAt)
			startOfDay.setHours(0, 0, 0, 0)

			dayMap.set(dateKey, {
				dateKey,
				date: startOfDay,
				edits: [],
				lastEditIndex: edit.index,
			})
		}

		let group = dayMap.get(dateKey)!
		group.edits.push(edit)
		group.lastEditIndex = edit.index
	}

	return [...dayMap.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey))
}

async function getAssetsAtTime(
	db: Database,
	documentId: string,
	timestamp: number,
) {
	let assets = await db.all(
		app.assets.where({ documentId }).includeDeleted().select("*", "$deletedAt"),
	)
	let versions = await Promise.all(
		assets.map(async asset => {
			if (asset.$deletedAt && asset.$deletedAt.getTime() <= timestamp) return []
			let history = await db.all(
				app.$history.assets
					.where({ id: asset.id })
					.includeDeleted()
					.orderBy("$acceptedAt", "asc"),
			)
			let version = history
				.filter(version => version.$acceptedAt.getTime() <= timestamp)
				.at(-1)
			return version ? [version] : []
		}),
	)
	return versions.flat()
}
