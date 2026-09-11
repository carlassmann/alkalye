import { Group, co, type Account } from "jazz-tools"
import { CommentThread, Document } from "./schema"
import { createDocumentMetadata } from "./metadata"

export { createSpaceDocument }

function createSpaceDocument(
	spaceGroup: Group,
	spaceId: string | undefined,
	content: string = "",
	createdBy?: Account,
): co.loaded<typeof Document, { content: true; comments: true }> {
	// Create a document-specific group with space group as parent (no role = inherit)
	// Space members inherit their space role: reader→reader, writer→writer, admin→admin
	// Doc-level invites go to docGroup, not spaceGroup (so they don't grant space access)
	let docGroup = Group.create(createdBy)
	docGroup.addMember(spaceGroup)

	let now = new Date()
	let doc = Document.create(
		{
			version: 1,
			content: co.plainText().create(content, docGroup),
			comments: co.list(CommentThread).create([], docGroup),
			...createDocumentMetadata(content, now),
			spaceId,
			createdAt: now,
			updatedAt: now,
		},
		docGroup,
	)

	return doc as co.loaded<typeof Document, { content: true; comments: true }>
}
