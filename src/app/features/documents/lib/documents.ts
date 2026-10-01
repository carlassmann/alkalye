import { Group, co } from "jazz-tools"
import { CommentThread, Document } from "./schema"
import { UserAccount } from "@/schema"
import { permanentlyDeleteDocument } from "./delete-covalue"
import { createDocumentMetadata, syncDocumentMetadata } from "./metadata"

export {
	createPersonalDocument,
	deletePersonalDocument,
	restorePersonalDocument,
	permanentlyDeletePersonalDocument,
	copyDocumentToMyList,
}

export type { PersonalDocumentOperation }

type PersonalDocumentOperation =
	| { type: "success" }
	| { type: "error"; error: string }

async function createPersonalDocument(
	account: co.loaded<typeof UserAccount>,
	content: string = "",
) {
	let group = Group.create(account)
	let now = new Date()
	let doc = Document.create(
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

	let loadedAccount = await account.$jazz.ensureLoaded({
		resolve: { root: { documents: true } },
	})
	if (loadedAccount.root?.documents?.$isLoaded) {
		loadedAccount.root.documents.$jazz.push(doc)
	}

	return doc
}

async function deletePersonalDocument(
	doc: co.loaded<typeof Document>,
): Promise<PersonalDocumentOperation> {
	let docGroup = doc.$jazz.owner

	let role = docGroup.myRole()
	if (role !== "admin") {
		return { type: "error", error: "Only admins can delete documents" }
	}

	doc.$jazz.set("deletedAt", new Date())
	doc.$jazz.set("updatedAt", new Date())
	let loaded = await doc.$jazz.ensureLoaded({ resolve: { content: true } })
	syncDocumentMetadata(loaded, { contentChanged: false })
	return { type: "success" }
}

async function restorePersonalDocument(
	doc: co.loaded<typeof Document>,
	account: co.loaded<typeof UserAccount>,
): Promise<PersonalDocumentOperation> {
	let docGroup = doc.$jazz.owner

	let role = docGroup.myRole()
	if (role !== "admin") {
		return { type: "error", error: "Only admins can restore documents" }
	}

	if (!doc.deletedAt) {
		return { type: "error", error: "Document is not deleted" }
	}

	doc.$jazz.set("deletedAt", undefined)
	doc.$jazz.set("updatedAt", new Date())
	let docWithContent = await doc.$jazz.ensureLoaded({
		resolve: { content: true },
	})
	syncDocumentMetadata(docWithContent, { contentChanged: false })

	let loadedAccount = await account.$jazz.ensureLoaded({
		resolve: { root: { documents: true, inactiveDocuments: true } },
	})

	if (loadedAccount.root?.inactiveDocuments?.$isLoaded) {
		let idx = loadedAccount.root.inactiveDocuments.findIndex(
			d => d?.$jazz.id === doc.$jazz.id,
		)
		if (idx !== -1) {
			loadedAccount.root.inactiveDocuments.$jazz.splice(idx, 1)
			loadedAccount.root.documents.$jazz.push(doc)
		}
	}

	return { type: "success" }
}

async function permanentlyDeletePersonalDocument(
	doc: co.loaded<typeof Document>,
	account: co.loaded<typeof UserAccount>,
): Promise<PersonalDocumentOperation> {
	let docGroup = doc.$jazz.owner
	let role = docGroup.myRole()
	if (role !== "admin") {
		return {
			type: "error",
			error: "Only admins can permanently delete documents",
		}
	}

	for (let inviteGroup of docGroup.getParentGroups()) {
		docGroup.removeMember(inviteGroup)
	}

	let loadedAccount = await account.$jazz.ensureLoaded({
		resolve: { root: { documents: true, inactiveDocuments: true } },
	})
	if (loadedAccount.root?.documents?.$isLoaded) {
		let idx = loadedAccount.root.documents.findIndex(
			d => d?.$jazz.id === doc.$jazz.id,
		)
		if (idx !== -1) {
			loadedAccount.root.documents.$jazz.splice(idx, 1)
		}
	}
	if (loadedAccount.root?.inactiveDocuments?.$isLoaded) {
		let idx = loadedAccount.root.inactiveDocuments.findIndex(
			d => d?.$jazz.id === doc.$jazz.id,
		)
		if (idx !== -1) {
			loadedAccount.root.inactiveDocuments.$jazz.splice(idx, 1)
		}
	}

	try {
		await permanentlyDeleteDocument(doc)
	} catch {
		// May fail if not accessible, but we've already removed from list
	}

	return { type: "success" }
}

async function copyDocumentToMyList(
	doc: co.loaded<typeof Document, { content: true }>,
	me: co.loaded<typeof UserAccount, { root: { documents: true } }>,
): Promise<{ $jazz: { id: string } }> {
	if (!me.root?.documents) throw new Error("User documents list not loaded")

	let group = Group.create(me)

	let now = new Date()
	let sourceContent = doc.content?.toString() ?? ""
	let newDoc = Document.create(
		{
			version: 1,
			content: co.plainText().create(sourceContent, group),
			...createDocumentMetadata(sourceContent, now),
			createdAt: now,
			updatedAt: now,
		},
		group,
	)

	me.root.documents.$jazz.push(newDoc)
	return newDoc
}
