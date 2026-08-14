import { redirect } from "@tanstack/react-router"
import { Group, co, type ResolveQuery } from "jazz-tools"
import { UserAccount } from "@/schema"
import { CommentThread, Document } from "../lib/schema"
import { createDocumentMetadata } from "../lib/metadata"
import { startStartupSpan } from "@/app/lib/reload-diagnostics"

export {
	homeLoader,
	homeLastOpenedQuery,
	homeDocumentsQuery,
	findFallbackHomeDocument,
}

let homeLastOpenedQuery = {
	root: true,
} as const satisfies ResolveQuery<typeof UserAccount>

let homeDocumentsQuery = {
	root: {
		documents: { $each: true },
	},
} as const satisfies ResolveQuery<typeof UserAccount>

interface HomeLoaderArgs {
	context: { me: import("jazz-tools").co.loaded<typeof UserAccount> | null }
	deps: { personal?: boolean }
}

type FallbackHomeDocument = {
	$isLoaded?: boolean
	deletedAt?: Date
	updatedAt?: Date
	$jazz?: { id: string }
}

async function homeLoader({ context, deps }: HomeLoaderArgs) {
	let { me } = context
	if (!me) return null

	if (!deps.personal) {
		let finishLastOpened = startStartupSpan("home-last-opened-load")
		let loaded = await me.$jazz.ensureLoaded({ resolve: homeLastOpenedQuery })
		let { lastOpenedDocId, lastOpenedSpaceId } = loaded.root ?? {}
		finishLastOpened({ hasLastOpenedDocument: Boolean(lastOpenedDocId) })

		if (lastOpenedDocId) {
			let finishDocument = startStartupSpan("home-last-document-load")
			let doc = await Document.load(lastOpenedDocId)
			finishDocument({
				loaded: doc.$isLoaded,
				loadingState: doc.$jazz.loadingState,
			})
			if (doc.$isLoaded && !doc.deletedAt) {
				if (lastOpenedSpaceId) {
					throw redirect({
						to: "/spaces/$spaceId/doc/$id",
						params: { spaceId: lastOpenedSpaceId, id: lastOpenedDocId },
					})
				}
				throw redirect({
					to: "/doc/$id",
					params: { id: lastOpenedDocId },
				})
			}
		}
	}

	let finishDocuments = startStartupSpan("home-documents-load")
	let loadedMe = await me.$jazz.ensureLoaded({ resolve: homeDocumentsQuery })
	let docs = loadedMe.root?.documents
	finishDocuments({
		loaded: Boolean(docs?.$isLoaded),
		documentCount: docs?.$isLoaded ? docs.length : 0,
	})
	if (!docs?.$isLoaded) return null

	let fallbackDoc = findFallbackHomeDocument(Array.from(docs))
	if (fallbackDoc?.$jazz) {
		throw redirect({
			to: "/doc/$id",
			params: { id: fallbackDoc.$jazz.id },
		})
	}

	let now = new Date()
	let group = Group.create()
	let newDoc = Document.create(
		{
			version: 1,
			content: co.plainText().create("", group),
			comments: co.list(CommentThread).create([], group),
			...createDocumentMetadata("", now),
			createdAt: now,
			updatedAt: now,
		},
		group,
	)
	docs.$jazz.push(newDoc)

	throw redirect({
		to: "/doc/$id",
		params: { id: newDoc.$jazz.id },
	})
}

function findFallbackHomeDocument<T extends FallbackHomeDocument>(docs: T[]) {
	let fallback: T | null = null
	for (let doc of docs) {
		if (!doc?.$isLoaded || doc.deletedAt || !doc.updatedAt) continue
		if (!fallback || !fallback.updatedAt || doc.updatedAt > fallback.updatedAt)
			fallback = doc
	}
	return fallback
}
