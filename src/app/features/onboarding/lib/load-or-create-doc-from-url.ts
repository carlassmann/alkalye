import { redirect } from "@tanstack/react-router"
import { Group, co, type ResolveQuery } from "jazz-tools"
import { UserAccount, Document, CommentThread } from "@/schema"
import { createDocumentMetadata } from "@/app/features/documents/lib/metadata"
import { replaceShortcutTokens } from "@/app/lib/shortcut-registry"

export { loadOrCreateDocFromUrl }

let documentsQuery = {
	root: {
		documents: { $each: { content: true }, $onError: "catch" },
	},
} as const satisfies ResolveQuery<typeof UserAccount>

async function loadOrCreateDocFromUrl(
	me: co.loaded<typeof UserAccount> | null,
	contentUrl: string,
): Promise<never> {
	if (!me) throw redirect({ to: "/" })

	let loadedMe = await me.$jazz.ensureLoaded({ resolve: documentsQuery })
	let docs = loadedMe.root?.documents
	if (!docs?.$isLoaded) throw redirect({ to: "/" })

	let content = await fetchContent(contentUrl)

	let existingDoc = docs.find(
		d => d?.$isLoaded && !d.deletedAt && d.content?.toString() === content,
	)

	if (existingDoc) {
		throw redirect({
			to: "/doc/$id",
			params: { id: existingDoc.$jazz.id },
		})
	}

	let now = new Date()
	let group = Group.create()
	let newDoc = Document.create(
		{
			version: 1,
			content: co.plainText().create(content, group),
			comments: co.list(CommentThread).create([], group),
			...createDocumentMetadata(content, now),
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

async function fetchContent(url: string): Promise<string> {
	let response = await fetch(url)
	if (!response.ok) throw new Error(`Failed to fetch ${url}`)
	return replaceShortcutTokens(await response.text())
}
