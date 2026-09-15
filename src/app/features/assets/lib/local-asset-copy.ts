import { co, type Group } from "jazz-tools"
import { Document } from "@/app/features/documents/lib/schema"
import { Asset } from "./schema"
import { createAssetFromFile } from "./asset-transfer"
import {
	localEditorContent,
	referencedLocalAssetIds,
	assertLocalAssetReferencesAvailable,
	type LocalAsset,
} from "./local-assets"

export { prepareLocalAssetCopy, attachLocalAssetCopy }

async function prepareLocalAssetCopy(
	content: string,
	files: LocalAsset[],
	owner: Group,
) {
	assertLocalAssetReferencesAvailable(content, files)
	let assets: Awaited<ReturnType<typeof createAssetFromFile>>[] = []
	let ids = new Map<string, string>()
	let referencedFiles = referencedLocalAssetIds(content)
	for (let file of files) {
		if (!referencedFiles.has(file.id)) continue
		let asset = await createAssetFromFile(
			{ blob: file.blob, fileName: file.id },
			owner,
		)
		assets.push(asset)
		ids.set(file.id, asset.$jazz.id)
	}
	let normalized = localEditorContent(content, files)
	let copiedContent = normalized.replace(
		/!\[([^\]]*)\]\(asset:([^)]+)\)/g,
		(match, alt, id) => {
			let copiedId = ids.get(id)
			return copiedId ? `![${alt}](asset:${copiedId})` : match
		},
	)
	return { content: copiedContent, assets }
}

function attachLocalAssetCopy(
	doc: co.loaded<typeof Document>,
	assets: Awaited<ReturnType<typeof createAssetFromFile>>[],
	owner: Group,
) {
	if (assets.length > 0) {
		doc.$jazz.set("assets", co.list(Asset).create(assets, owner))
	}
}
