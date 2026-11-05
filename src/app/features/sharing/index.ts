export { usePresence } from "./lib/presence"
export {
	remoteCursorsExtension,
	setRemoteCursorsEffect,
} from "./lib/remote-cursors"

export {
	createDocumentInvite,
	revokeDocumentInvite,
	listCollaborators,
	acceptDocumentInvite,
	leavePersonalDocument,
	parseInviteLink,
	changeCollaboratorRole,
	getDocumentGroup,
	canEdit,
	getMyRole,
	isDocumentPublic,
	makeDocumentPublic,
	makeDocumentPrivate,
	getPublicLink,
	getDocumentOwner,
	migrateDocumentToGroup,
	getSharingStatus,
	hasIndividualShares,
} from "./lib/document-sharing"
export type {
	Collaborator,
	DocInviteData,
	CollaboratorsResult,
	DocumentInviteResult,
	SharingStatus,
	InviteRole,
} from "./lib/document-sharing"

export {
	buildDocumentInviteLink,
	buildSpaceInviteLink,
	buildDocumentPublicLink,
	buildSpacePublicLink,
} from "./lib/invite-links"

export { ShareDialog } from "./widgets/share-dialog"
export { SpaceShareDialog } from "./widgets/space-share-dialog"
export { SidebarCollaboration } from "./widgets/sidebar-collaboration"
export { InviteScreen } from "./screens/invite-screen"
