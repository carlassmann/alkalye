import { WasmCrypto } from "cojson/crypto/WasmCrypto"
import { app } from "@/jazz/schema"
import { jazz } from "@/jazz/server"
import { documentMetadata } from "@/app/features/documents/lib/metadata"
import {
	importItemSchema,
	proofSchema,
	classicIdSchema,
	type ImportItem,
} from "./contract"
import { verifyClassicProof, readClassicAccess } from "./verification"
import { stableId, rewriteReferences, resolveClassicAnchor } from "./conversion"
import { z } from "zod"
import { verifiedIdentity, authorizeSnapshot } from "./authorization"
import { reconcileClassicAccess, activateVerifiedAccess } from "./access"
import {
	uploadChunk,
	readBytes,
	cleanupUploads,
	discardChunks,
} from "./uploads"
export {
	challenge,
	importClassicItem,
	claimClassicAccount,
	uploadChunk,
	importStagedItem,
	prepareClassicItem,
	lookupClassicItem,
}

async function challenge(accountId: string) {
	await cleanupUploads()
	let nonce = crypto.randomUUID()
	let challengeId = crypto.randomUUID()
	let write = jazz.db.insert(
		app.classicChallenges,
		{
			ownerId: accountId,
			nonce,
			expiresAt: new Date(Date.now() + 30 * 60_000),
		},
		{ id: challengeId },
	)
	await write.wait({ tier: "global" })
	return { challengeId, nonce, accountId }
}
async function claimClassicAccount(accountId: string, input: unknown) {
	let proof = proofSchema.parse(input)
	let row = await jazz.db.one(
		app.classicChallenges.where({ id: proof.challengeId }),
	)
	if (!row || row.ownerId !== accountId || row.expiresAt.getTime() < Date.now())
		throw new Error("Classic challenge expired")
	let crypto = await WasmCrypto.create()
	if (!verifyClassicProof(crypto, proof, { nonce: row.nonce, accountId }))
		throw new Error("Invalid Classic identity proof")
	let id = await stableId(`account:${proof.classicId}`)
	let existing = await jazz.db.one(app.classicAccounts.where({ id }))
	if (existing && existing.ownerId !== accountId)
		throw new Error(
			"Classic identity already claimed by another device account",
		)
	if (!existing)
		await jazz.db
			.insert(
				app.classicAccounts,
				{ ownerId: accountId, classicId: proof.classicId },
				{ id },
			)
			.wait({ tier: "global" })
	await jazz.db
		.update(app.classicChallenges, row.id, { classicId: proof.classicId })
		.wait({ tier: "global" })
	for (let access of await jazz.db.all(
		app.classicAccess.where({ classicId: proof.classicId }),
	)) {
		let imported = await jazz.db.one(
			app.classicImports.where({ v2Id: access.resourceId }),
		)
		if (!imported) continue
		try {
			let verified = await readClassicAccess(
				imported.classicId,
				proof.classicId,
			)
			let role = z
				.enum(["reader", "writer", "manager", "admin"])
				.parse(verified.role)
			await activateVerifiedAccess(accountId, imported.classicId, access)
			if (verified.ownerClassicId === proof.classicId && role === "admin") {
				if (
					imported.kind === "document" &&
					(await jazz.db.one(app.documents.where({ id: imported.v2Id })))
						?.ownerId === (await stableId(`owner:${imported.classicId}`))
				)
					await jazz.db
						.update(app.documents, imported.v2Id, { ownerId: accountId })
						.wait({ tier: "global" })
				if (
					imported.kind === "space" &&
					(await jazz.db.one(app.spaces.where({ id: imported.v2Id })))
						?.ownerId === (await stableId(`owner:${imported.classicId}`))
				)
					await jazz.db
						.update(app.spaces, imported.v2Id, { ownerId: accountId })
						.wait({ tier: "global" })
			}
		} catch (error) {
			if (
				!(error instanceof Error) ||
				error.message !== "Classic read access denied"
			)
				throw error
		}
	}

	let originalAuthor = await stableId(`author:${proof.classicId}`)
	for (let thread of await jazz.db.all(
		app.commentThreads.where({ authorId: originalAuthor }),
	))
		await jazz.db
			.update(app.commentThreads, thread.id, { authorId: accountId })
			.wait({ tier: "global" })
	for (let reply of await jazz.db.all(
		app.commentReplies.where({ authorId: originalAuthor }),
	))
		await jazz.db
			.update(app.commentReplies, reply.id, { authorId: accountId })
			.wait({ tier: "global" })
	return { classicId: proof.classicId }
}
async function importClassicItem(accountId: string, input: unknown) {
	let { challengeId, item: rawItem } = z
		.object({ challengeId: z.uuid(), item: z.unknown() })
		.parse(input)
	let identity = await verifiedIdentity(accountId, challengeId)
	await cleanupUploads()
	let item = importItemSchema.parse(rawItem)
	let id = await stableId(item.classicId)
	let mapId = await stableId(`map:${item.classicId}`)
	let previous = await jazz.db.one(app.classicImports.where({ id: mapId }))
	let access =
		item.kind === "account"
			? null
			: await readClassicAccess(item.classicId, identity.classicId)
	if (access?.role === "reader") {
		let prepared = await prepareClassicItem(accountId, {
			challengeId,
			classicId: item.classicId,
			kind: item.kind,
		})
		if (!prepared.id) throw new Error("Classic import not ready")
		return { id: prepared.id }
	}
	if (item.kind === "account" && item.classicId !== identity.classicId)
		throw new Error("Account mismatch")
	if (item.kind === "theme" && access?.role !== "admin")
		throw new Error("Only Classic theme admins can import themes")
	await authorizeSnapshot(identity.classicId, item)
	if (previous && previous.kind !== item.kind)
		throw new Error("Classic value already mapped to another kind")
	if (!previous) {
		let collision =
			item.kind === "document"
				? await jazz.db.one(app.documents.where({ id }).includeDeleted())
				: item.kind === "space"
					? await jazz.db.one(app.spaces.where({ id }).includeDeleted())
					: item.kind === "theme"
						? await jazz.db.one(app.themes.where({ id }).includeDeleted())
						: null
		if (collision)
			throw new Error("Classic import ID collides with an existing row")
	}
	let spaceGroupId: string | undefined
	if (item.kind === "document" && item.spaceId) {
		let space = await jazz.db.one(
			app.classicImports.where({ id: await stableId(`map:${item.spaceId}`) }),
		)
		if (
			!space ||
			space.kind !== "space" ||
			!space.importedAt ||
			!space.baseContent
		)
			throw new Error("Import the Classic space before its documents")
		if (!access?.groupIds.includes(space.baseContent))
			throw new Error("Classic document does not belong to this space")
		spaceGroupId = space.baseContent
	}
	let importOwner = previous?.ownerId ?? accountId
	if (access) {
		// An importer never becomes owner merely by being first. All access follows verified Classic roles.
		let owner = access.ownerClassicId
			? await jazz.db.one(
					app.classicAccounts.where({ classicId: access.ownerClassicId }),
				)
			: null
		importOwner = owner?.ownerId ?? (await stableId(`owner:${item.classicId}`))
		let members = spaceGroupId
			? access.groupId === spaceGroupId
				? []
				: access.directMembers
			: access.members
		if (item.kind !== "theme")
			await reconcileClassicAccess(
				item.classicId,
				id,
				item.kind === "space" ? "space" : "document",
				members,
			)
	}
	if (!previous)
		await jazz.db
			.insert(
				app.classicImports,
				{
					ownerId: accountId,
					classicId: item.classicId,
					v2Id: id,
					kind: item.kind,
					classicOwnerId: access?.ownerClassicId,
					status: "pending",
				},
				{ id: mapId },
			)
			.wait({ tier: "global" })
	let writesSnapshot =
		!previous || previous.status !== "complete" || item.kind !== "account"
	try {
		if (writesSnapshot && item.kind === "document" && previous) {
			if (!previous.importedAt) {
				let pending = await jazz.db.one(
					app.classicAccess.where({
						classicId: identity.classicId,
						resourceId: id,
					}),
				)
				if (pending)
					await activateVerifiedAccess(accountId, item.classicId, pending)
			}
			let scoped = await jazz.forUser(accountId)
			let visible = await scoped.one(app.documents.where({ id }))
			if (!visible && (await jazz.db.one(app.documents.where({ id }))))
				throw new Error("V2 document access was revoked")
			if (visible)
				await scoped
					.update(app.documents, id, { updatedAt: visible.updatedAt })
					.wait({ tier: "global" })
		}
		if (writesSnapshot)
			await writeItem(
				item,
				id,
				item.kind === "theme" ? accountId : importOwner,
				accountId,
				previous?.baseContent ?? undefined,
				access?.publicRead ?? false,
				identity.classicId,
			)
		if (access && item.kind !== "theme") {
			for (let pending of await jazz.db.all(
				app.classicAccess.where({ resourceId: id }),
			)) {
				let owner = await jazz.db.one(
					app.classicAccounts.where({ classicId: pending.classicId }),
				)
				if (owner)
					await activateVerifiedAccess(owner.ownerId, item.classicId, pending)
			}
		}
		await jazz.db
			.update(app.classicImports, mapId, {
				status: "complete",
				importedAt: new Date(),
				error: null,
				...(item.kind === "document" && writesSnapshot
					? { baseContent: await rewriteReferences(item.content) }
					: item.kind === "space" && access
						? { baseContent: access.groupId }
						: {}),
			})
			.wait({ tier: "global" })
		if (item.kind === "document" && !item.spaceId)
			await libraryEntry(item, id, accountId)
		await discardChunks(accountId, item)
		await importStatus(accountId, item, "complete")
		return { id }
	} catch (error) {
		await jazz.db
			.update(app.classicImports, mapId, {
				status: "failed",
				error: error instanceof Error ? error.message : "Import failed",
			})
			.wait({ tier: "global" })
		await importStatus(accountId, item, "failed")
		throw error
	}
}
async function importStagedItem(accountId: string, input: unknown) {
	let staged = z
		.object({
			challengeId: z.uuid(),
			classicId: classicIdSchema,
			kind: z.enum(["account", "document", "space", "theme"]),
			uploadId: z.string().regex(/^[0-9a-f]{64}$/),
			sha256: z.string(),
		})
		.parse(input)
	let identity = await verifiedIdentity(accountId, staged.challengeId)
	await authorizeSnapshot(identity.classicId, staged)
	await cleanupUploads()
	let bytes = await readBytes(accountId, staged)
	let value: unknown = JSON.parse(new TextDecoder().decode(bytes))
	let envelope = z
		.object({
			challengeId: z.literal(staged.challengeId),
			item: z.object({
				classicId: z.literal(staged.classicId),
				kind: z.literal(staged.kind),
			}),
		})
		.parse(value)
	if (!envelope) throw new Error("Classic upload scope mismatch")
	let result = await importClassicItem(accountId, value)
	await discardChunks(accountId, staged)
	return result
}
async function prepareClassicItem(accountId: string, input: unknown) {
	let item = z
		.object({
			challengeId: z.uuid(),
			classicId: classicIdSchema,
			kind: z.enum(["account", "document", "space", "theme"]),
		})
		.parse(input)
	let identity = await verifiedIdentity(accountId, item.challengeId)
	if (item.kind === "account") {
		await authorizeSnapshot(identity.classicId, item)
		return { canWrite: true }
	}
	let access = await readClassicAccess(item.classicId, identity.classicId)
	if (["writer", "admin"].includes(access.role)) return { canWrite: true }
	let previous = await jazz.db.one(
		app.classicImports.where({ classicId: item.classicId, kind: item.kind }),
	)
	if (!previous || previous.status !== "complete") {
		await importStatus(accountId, item, "waiting")
		throw new Error("Waiting for a Classic owner or editor to open Alkalye")
	}
	if (item.kind === "document" || item.kind === "space") {
		let pending = await jazz.db.one(
			app.classicAccess.where({
				classicId: identity.classicId,
				resourceId: previous.v2Id,
				kind: item.kind,
			}),
		)
		if (pending)
			await activateVerifiedAccess(accountId, item.classicId, pending)
	}
	let mapping = await lookupClassicItem(accountId, item)
	if (!mapping.id)
		throw new Error(
			"V2 access was revoked or the Classic item has not migrated yet",
		)
	if (item.kind === "document") {
		let doc = await jazz.db.one(app.documents.where({ id: mapping.id }))
		if (doc && !doc.spaceId)
			await libraryEntry(
				{
					classicId: item.classicId,
					path: doc.path ?? undefined,
					pinned: false,
					archived: false,
				},
				doc.id,
				accountId,
			)
	}
	await importStatus(accountId, item, "complete")
	return { canWrite: false, id: mapping.id }
}
async function lookupClassicItem(accountId: string, input: unknown) {
	let item = z
		.object({
			classicId: classicIdSchema,
			kind: z.enum(["document", "space", "theme"]),
		})
		.parse(input)
	let previous = await jazz.db.one(
		app.classicImports.where({
			classicId: item.classicId,
			kind: item.kind,
			status: "complete",
		}),
	)
	if (!previous) return { id: null }
	let scoped = await jazz.forUser(accountId)
	let visible =
		item.kind === "document"
			? await scoped.one(app.documents.where({ id: previous.v2Id }))
			: item.kind === "space"
				? await scoped.one(app.spaces.where({ id: previous.v2Id }))
				: await scoped.one(app.themes.where({ id: previous.v2Id }))
	return { id: visible ? previous.v2Id : null }
}
async function importStatus(
	accountId: string,
	item: { classicId: string; kind: string },
	status: "waiting" | "complete" | "failed",
) {
	let id = await stableId(`status:${accountId}:${item.classicId}`)
	let values = {
		ownerId: accountId,
		classicId: item.classicId,
		v2Id: await stableId(item.classicId),
		kind: item.kind,
		status,
	}
	if (await jazz.db.one(app.classicImportStatus.where({ id })))
		await jazz.db
			.update(app.classicImportStatus, id, values)
			.wait({ tier: "global" })
	else
		await jazz.db
			.insert(app.classicImportStatus, values, { id })
			.wait({ tier: "global" })
}
async function writeItem(
	item: ImportItem,
	id: string,
	ownerId: string,
	accountId: string,
	baseContent: string | undefined,
	publicRead: boolean,
	classicAccountId: string,
) {
	let db = jazz.db
	if (item.kind === "document") {
		let content = await rewriteReferences(item.content)
		let existing = await db.one(app.documents.where({ id }))
		let values = {
			ownerId,
			spaceId: item.spaceId ? await stableId(item.spaceId) : undefined,
			title: item.title,
			content,
			path: documentMetadata(content).path ?? item.path,
			frontmatterPinned:
				documentMetadata(content).frontmatterPinned || item.pinned,
			tags: item.tags,
			isPresentation: item.isPresentation,
			publicRead,
			commentsDisabled: item.commentsDisabled,
			presentationLine: item.presentationLine,
			highlightRange: item.highlightRange,
			createdAt: item.createdAt,
			updatedAt: item.updatedAt,
			deletedAt: item.deletedAt,
		}
		if (
			existing &&
			baseContent === undefined &&
			existing.ownerId !== ownerId &&
			existing.ownerId !== (await stableId(`owner:${item.classicId}`))
		)
			throw new Error("object already exists: Classic owner binding collision")
		if (existing) {
			if (
				existing.ownerId === (await stableId(`owner:${item.classicId}`)) &&
				existing.ownerId !== ownerId
			)
				await db.update(app.documents, id, { ownerId }).wait({ tier: "global" })
			if (baseContent !== content) {
				// The last imported Classic text is the common ancestor; v2 edits remain a separate branch.
				await db
					.transaction(tx =>
						tx.update(
							app.documents,
							id,
							{ content, updatedAt: item.updatedAt },
							{ editedFrom: { content: baseContent ?? existing.content } },
						),
					)
					.then(write => write.wait({ tier: "global" }))
				let merged = await db.one(app.documents.where({ id }))
				if (!merged) throw new Error("Imported document missing after merge")
				await db
					.update(app.documents, id, documentMetadata(merged.content))
					.wait({ tier: "global" })
			}
		} else
			await db.insert(app.documents, values, { id }).wait({ tier: "global" })
		await db
			.update(app.classicImports, await stableId(`map:${item.classicId}`), {
				baseContent: content,
			})
			.wait({ tier: "global" })
		for (let version of item.versions) {
			let versionId = await stableId(`version:${id}:${version.classicId}`)
			if (
				!(await db.one(
					app.documentVersions.where({
						documentId: id,
						classicId: version.classicId,
					}),
				))
			)
				await db
					.insert(
						app.documentVersions,
						{
							...version,
							authorId: accountId,
							authorName: `Imported by ${accountId}`,
							documentId: id,
							content: await rewriteReferences(version.content),
						},
						{ id: versionId },
					)
					.wait({ tier: "global" })
		}
		for (let asset of item.assets) {
			await verifyChild(item.classicId, asset.classicId, classicAccountId)
			for (let revision of asset.revisions) {
				await verifyChild(item.classicId, revision.classicId, classicAccountId)
				let previousRevision = await db.one(
					app.tldrawRevisions
						.where({ id: await stableId(revision.classicId) })
						.includeDeleted(),
				)
				if (previousRevision && previousRevision.documentId !== id)
					throw new Error("Classic revision belongs to another document")
				let revisionId = await stableId(revision.classicId)
				if (!(await db.one(app.tldrawRevisions.where({ id: revisionId }))))
					await db
						.insert(
							app.tldrawRevisions,
							{
								documentId: id,
								snapshot: await readBytes(accountId, revision.snapshot),
								lightPreview: await readBytes(accountId, revision.lightPreview),
								darkPreview: await readBytes(accountId, revision.darkPreview),
								createdAt: revision.createdAt,
							},
							{ id: revisionId },
						)
						.wait({ tier: "global" })
			}
			let assetId = await stableId(asset.classicId)
			let revisionId = asset.revisionId
				? await stableId(asset.revisionId)
				: undefined
			if (revisionId) {
				let revision = await db.one(
					app.tldrawRevisions.where({ id: revisionId }),
				)
				if (!revision || revision.documentId !== id)
					throw new Error("Classic revision does not belong to this document")
			}
			let previousAsset = await db.one(
				app.assets.where({ id: assetId }).includeDeleted(),
			)
			if (previousAsset && previousAsset.documentId !== id)
				throw new Error("Classic asset belongs to another document")
			let assetMapId = await stableId(`asset-map:${asset.classicId}`)
			let sourceState = JSON.stringify({
				...asset,
				data: asset.data?.sha256,
				revisions: undefined,
			})
			let assetMap = await db.one(app.classicImports.where({ id: assetMapId }))
			if (assetMap?.baseContent === sourceState) continue
			let values = {
				documentId: id,
				type: asset.type,
				name: asset.name,
				data: asset.data ? await readBytes(accountId, asset.data) : undefined,
				mimeType: asset.mimeType,
				muteAudio: asset.muteAudio,
				width: asset.width,
				height: asset.height,
				revisionId,
				createdAt: asset.createdAt,
			}
			if (!(await db.one(app.assets.where({ id: assetId }))))
				await db
					.insert(app.assets, values, { id: assetId })
					.wait({ tier: "global" })
			else await db.update(app.assets, assetId, values).wait({ tier: "global" })
			if (assetMap)
				await db
					.update(app.classicImports, assetMapId, {
						status: "complete",
						baseContent: sourceState,
					})
					.wait({ tier: "global" })
			else
				await db
					.insert(
						app.classicImports,
						{
							ownerId: accountId,
							classicId: asset.classicId,
							v2Id: assetId,
							kind: "asset",
							status: "complete",
							baseContent: sourceState,
						},
						{ id: assetMapId },
					)
					.wait({ tier: "global" })
		}
		let current = await db.one(app.documents.where({ id }))
		if (!current) throw new Error("Imported document missing")
		for (let thread of item.comments) {
			await verifyChild(
				item.classicId,
				thread.classicId,
				classicAccountId,
				thread.authorId,
			)
			let threadId = await stableId(thread.classicId)
			let existingThread = await db.one(
				app.commentThreads.where({ id: threadId }),
			)
			if (existingThread && existingThread.documentId !== id)
				throw new Error("Classic thread belongs to another document")
			let originalRange = resolveClassicAnchor(
				item.content,
				thread.anchor,
				thread.anchor.start,
				thread.anchor.end,
			)
			let rewrittenQuote = await rewriteReferences(thread.anchor.quote)
			let range = originalRange
				? resolveClassicAnchor(
						current.content,
						{ ...thread.anchor, quote: rewrittenQuote },
						originalRange.start,
						originalRange.end,
					)
				: undefined
			let anchor = {
				...thread.anchor,
				quote: rewrittenQuote,
				...(range
					? {
							range: db
								.textAnchors()
								.captureRange(current.content, range.start, range.end),
						}
					: {}),
			}
			if (!existingThread)
				await db
					.insert(
						app.commentThreads,
						{
							documentId: id,
							authorId: await authorAccount(thread.authorId, accountId),
							anchor,
							createdAt: thread.createdAt,
							updatedAt: thread.updatedAt,
							resolvedAt: thread.resolvedAt,
							deletedAt: thread.deletedAt,
						},
						{ id: threadId },
					)
					.wait({ tier: "global" })
			for (let reply of thread.replies) {
				await verifyChild(
					thread.classicId,
					reply.classicId,
					classicAccountId,
					reply.authorId,
				)
				let previousReply = await db.one(
					app.commentReplies
						.where({ id: await stableId(reply.classicId) })
						.includeDeleted(),
				)
				if (previousReply && previousReply.threadId !== threadId)
					throw new Error("Classic reply belongs to another thread")
				if (
					!(await db.one(
						app.commentReplies.where({ id: await stableId(reply.classicId) }),
					))
				)
					await db
						.insert(
							app.commentReplies,
							{
								threadId,
								authorId: await authorAccount(reply.authorId, accountId),
								authorName: reply.authorName,
								body: reply.body,
								createdAt: reply.createdAt,
								updatedAt: reply.updatedAt,
								deletedAt: reply.deletedAt,
							},
							{ id: await stableId(reply.classicId) },
						)
						.wait({ tier: "global" })
			}
		}
	} else if (item.kind === "space") {
		let existing = await db.one(app.spaces.where({ id }))
		if (
			existing &&
			baseContent === undefined &&
			existing.ownerId !== ownerId &&
			existing.ownerId !== (await stableId(`owner:${item.classicId}`))
		)
			throw new Error("object already exists: Classic owner binding collision")
		if (!existing)
			await db
				.insert(
					app.spaces,
					{
						ownerId,
						name: item.name,
						publicRead,
						avatar: item.avatar
							? await readBytes(accountId, item.avatar)
							: undefined,
						createdAt: item.createdAt,
						updatedAt: item.updatedAt,
					},
					{ id },
				)
				.wait({ tier: "global" })
	} else if (item.kind === "account") {
		let profiles = await db.all(app.profiles.where({ ownerId: accountId }))
		if (profiles[0])
			await db
				.update(app.profiles, profiles[0].id, { name: item.name })
				.wait({ tier: "global" })
		else
			await db
				.insert(
					app.profiles,
					{ ownerId: accountId, name: item.name },
					{ id: await stableId(`profile:${item.classicId}`) },
				)
				.wait({ tier: "global" })
		let settings = await db.all(app.settings.where({ ownerId: accountId }))
		let values = {
			ownerId: accountId,
			editor: item.editor,
			language: item.language,
			syntaxTheme: item.syntaxTheme,
			defaultPreviewTheme: await importedTheme(
				item.defaultPreviewTheme,
				accountId,
			),
			defaultSlideshowTheme: await importedTheme(
				item.defaultSlideshowTheme,
				accountId,
			),
		}
		if (settings[0])
			await db
				.update(app.settings, settings[0].id, values)
				.wait({ tier: "global" })
		else
			await db
				.insert(app.settings, values, {
					id: await stableId(`settings:${item.classicId}`),
				})
				.wait({ tier: "global" })
	} else {
		if (!(await db.one(app.themes.where({ id }))))
			await db
				.insert(
					app.themes,
					{
						ownerId,
						name: item.name,
						author: item.author,
						description: item.description,
						type: item.type,
						css: await rewriteReferences(item.css),
						template: item.template
							? await rewriteReferences(item.template)
							: undefined,
						slideTemplate: item.slideTemplate
							? await rewriteReferences(item.slideTemplate)
							: undefined,
						sourceDocId: item.sourceDocId
							? await stableId(item.sourceDocId)
							: undefined,
						presets: item.presets,
						thumbnail: item.thumbnail
							? await readBytes(accountId, item.thumbnail)
							: undefined,
						thumbnailDataUrl: item.thumbnailDataUrl,
						createdAt: item.createdAt,
						updatedAt: item.updatedAt,
					},
					{ id },
				)
				.wait({ tier: "global" })
		for (let asset of item.assets) {
			await verifyChild(item.classicId, asset.classicId, classicAccountId)
			let assetId = await stableId(asset.classicId)
			let existing = await db.one(
				app.themeAssets.where({ id: assetId }).includeDeleted(),
			)
			if (existing && existing.themeId !== id)
				throw new Error("Classic asset belongs to another theme")
			if (!(await db.one(app.themeAssets.where({ id: assetId }))))
				await db
					.insert(
						app.themeAssets,
						{
							themeId: id,
							name: asset.name,
							mimeType: asset.mimeType,
							data: await readBytes(accountId, asset.data),
							createdAt: asset.createdAt,
						},
						{ id: assetId },
					)
					.wait({ tier: "global" })
		}
	}
}
async function importedTheme(classicId: string | undefined, ownerId: string) {
	if (!classicId) return undefined
	let id = await stableId(classicId)
	let theme = await jazz.db.one(app.themes.where({ id }))
	if (!theme || theme.ownerId !== ownerId)
		throw new Error("Import the Classic default theme before account settings")
	return id
}
async function authorAccount(classicId: string, fallback: string) {
	let account = await jazz.db.one(app.classicAccounts.where({ classicId }))
	return (
		account?.ownerId ??
		(classicId ? await stableId(`author:${classicId}`) : fallback)
	)
}
async function libraryEntry(
	item: {
		classicId: string
		path?: string
		pinned: boolean
		archived: boolean
	},
	documentId: string,
	ownerId: string,
) {
	let folderId: string | undefined
	let path = ""
	for (let name of item.path?.split("/").filter(Boolean) ?? []) {
		path += `/${name}`
		let id = await stableId(`folder:${ownerId}:${path}`)
		if (!(await jazz.db.one(app.folders.where({ id }))))
			await jazz.db
				.insert(
					app.folders,
					{ ownerId, parentId: folderId, name, rank: 0 },
					{ id },
				)
				.wait({ tier: "global" })
		folderId = id
	}
	let id = await stableId(`entry:${ownerId}:${item.classicId}`)
	if (!(await jazz.db.one(app.userDocuments.where({ id }))))
		await jazz.db
			.insert(
				app.userDocuments,
				{
					ownerId,
					documentId,
					folderId,
					rank: 0,
					pinned: item.pinned,
					archived: item.archived,
				},
				{ id },
			)
			.wait({ tier: "global" })
}

async function verifyChild(
	parentId: string,
	childId: string,
	classicAccountId: string,
	authorId?: string,
) {
	let [parent, child] = await Promise.all([
		readClassicAccess(parentId, classicAccountId),
		readClassicAccess(childId, classicAccountId),
	])
	if (!child.groupIds.includes(parent.groupId))
		throw new Error("Classic child has an unrelated owner group")
	if (authorId !== undefined && authorId !== (child.createdBy ?? ""))
		throw new Error("Classic author does not match signed history")
}
