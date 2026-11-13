import type { LibraryDocument } from "@/app/features/documents/lib/library"
export { canEdit } from "@/app/features/documents/lib/library"
export {
	getSharingStatus,
	isDocumentPublic,
	hasIndividualShares,
	getDocumentGroup,
	ShareDialog,
	leavePersonalDocument,
}
function isDocumentPublic(doc: LibraryDocument) {
	return doc.publicRead
}
function hasIndividualShares(_doc: LibraryDocument, _spaceGroupId?: string) {
	return false
}
function getSharingStatus(doc: LibraryDocument) {
	return doc.publicRead ? "public" : "private"
}
function getDocumentGroup(doc: LibraryDocument) {
	// v2-todo(sharing): expose grant roles in all menus.
	return {
		myRole: () => (doc.canAdmin ? "admin" : doc.canEdit ? "writer" : "reader"),
	}
}
function ShareDialog(_props: {
	doc: LibraryDocument
	open?: boolean
	onOpenChange?: (open: boolean) => void
	spaceGroupId?: string
}) {
	// v2-todo(sharing): trusted invite redemption.
	return null
}
function leavePersonalDocument(..._args: unknown[]) {
	// v2-todo(sharing): trusted membership removal.
}

export { SidebarCollaboration } from "./widgets/sidebar-collaboration"
