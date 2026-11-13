import { z } from "zod"
import { createJazzClient } from "jazz-tools/client"
import { app } from "@/jazz/schema"
import { deviceSecretFromSeed, readClassicCredentials } from "./identity"
import { packBytes } from "./conversion"
export { inspectClassicMigration }

async function inspectClassicMigration() {
	let credentials = readClassicCredentials()
	if (!credentials) throw new Error("Run in a migrated Classic fixture profile")
	let session = await createJazzClient({
		serverUrl: "/jazz",
		initial: "device",
		localFirst: "now",
		client: () => import("jazz-tools/local-first"),
	})
	await session.restoreDeviceAccount(
		deviceSecretFromSeed(new Uint8Array(credentials.secretSeed)),
	)
	try {
		let db = session.db
		let [
			documents,
			spaces,
			members,
			grants,
			entries,
			folders,
			settings,
			themes,
			versions,
			threads,
			replies,
			assets,
			revisions,
			themeAssets,
		] = await Promise.all([
			db.all(app.documents, { tier: "remote" }),
			db.all(app.spaces, { tier: "remote" }),
			db.all(app.spaceMembers, { tier: "remote" }),
			db.all(app.documentGrants, { tier: "remote" }),
			db.all(app.userDocuments, { tier: "remote" }),
			db.all(app.folders, { tier: "remote" }),
			db.all(app.settings, { tier: "remote" }),
			db.all(app.themes, { tier: "remote" }),
			db.all(app.documentVersions, { tier: "remote" }),
			db.all(app.commentThreads, { tier: "remote" }),
			db.all(app.commentReplies, { tier: "remote" }),
			db.all(app.assets, { tier: "remote" }),
			db.all(app.tldrawRevisions, { tier: "remote" }),
			db.all(app.themeAssets, { tier: "remote" }),
		])
		let hashes = []
		for (let asset of assets)
			if (asset.data)
				hashes.push({
					id: asset.id,
					sha256: (await packBytes(new Uint8Array(asset.data))).sha256,
				})
		let anchors = threads.map(thread => {
			let doc = documents.find(doc => doc.id === thread.documentId)
			if (!doc) return { id: thread.id, found: false }
			let stored = z
				.object({
					range: z.object({
						before: z.string(),
						matched: z.string(),
						after: z.string(),
						start: z.number().optional(),
						end: z.number().optional(),
						version: z.number().optional(),
					}),
				})
				.safeParse(thread.anchor)
			if (!stored.success) return { id: thread.id, found: false }
			let anchor = db.textAnchors().resolveRange(stored.data.range, doc.content)
			return {
				id: thread.id,
				start: anchor.start,
				end: anchor.end,
				quote: doc.content.slice(anchor.start, anchor.end),
			}
		})
		return {
			documents: documents.map(doc => ({
				id: doc.id,
				title: doc.title,
				tags: doc.tags,
				path: doc.path,
				frontmatterPinned: doc.frontmatterPinned,
				ownerId: doc.ownerId,
				spaceId: doc.spaceId,
				publicRead: doc.publicRead,
				content: doc.content,
			})),
			spaces,
			members,
			grants,
			entries,
			folders,
			settings,
			themes: themes.map(theme => ({ id: theme.id, name: theme.name })),
			versions: versions.map(version => ({
				id: version.id,
				documentId: version.documentId,
				authorId: version.authorId,
				createdAt: version.createdAt,
			})),
			anchors,
			themeHashes: await Promise.all(
				themeAssets.map(async asset => ({
					id: asset.id,
					sha256: (await packBytes(new Uint8Array(asset.data))).sha256,
				})),
			),
			replies: replies.map(reply => ({ id: reply.id, body: reply.body })),
			hashes,
			revisionCount: revisions.length,
		}
	} finally {
		await session.close()
	}
}
