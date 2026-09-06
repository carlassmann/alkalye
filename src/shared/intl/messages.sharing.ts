import { messages, translate } from "@ccssmnn/intl"

export { baseSharingMessages, deSharingMessages }

let baseSharingMessages = messages({
	"sharing.document.title": "Share document",
	"sharing.document.signInToShare": "Sign in to share documents with others",
	"sharing.document.inviteOthers":
		"Invite others to view or edit this document",
	"sharing.document.sharedByUser": "Shared with you by {$name}",
	"sharing.document.viewingShared": "You're viewing a shared document",
	"sharing.document.syncRequired": "Sharing requires sync to be enabled",
	"sharing.document.signInToSyncButton": "Sign in to share",

	"sharing.document.link.canEdit": "Can edit",
	"sharing.document.link.canView": "Can view",
	"sharing.document.link.copyLabel": "Copy link",
	"sharing.document.link.share": "Share invite...",
	"sharing.document.link.dismiss": "Dismiss",
	"sharing.document.link.createFailed": "Failed to create invite link",

	"sharing.document.publicAccess": "Public access",
	"sharing.document.publicLink.description":
		"Anyone with this link can view this document",
	"sharing.document.publicLink.makePublic": "Make public",
	"sharing.document.publicLink.makePrivate": "Make private",
	"sharing.document.publicLink.makeFailed": "Failed to make document public",
	"sharing.document.publicLink.makePrivateFailed":
		"Failed to make document private",

	"sharing.document.collaborators.label": "Collaborators",
	"sharing.document.collaborators.you": "You",
	"sharing.document.collaborators.removeAccess": "Remove access",

	"sharing.document.pendingInvites.label": "Pending invites",
	"sharing.document.pendingInvites.pending": "Pending invite",
	"sharing.document.pendingInvites.revoke": "Revoke invite",

	"sharing.document.leave": "Leave document",

	"sharing.space.title": "Share space",
	"sharing.space.signInToShare": "Sign in to share spaces with others",
	"sharing.space.inviteOthers": "Invite others to collaborate on this space",
	"sharing.space.sharedByUser": "Shared with you by {$name}",
	"sharing.space.viewingShared": "You're viewing a shared space",
	"sharing.space.syncRequired": "Sharing requires sync to be enabled",

	"sharing.space.link.createInviteLink": "Create invite link",
	"sharing.space.link.createDifferent": "Create different link",
	"sharing.space.link.createFailed": "Failed to create invite link",
	"sharing.space.link.roleInviteLink": "{$role} invite link",

	"sharing.space.publicAccess": "Public access",
	"sharing.space.publicLink.description":
		"Make this space publicly readable by anyone with the link",
	"sharing.space.publicLink.viewDescription":
		"Anyone with this link can view this space and its documents",
	"sharing.space.publicLink.makePublic": "Make public",
	"sharing.space.publicLink.makePrivate": "Make private",
	"sharing.space.publicLink.makeFailed": "Failed to make space public",
	"sharing.space.publicLink.makePrivateFailed": "Failed to make space private",

	"sharing.space.members.label": "Members",
	"sharing.space.members.you": "You",
	"sharing.space.members.removeAccess": "Remove access",

	"sharing.space.pendingInvites.label": "Pending invites",
	"sharing.space.pendingInvites.pending": "Pending invite",
	"sharing.space.pendingInvites.revoke": "Revoke invite",

	"sharing.space.leave": "Leave space",

	"sharing.role.admin": "Admin",
	"sharing.role.writer": "Writer",
	"sharing.role.reader": "Reader",

	"sharing.sidebar.collaboration": "Collaboration",
	"sharing.sidebar.private": "Private",
	"sharing.sidebar.shared": "Shared",
	"sharing.sidebar.public": "Public",
	"sharing.sidebar.edit": "edit",
	"sharing.sidebar.view": "view",
	"sharing.sidebar.manage": "Manage sharing",

	"sharing.document.link.canEditLabel": "Can edit",
	"sharing.document.link.canViewLabel": "Can view",
	"sharing.space.publicLink.makeDescription":
		"Make this space publicly readable by anyone with the link",
	"sharing.space.link.createNewLink": "Create different link",

	"sharing.invite.join.document": "Join Document",
	"sharing.invite.join.space": "Join Space",
	"sharing.invite.youveBeenInvited": "You've been invited",
	"sharing.invite.signInDocument":
		"Sign in to join this document and start collaborating.",
	"sharing.invite.signInSpace":
		"Sign in to join this space and start collaborating.",
	"sharing.invite.loadingInvite": "Loading invite...",
	"sharing.invite.joiningDocument": "Joining document...",
	"sharing.invite.joiningSpace": "Joining space...",
	"sharing.invite.successDocument": "Opening document...",
	"sharing.invite.successSpace": "Opening space...",
	"sharing.invite.successTitle": "Joined successfully",
	"sharing.invite.revokedTitle": "Sorry, this invite expired :(",
	"sharing.invite.revokedDescription":
		"The invite link is no longer valid. Ask for a new one or continue to the app.",
	"sharing.invite.errorTitle": "Oh, this invite link does not work :(",
	"sharing.invite.errorDescription":
		"Ask for a new invite link or continue to the app.",
	"sharing.invite.errorReason": "Reason: {$error}",
	"sharing.invite.errorFallback": "We couldn't process this invite.",
	"sharing.invite.goToApp": "Go to App",

	"sharing.invite.invalidLink": "Invalid invite link",
	"sharing.invite.failedToAccept": "Failed to accept invite",

	"sharing.space.leaveFailed": "Failed to leave space",
	"sharing.space.changeRoleFailed": "Failed to change role",
})

let deSharingMessages = translate(baseSharingMessages, {
	"sharing.document.title": "Dokument teilen",
	"sharing.document.signInToShare":
		"Melde dich an, um Dokumente mit anderen zu teilen",
	"sharing.document.inviteOthers":
		"Lade andere ein, um dieses Dokument anzusehen oder zu bearbeiten",
	"sharing.document.sharedByUser": "Mit dir geteilt von {$name}",
	"sharing.document.viewingShared": "Du siehst ein geteiltes Dokument",
	"sharing.document.syncRequired": "Zum Teilen muss Sync aktiviert sein",
	"sharing.document.signInToSyncButton": "Anmelden zum Teilen",

	"sharing.document.link.canEdit": "Kann bearbeiten",
	"sharing.document.link.canView": "Kann ansehen",
	"sharing.document.link.copyLabel": "Link kopieren",
	"sharing.document.link.share": "Einladung teilen...",
	"sharing.document.link.dismiss": "Schließen",
	"sharing.document.link.createFailed":
		"Fehler beim Erstellen des Einladungslinks",

	"sharing.document.publicAccess": "Öffentlicher Zugriff",
	"sharing.document.publicLink.description":
		"Jeder mit diesem Link kann dieses Dokument ansehen",
	"sharing.document.publicLink.makePublic": "Öffentlich machen",
	"sharing.document.publicLink.makePrivate": "Privat machen",
	"sharing.document.publicLink.makeFailed":
		"Fehler beim Veröffentlichen des Dokuments",
	"sharing.document.publicLink.makePrivateFailed":
		"Fehler beim Privatmachen des Dokuments",

	"sharing.document.collaborators.label": "Mitarbeiter",
	"sharing.document.collaborators.you": "Du",
	"sharing.document.collaborators.removeAccess": "Zugriff entfernen",

	"sharing.document.pendingInvites.label": "Ausstehende Einladungen",
	"sharing.document.pendingInvites.pending": "Ausstehende Einladung",
	"sharing.document.pendingInvites.revoke": "Einladung widerrufen",

	"sharing.document.leave": "Dokument verlassen",

	"sharing.space.title": "Space teilen",
	"sharing.space.signInToShare":
		"Melde dich an, um Spaces mit anderen zu teilen",
	"sharing.space.inviteOthers":
		"Lade andere ein, um an diesem Space zu arbeiten",
	"sharing.space.sharedByUser": "Mit dir geteilt von {$name}",
	"sharing.space.viewingShared": "Du siehst einen geteilten Space",
	"sharing.space.syncRequired": "Zum Teilen muss Sync aktiviert sein",

	"sharing.space.link.createInviteLink": "Einladungslink erstellen",
	"sharing.space.link.createDifferent": "Anderen Link erstellen",
	"sharing.space.link.createFailed":
		"Fehler beim Erstellen des Einladungslinks",
	"sharing.space.link.roleInviteLink": "Einladungslink für {$role}",

	"sharing.space.publicAccess": "Öffentlicher Zugriff",
	"sharing.space.publicLink.description":
		"Mache diesen Space öffentlich lesbar für jeden mit dem Link",
	"sharing.space.publicLink.viewDescription":
		"Jeder mit diesem Link kann diesen Space und seine Dokumente ansehen",
	"sharing.space.publicLink.makePublic": "Öffentlich machen",
	"sharing.space.publicLink.makePrivate": "Privat machen",
	"sharing.space.publicLink.makeFailed":
		"Fehler beim Veröffentlichen des Spaces",
	"sharing.space.publicLink.makePrivateFailed":
		"Fehler beim Privatmachen des Spaces",

	"sharing.space.members.label": "Mitglieder",
	"sharing.space.members.you": "Du",
	"sharing.space.members.removeAccess": "Zugriff entfernen",

	"sharing.space.pendingInvites.label": "Ausstehende Einladungen",
	"sharing.space.pendingInvites.pending": "Ausstehende Einladung",
	"sharing.space.pendingInvites.revoke": "Einladung widerrufen",

	"sharing.space.leave": "Space verlassen",

	"sharing.role.admin": "Admin",
	"sharing.role.writer": "Autor",
	"sharing.role.reader": "Leser",

	"sharing.sidebar.collaboration": "Zusammenarbeit",
	"sharing.sidebar.private": "Privat",
	"sharing.sidebar.shared": "Geteilt",
	"sharing.sidebar.public": "Öffentlich",
	"sharing.sidebar.edit": "bearbeiten",
	"sharing.sidebar.view": "ansehen",
	"sharing.sidebar.manage": "Freigabe verwalten",

	"sharing.document.link.canEditLabel": "Kann bearbeiten",
	"sharing.document.link.canViewLabel": "Kann ansehen",
	"sharing.space.publicLink.makeDescription":
		"Mache diesen Space öffentlich lesbar für jeden mit dem Link",
	"sharing.space.link.createNewLink": "Anderen Link erstellen",

	"sharing.invite.join.document": "Dokument beitreten",
	"sharing.invite.join.space": "Space beitreten",
	"sharing.invite.youveBeenInvited": "Du wurdest eingeladen",
	"sharing.invite.signInDocument":
		"Melde dich an, um diesem Dokument beizutreten und zu arbeiten.",
	"sharing.invite.signInSpace":
		"Melde dich an, um diesem Space beizutreten und zu arbeiten.",
	"sharing.invite.loadingInvite": "Einladung wird geladen...",
	"sharing.invite.joiningDocument": "Trete dem Dokument bei...",
	"sharing.invite.joiningSpace": "Trete dem Space bei...",
	"sharing.invite.successDocument": "Öffne Dokument...",
	"sharing.invite.successSpace": "Öffne Space...",
	"sharing.invite.successTitle": "Erfolgreich beigetreten",
	"sharing.invite.revokedTitle": "Diese Einladung ist abgelaufen :(",
	"sharing.invite.revokedDescription":
		"Der Einladungslink ist nicht mehr gültig. Fordere einen neuen an oder gehe zur App.",
	"sharing.invite.errorTitle":
		"Oh, dieser Einladungslink funktioniert nicht :(",
	"sharing.invite.errorDescription":
		"Fordere einen neuen Einladungslink an oder gehe zur App.",
	"sharing.invite.errorReason": "Grund: {$error}",
	"sharing.invite.errorFallback":
		"Wir konnten diese Einladung nicht verarbeiten.",
	"sharing.invite.goToApp": "Zur App",

	"sharing.invite.invalidLink": "Ungültiger Einladungslink",
	"sharing.invite.failedToAccept": "Fehler beim Annehmen der Einladung",

	"sharing.space.leaveFailed": "Fehler beim Verlassen des Spaces",
	"sharing.space.changeRoleFailed": "Fehler beim Ändern der Rolle",
})
