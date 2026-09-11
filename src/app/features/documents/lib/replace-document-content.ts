import { co } from "jazz-tools"
import { applyContentDiffWithCommentAnchors } from "@/app/features/comments"
import { Document } from "./schema"
import {
	compactDocumentContent,
	replaceDocumentContentGeneration,
} from "./document-generations"

export { replaceDocumentContent }

type ReplaceableDocument = co.loaded<
	typeof Document,
	{ content: true; comments: { $each: { replies: true } } }
>

async function replaceDocumentContent(
	document: ReplaceableDocument,
	content: string,
) {
	let currentContent = document.content.toString()
	if (currentContent === content) return true
	if (getChangedContentSpan(currentContent, content) > 4_000) {
		let compactable = await loadCompactableDocument(document)
		return replaceDocumentContentGeneration(compactable, content)
	}
	applyContentDiffWithCommentAnchors(document, content)
	let compactable = await loadCompactableDocument(document)
	await compactDocumentContent(compactable)
	return true
}

async function loadCompactableDocument(document: ReplaceableDocument) {
	return document.$jazz.ensureLoaded({
		resolve: {
			content: true,
			comments: { $each: true },
			cursors: true,
			archivedContent: { $each: true, $onError: "catch" },
		},
	})
}

function getChangedContentSpan(currentContent: string, nextContent: string) {
	let prefix = 0
	let sharedLength = Math.min(currentContent.length, nextContent.length)
	while (
		prefix < sharedLength &&
		currentContent[prefix] === nextContent[prefix]
	) {
		prefix++
	}

	let suffix = 0
	while (
		suffix < sharedLength - prefix &&
		currentContent[currentContent.length - suffix - 1] ===
			nextContent[nextContent.length - suffix - 1]
	) {
		suffix++
	}
	return Math.max(
		currentContent.length - prefix - suffix,
		nextContent.length - prefix - suffix,
	)
}
