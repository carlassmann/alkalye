import {
	z,
	co,
	createJazzContextFromExistingCredentials,
	MockSessionProvider,
} from "jazz-tools-classic"
import { RawAccount, cojsonInternals, type LocalNode } from "cojson"
import { getIndexedDBStorage } from "cojson-storage-indexeddb"
import {
	UserAccount,
	Document,
	Space,
	Theme,
	TldrawRevision,
	UserRoot,
} from "./classic-schema"
import { connectClassic, classicPeers } from "./transport"
import { groupHistory, packBytes, resolveClassicAnchor } from "./conversion"
import { DEFAULT_EDITOR_SETTINGS } from "@/jazz/value-types"
import {
	getPath,
	parseFrontmatter,
} from "@/app/features/editor/lib/frontmatter"
import { getDocumentTitle } from "@/app/features/documents/lib/title"
import type { ImportItem } from "./contract"
export { openClassicAccount, readDocument, readSpace, readTheme }
type ShallowResolve = Record<never, never>

async function openClassicAccount(seed: Uint8Array, storedAccountId?: string) {
	let connection = await connectClassic()
	try {
		connection.node.setStorage(await getIndexedDBStorage())
		let secret = connection.crypto.agentSecretFromSecretSeed(seed)
		let accountId =
			storedAccountId ??
			cojsonInternals.idforHeader(
				cojsonInternals.accountHeaderForInitialAgentSecret(
					secret,
					connection.crypto,
				),
				connection.crypto,
			)
		await connection.peer.waitUntilConnected()
		let raw = (
			await connection.node.loadCoValueCore(
				z.templateLiteral(["co_z", z.string()]).parse(accountId),
			)
		).getCurrentContent()
		if (!(raw instanceof RawAccount))
			throw new Error("Classic account unavailable")
		let live = await classicPeers()
		await live.peer.waitUntilConnected()
		let context = await createJazzContextFromExistingCredentials({
			credentials: { accountID: raw.id, secret },
			peers: live.peers,
			crypto: connection.crypto,
			storage: await getIndexedDBStorage(),
			AccountSchema: UserAccount,
			sessionProvider: new MockSessionProvider(),
			asActiveAccount: false,
		})
		connection.peer.disable()
		live.attach(context.node)
		await flushClassic(context.node)
		await context.account.$jazz.waitForSync({ timeout: 60_000 })
		let account = await context.account.$jazz.ensureLoaded({
			resolve: {
				profile: true,
				root: {
					documents: { $each: true },
					inactiveDocuments: { $each: true },
					spaces: { $each: true },
					themes: { $each: true },
					settings: true,
				},
			},
		})
		let roots: co.loaded<
			typeof UserRoot,
			{
				documents: { $each: true }
				inactiveDocuments: { $each: true }
				spaces: { $each: true }
				themes: { $each: true }
				settings: true
			}
		>[] = [account.root]
		let rootErrors: { id: string; message: string }[] = []
		let seenRoots = new Set([account.root.$jazz.id])
		for (let edit of account.$jazz.raw.editsAt("root")) {
			if (
				typeof edit.value !== "string" ||
				!edit.value.startsWith("co_z") ||
				seenRoots.has(edit.value)
			)
				continue
			seenRoots.add(edit.value)
			let root = await UserRoot.load(edit.value, {
				loadAs: account,
				resolve: {
					documents: { $each: true },
					inactiveDocuments: { $each: true },
					spaces: { $each: true },
					themes: { $each: true },
					settings: true,
				},
			})
			if (root.$isLoaded) roots.push(root)
			else
				rootErrors.push({
					id: edit.value,
					message: "Classic account archive unavailable",
				})
		}
		return {
			roots,
			rootErrors,
			account,
			crypto: connection.crypto,
			secret,
			async sync() {
				await live.peer.waitUntilConnected()
				await flushClassic(context.node)
			},
			close() {
				live.peer.disable()
				context.done()
				connection.close()
			},
			accountItem(): ImportItem {
				let settings = account.root.settings
				return {
					kind: "account",
					classicId: account.$jazz.id,
					name: account.profile.name,
					language: account.root.language ?? "en",
					editor: settings?.editor ?? DEFAULT_EDITOR_SETTINGS,
					defaultPreviewTheme: settings?.defaultPreviewTheme?.startsWith("co_z")
						? `co_z${settings.defaultPreviewTheme.slice(4)}`
						: undefined,
					defaultSlideshowTheme: settings?.defaultSlideshowTheme?.startsWith(
						"co_z",
					)
						? `co_z${settings.defaultSlideshowTheme.slice(4)}`
						: undefined,
					syntaxTheme: settings?.syntaxTheme,
				}
			},
		}
	} catch (error) {
		connection.close()
		throw error
	}
}
async function readDocument(
	document: co.loaded<typeof Document, ShallowResolve>,
	archived: boolean,
): Promise<ImportItem> {
	let doc = await document.$jazz.ensureLoaded({
		resolve: {
			content: true,
			assets: { $each: true },
			comments: { $each: { replies: { $each: true } } },
			archivedContent: { $each: { content: true } },
		},
	})
	let content = doc.content.toString()
	let versions: Extract<ImportItem, { kind: "document" }>["versions"] = []
	for (let text of [
		...(doc.archivedContent?.map(entry => entry.content) ?? []),
		doc.content,
	]) {
		let raw = text.$jazz.raw
		// Sample at grouped transaction boundaries before materializing history.
		let boundaries = groupHistory(
			raw.core.getValidTransactions().map(transaction => ({
				createdAt: new Date(transaction.madeAt),
				authorId: transaction.author,
				content: `${transaction.madeAt}`,
				classicId: `${text.$jazz.id}:${transaction.txID.sessionID}:${transaction.txID.txIndex}`,
			})),
		)
		for (let boundary of boundaries)
			versions.push({
				...boundary,
				content: raw.atTime(boundary.createdAt.getTime()).toString(),
			})
	}
	for (let authorId of new Set(versions.map(version => version.authorId))) {
		let author = await UserAccount.load(authorId, {
			loadAs: doc.$jazz.loadedAs,
			resolve: { profile: true },
		})
		if (author.$isLoaded)
			for (let version of versions)
				if (version.authorId === authorId)
					version.authorName = author.profile.name
	}
	let comments: Extract<ImportItem, { kind: "document" }>["comments"] = []
	for (let thread of doc.comments ?? []) {
		let start = thread.anchor.start
			? Reflect.get(
					doc.content.$jazz.raw.mapping.idxBeforeOpID,
					thread.anchor.start,
				)
			: undefined
		let end = thread.anchor.end
			? Reflect.get(
					doc.content.$jazz.raw.mapping.idxAfterOpID,
					thread.anchor.end,
				)
			: undefined
		let range = resolveClassicAnchor(
			content,
			thread.anchor,
			typeof start === "number" ? start : undefined,
			typeof end === "number" ? end : undefined,
		)
		comments.push({
			classicId: thread.$jazz.id,
			authorId: thread.$jazz.createdBy ?? "",
			anchor: { ...thread.anchor, start: range?.start, end: range?.end },
			createdAt: thread.createdAt,
			updatedAt: thread.updatedAt,
			resolvedAt: thread.resolvedAt,
			deletedAt: thread.deletedAt,
			replies: thread.replies.map(reply => ({
				classicId: reply.$jazz.id,
				authorId: reply.$jazz.createdBy ?? "",
				authorName: reply.authorName,
				body: reply.body,
				createdAt: reply.createdAt,
				updatedAt: reply.updatedAt,
				deletedAt: reply.deletedAt,
			})),
		})
	}
	let assets: Extract<ImportItem, { kind: "document" }>["assets"] = []
	for (let asset of doc.assets ?? []) {
		if (asset.type === "image") {
			let loaded = await asset.$jazz.ensureLoaded({
				resolve: { image: { original: true } },
			})
			let image = loaded.image
			assets.push({
				classicId: asset.$jazz.id,
				type: "image",
				name: asset.name,
				data: await fileBytes(image.original),
				width: image.originalSize[0],
				height: image.originalSize[1],
				mimeType: image.original.toBlob()?.type,
				revisions: [],
				createdAt: asset.createdAt,
			})
		} else if (asset.type === "video") {
			let video = await asset.$jazz.ensureLoaded({ resolve: { video: true } })
			assets.push({
				classicId: asset.$jazz.id,
				type: "video",
				name: asset.name,
				data: await fileBytes(video.video),
				mimeType: asset.mimeType,
				muteAudio: asset.muteAudio,
				revisions: [],
				createdAt: asset.createdAt,
			})
		} else {
			let revisions: Extract<
				ImportItem,
				{ kind: "document" }
			>["assets"][number]["revisions"] = []
			let ids = new Set([
				asset.revision.$jazz.id,
				...(asset.$jazz.getEdits().revision?.all ?? [])
					.map(edit => edit.value?.$jazz.id)
					.filter(id => id !== undefined),
			])
			for (let id of ids) {
				let revision = await TldrawRevision.load(id, {
					loadAs: asset.$jazz.loadedAs,
					resolve: {
						snapshot: true,
						lightPreview: { original: true },
						darkPreview: { original: true },
					},
				})
				if (!revision.$isLoaded)
					throw new Error(`Whiteboard revision unavailable: ${id}`)
				revisions.push({
					classicId: revision.$jazz.id,
					snapshot: await fileBytes(revision.snapshot),
					lightPreview: await fileBytes(revision.lightPreview.original),
					darkPreview: await fileBytes(revision.darkPreview.original),
					createdAt: revision.createdAt,
				})
			}
			assets.push({
				classicId: asset.$jazz.id,
				type: "tldraw",
				name: asset.name,
				revisionId: asset.revision.$jazz.id,
				revisions,
				createdAt: asset.createdAt,
			})
		}
	}
	return {
		kind: "document",
		classicId: doc.$jazz.id,
		content,
		title: doc.title ?? getDocumentTitle(content),
		spaceId: doc.spaceId?.startsWith("co_z")
			? `co_z${doc.spaceId.slice(4)}`
			: undefined,
		tags: doc.tags ?? [],
		pinned:
			doc.pinned ?? parseFrontmatter(content).frontmatter?.pinned === true,
		path: doc.path ?? getPath(content) ?? undefined,
		archived,
		isPresentation: doc.isPresentation ?? false,
		commentsDisabled: doc.commentsDisabled ?? false,
		presentationLine: doc.presentationLine,
		highlightRange: doc.highlightRange,
		createdAt: doc.createdAt,
		updatedAt: doc.updatedAt,
		deletedAt: doc.deletedAt,
		versions: groupHistory(versions),
		comments,
		assets,
	}
}
async function readSpace(
	space: co.loaded<typeof Space, ShallowResolve>,
): Promise<ImportItem> {
	let loaded = await space.$jazz.ensureLoaded({
		resolve: { avatar: { original: true } },
	})
	return {
		kind: "space",
		classicId: space.$jazz.id,
		name: space.name,
		avatar: loaded.avatar ? await fileBytes(loaded.avatar.original) : undefined,
		createdAt: space.createdAt,
		updatedAt: space.updatedAt,
	}
}
async function readTheme(
	theme: co.loaded<typeof Theme, ShallowResolve>,
): Promise<ImportItem> {
	let loaded = await theme.$jazz.ensureLoaded({
		resolve: {
			css: true,
			template: true,
			slideTemplate: true,
			assets: { $each: { data: true } },
			thumbnail: { original: true },
		},
	})
	let assets: Extract<ImportItem, { kind: "theme" }>["assets"] = []
	for (let asset of loaded.assets ?? [])
		assets.push({
			classicId: asset.$jazz.id,
			name: asset.name,
			mimeType: asset.mimeType,
			data: await fileBytes(asset.data),
			createdAt: asset.createdAt,
		})
	let presets: unknown = loaded.presets ? JSON.parse(loaded.presets) : undefined
	return {
		kind: "theme",
		classicId: loaded.$jazz.id,
		name: loaded.name,
		author: loaded.author,
		description: loaded.description,
		type: loaded.type,
		css: loaded.css.toString(),
		template: loaded.template?.toString(),
		slideTemplate: loaded.slideTemplate?.toString(),
		sourceDocId: loaded.sourceDocId?.startsWith("co_z")
			? `co_z${loaded.sourceDocId.slice(4)}`
			: undefined,
		presets: z.json().optional().parse(presets),
		thumbnail: loaded.thumbnail
			? await fileBytes(loaded.thumbnail.original)
			: undefined,
		thumbnailDataUrl: loaded.thumbnailDataUrl,
		createdAt: loaded.createdAt,
		updatedAt: loaded.updatedAt,
		assets,
	}
}
async function fileBytes(stream: co.loaded<ReturnType<typeof co.fileStream>>) {
	let blob =
		stream.toBlob() ??
		(await new Promise<Blob>((resolve, reject) => {
			let unsubscribe = () => {}
			let settled = false
			let timeout = setTimeout(() => {
				unsubscribe()
				reject(new Error(`Classic file download timed out: ${stream.$jazz.id}`))
			}, 60_000)
			unsubscribe = co
				.fileStream()
				.subscribe(
					stream.$jazz.id,
					{ loadAs: stream.$jazz.loadedAs },
					value => {
						if (!value.$isLoaded) return
						let blob = value.toBlob()
						if (!blob) return
						settled = true
						clearTimeout(timeout)
						unsubscribe()
						resolve(blob)
					},
				)
			if (settled) unsubscribe()
		}))
	return packBytes(new Uint8Array(await blob.arrayBuffer()))
}

async function flushClassic(node: LocalNode) {
	let storage = node.storage
	if (!storage) return
	let ids = await new Promise<Parameters<typeof node.loadCoValueCore>[0][]>(
		resolve => storage.getUnsyncedCoValueIDs(resolve),
	)
	for (let id of ids) {
		let core = await node.loadCoValueCore(id)
		await core.waitForSync({ timeout: 60_000 })
	}
}
