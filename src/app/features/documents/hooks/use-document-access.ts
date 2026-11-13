import { useAll } from "jazz-tools/react"
import { app, type DocumentRow } from "@/jazz/schema"
import { useLibrary } from "../lib/library"

export { useDocumentAccess }

function useDocumentAccess(
	doc: Pick<DocumentRow, "id" | "ownerId" | "spaceId"> | null | undefined,
) {
	let { ownerId, grants } = useLibrary()
	let { data: spaces = [] } = useAll(app.spaces.where({ ownerId }))
	let { data: members = [] } = useAll(
		app.spaceMembers.where({ accountId: ownerId }),
	)
	let grant = grants.find(grant => grant.documentId === doc?.id)
	let member = members.find(member => member.spaceId === doc?.spaceId)
	let ownsDocument = !!doc && doc.ownerId === ownerId
	let ownsSpace = spaces.some(space => space.id === doc?.spaceId)
	return {
		canEdit:
			ownsDocument ||
			ownsSpace ||
			(!!grant && grant.role !== "reader") ||
			(!!member && member.role !== "reader"),
		canAdmin:
			ownsDocument ||
			ownsSpace ||
			grant?.role === "admin" ||
			member?.role === "admin",
	}
}
