import { Args, Command, Options } from "@effect/cli"
import { readFile } from "node:fs/promises"
import { basename } from "node:path"
import { co } from "jazz-tools"
import { createImage } from "jazz-tools/media/server"
import {
	assetMimeTypeFromFileName,
	classifyAssetFile,
} from "@/app/features/assets/lib/asset-transfer"
import { Asset } from "@/app/features/assets/lib/schema"
import { syncDocumentMetadata } from "@/app/features/documents/lib/metadata"
import { canEdit } from "@/app/features/sharing"
import { NotFoundError, PermissionError, ValidationError } from "@/cli/errors"
import { descriptions } from "@/cli/help"
import { createAuthenticatedJazz } from "@/cli/jazz"
import { docIdArg, globalOptions, nameOption } from "@/cli/options"
import {
	getOptionString,
	loadDocumentForMutation,
	replaceCliDocumentContent,
	runCommand,
	syncMutation,
	withTimeout,
} from "@/cli/runtime"
import type { JazzContext } from "@/cli/runtime"
import { Document } from "@/schema"
import { ImageAsset, VideoAsset } from "@/schema"

export {
	docAssetCommand,
	addAssetFromFile,
	listDocAssets,
	removeAsset,
	listableAssetDocumentResolve,
}

let mutableAssetDocumentResolve = {
	content: true,
	comments: { $each: { replies: true } },
	cursors: true,
	assets: true,
} as const

// Listing reads each asset's own fields, and jazz autoloads list items asynchronously,
// so a one-shot CLI has to resolve them up front. Catching per item keeps an asset the
// account cannot read from failing the whole command.
let listableAssetDocumentResolve = {
	...mutableAssetDocumentResolve,
	assets: { $each: { $onError: "catch" } },
} as const

type LoadedAssetDocument = co.loaded<
	typeof Document,
	typeof mutableAssetDocumentResolve
>
type ListableAssetDocument = co.loaded<
	typeof Document,
	typeof listableAssetDocumentResolve
>
type LoadedAsset = co.loaded<typeof ImageAsset> | co.loaded<typeof VideoAsset>
type AssetSummary = {
	assetId: string
	name: string
	type: "image" | "video" | "tldraw"
	reference: string
	inContent: boolean
	createdAt: string
}

// jazz's server-side createImage maps sharp's decoded format onto a fixed mime set, so
// svg is rejected there; bmp fails earlier, inside sharp's decoder. The browser encoder
// accepts both, so app-created assets are not limited to these.
let serverEncodableImageMimeTypes = new Set([
	"image/avif",
	"image/gif",
	"image/jpeg",
	"image/png",
	"image/webp",
])

let assetIdArg = Args.text({ name: "asset-id" }).pipe(
	Args.withDescription("Asset ID."),
)
let assetFileOption = Options.file("file").pipe(
	Options.withDescription("Path to an image or video file."),
)

let docAssetAdd = Command.make(
	"add",
	{
		...globalOptions,
		docId: docIdArg,
		file: assetFileOption,
		name: Options.optional(nameOption),
	},
	args =>
		runCommand("doc.asset.add", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let doc = await loadMutableAssetDocument(
				jazz,
				args.docId,
				config.timeoutMs,
			)
			requireAssetEdit(doc)
			let asset = await addAssetFromFile(doc, {
				filePath: args.file,
				name: getOptionString(args.name),
			})
			await syncMutation(jazz, config.timeoutMs)
			await jazz.done()
			return { docId: doc.$jazz.id, ...asset }
		}),
)

let docAssetList = Command.make(
	"list",
	{ ...globalOptions, docId: docIdArg },
	args =>
		runCommand("doc.asset.list", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let doc = await loadListableAssetDocument(
				jazz,
				args.docId,
				config.timeoutMs,
			)
			let assets = listDocAssets(doc)
			await jazz.done()
			return { docId: doc.$jazz.id, assets }
		}),
)

let docAssetRemove = Command.make(
	"remove",
	{ ...globalOptions, docId: docIdArg, assetId: assetIdArg },
	args =>
		runCommand("doc.asset.remove", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let doc = await loadMutableAssetDocument(
				jazz,
				args.docId,
				config.timeoutMs,
			)
			requireAssetEdit(doc)
			let result = await removeAsset(doc, args.assetId)
			await syncMutation(jazz, config.timeoutMs)
			await jazz.done()
			return { docId: doc.$jazz.id, ...result }
		}),
)

let docAssetCommand = Command.make("asset").pipe(
	Command.withDescription(descriptions.docAsset),
	Command.withSubcommands([docAssetAdd, docAssetList, docAssetRemove]),
)

async function loadMutableAssetDocument(
	jazz: JazzContext,
	docId: string,
	timeoutMs: number,
): Promise<LoadedAssetDocument> {
	let doc = await loadDocumentForMutation(jazz, docId, timeoutMs)
	return withTimeout(
		doc.$jazz.ensureLoaded({ resolve: mutableAssetDocumentResolve }),
		timeoutMs,
		`Remote sync timed out while loading document ${docId} after ${timeoutMs}ms.`,
	)
}

async function loadListableAssetDocument(
	jazz: JazzContext,
	docId: string,
	timeoutMs: number,
): Promise<ListableAssetDocument> {
	let doc = await loadDocumentForMutation(jazz, docId, timeoutMs)
	return withTimeout(
		doc.$jazz.ensureLoaded({ resolve: listableAssetDocumentResolve }),
		timeoutMs,
		`Remote sync timed out while loading assets for document ${docId} after ${timeoutMs}ms.`,
	)
}

function requireAssetEdit(doc: LoadedAssetDocument) {
	if (!canEdit(doc)) {
		throw new PermissionError({ message: "Document edit access required" })
	}
}

async function addAssetFromFile(
	doc: LoadedAssetDocument,
	input: { filePath: string; name?: string; createdAt?: Date },
): Promise<AssetSummary> {
	let fileName = basename(input.filePath)
	let mimeType = assetMimeTypeFromFileName(fileName)
	let kind = classifyAssetFile({ name: fileName, type: mimeType })
	if (!kind) {
		throw new ValidationError({
			message: `Unsupported asset file: ${fileName}`,
		})
	}
	if (kind === "tldraw") {
		throw new ValidationError({
			message: "Tldraw assets are not supported by the CLI yet",
		})
	}
	if (kind === "image" && !serverEncodableImageMimeTypes.has(mimeType)) {
		throw new ValidationError({
			message:
				`Unsupported image format: ${fileName}. ` +
				"Supported: avif, gif, jpg, png, webp. Convert svg or bmp first.",
		})
	}

	let data = await readFile(input.filePath)
	let name = input.name?.trim() || fileName.replace(/\.[^.]+$/, "")
	let createdAt = input.createdAt ?? new Date()
	let asset: LoadedAsset
	if (kind === "image") {
		let image = await createImage(data, {
			owner: doc.$jazz.owner,
			maxSize: 2048,
		})
		asset = ImageAsset.create(
			{ type: "image", name, image, createdAt },
			doc.$jazz.owner,
		)
	} else {
		let video = await co
			.fileStream()
			.createFromBlob(new Blob([data], { type: mimeType }), {
				owner: doc.$jazz.owner,
			})
		asset = VideoAsset.create(
			{ type: "video", name, video, mimeType, createdAt },
			doc.$jazz.owner,
		)
	}

	let list = ensureAssetList(doc)
	list.$jazz.push(asset)
	doc.$jazz.set("updatedAt", new Date())
	syncDocumentMetadata(doc, { contentChanged: false })
	return summarizeAsset(doc, asset)
}

function listDocAssets(doc: ListableAssetDocument): AssetSummary[] {
	return (doc.assets ?? []).flatMap(asset =>
		asset?.$isLoaded ? [summarizeAsset(doc, asset)] : [],
	)
}

async function removeAsset(
	doc: LoadedAssetDocument,
	assetId: string,
): Promise<{ assetId: string; removedFromContent: boolean }> {
	let list = doc.assets
	let index = list?.findIndex(asset => asset?.$jazz.id === assetId) ?? -1
	if (!list || index < 0) {
		throw new NotFoundError({ message: `Asset not found: ${assetId}` })
	}

	let content = doc.content.toString()
	let nextContent = stripAssetReference(content, assetId)
	let removedFromContent = false
	if (nextContent !== content) {
		await replaceCliDocumentContent(doc, nextContent)
		removedFromContent = true
	}
	doc.$jazz.set("updatedAt", new Date())
	list.$jazz.splice(index, 1)
	syncDocumentMetadata(doc, { contentChanged: false })
	return { assetId, removedFromContent }
}

function stripAssetReference(content: string, assetId: string) {
	let pattern = new RegExp(
		`!\\[[^\\]]*\\]\\(asset:${escapeAssetId(assetId)}\\)`,
		"g",
	)
	return content.replace(pattern, "")
}

function escapeAssetId(assetId: string) {
	return assetId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function summarizeAsset(
	doc: LoadedAssetDocument,
	asset: co.loaded<typeof Asset>,
): AssetSummary {
	return {
		assetId: asset.$jazz.id,
		name: asset.name,
		type: asset.type,
		reference: `![${asset.name}](asset:${asset.$jazz.id})`,
		inContent: isAssetReferenced(doc.content.toString(), asset.$jazz.id),
		createdAt: asset.createdAt.toISOString(),
	}
}

function isAssetReferenced(content: string, assetId: string) {
	return new RegExp(`!\\[[^\\]]*\\]\\(asset:${escapeAssetId(assetId)}\\)`).test(
		content,
	)
}

function ensureAssetList(
	doc: LoadedAssetDocument,
): co.loaded<ReturnType<typeof co.list<typeof Asset>>> {
	let list = doc.assets
	if (!list) {
		list = co.list(Asset).create([], doc.$jazz.owner)
		doc.$jazz.set("assets", list)
	}
	return list
}
