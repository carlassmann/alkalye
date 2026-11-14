import { useIsBackedUp } from "@/app/features/auth"
import { IconTransition } from "@/app/components/ui/icon-transition"
import { useState, useEffect, useRef } from "react"
import { useLibrary, type LibraryDocument } from "@/app/features/documents"
import { useNavigate, Link, useLocation } from "@tanstack/react-router"
import {
	Copy,
	Check,
	Link as LinkIcon,
	Trash2,
	X,
	LogOut,
	CloudOff,
	Globe,
	Lock,
} from "lucide-react"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/app/components/ui/dialog"
import { Badge } from "@/app/components/ui/badge"
import { Button } from "@/app/components/ui/button"
import { useIntl, T } from "@/shared/intl/setup"
import {
	createDocumentInvite,
	revokeDocumentInvite,
	leavePersonalDocument,
	listCollaborators,
	getDocumentGroup,
	getDocumentOwner,
	makeDocumentPublic,
	makeDocumentPrivate,
	getPublicLink,
	type Collaborator,
} from "../lib/document-sharing"
import { testIds } from "@/app/lib/test-ids"
import { NativeShareIcon } from "@/app/components/native-share-icon"

export { ShareDialog }

type InviteRole = "writer" | "reader"

type LoadedDocument = LibraryDocument

interface ShareDialogProps {
	doc: LoadedDocument
	open?: boolean
	onOpenChange?: (open: boolean) => void
}

function ShareDialog({
	doc,
	open: controlledOpen,
	onOpenChange,
}: ShareDialogProps) {
	let t = useIntl()
	let navigate = useNavigate()
	let location = useLocation()
	let { db, ownerId } = useLibrary()
	let isAuthenticated = useIsBackedUp()
	let [internalOpen, setInternalOpen] = useState(false)

	let open = controlledOpen ?? internalOpen
	let setOpen = onOpenChange ?? setInternalOpen
	let [inviteLink, setInviteLink] = useState<string | null>(null)
	let [copied, setCopied] = useState(false)
	let [publicCopied, setPublicCopied] = useState(false)
	let [loading, setLoading] = useState(false)
	let [collaborators, setCollaborators] = useState<Collaborator[]>([])
	let [pendingInvites, setPendingInvites] = useState<
		{ inviteGroupId: string }[]
	>([])
	let [owner, setOwner] = useState<{ id: string; name: string } | null>(null)
	let currentDoc = doc
	let docIsPublic = doc.publicRead

	let docGroup = getDocumentGroup(currentDoc)
	let isAdmin = docGroup?.myRole() === "admin"
	let isGroupOwned = docGroup !== null
	let isOwner = isAdmin
	let isCollaborator = isGroupOwned && !isAdmin
	let canShareInvite =
		typeof navigator !== "undefined" && typeof navigator.share === "function"

	let refreshCollaboratorsRef = useRef(async () => {
		let result = await listCollaborators(db, currentDoc)
		setCollaborators(result.collaborators)
		setPendingInvites(result.pendingInvites)
		let docOwner = await getDocumentOwner(db, currentDoc)
		setOwner(docOwner)
	})
	useEffect(() => {
		refreshCollaboratorsRef.current = async () => {
			let result = await listCollaborators(db, currentDoc)
			setCollaborators(result.collaborators)
			setPendingInvites(result.pendingInvites)
			let docOwner = await getDocumentOwner(db, currentDoc)
			setOwner(docOwner)
		}
	})

	useEffect(() => {
		if (!open) return
		refreshCollaboratorsRef.current()
	}, [open, currentDoc])

	async function handleCreateLink(role: InviteRole) {
		setLoading(true)

		try {
			let { link } = await createDocumentInvite(db, doc, role)
			setInviteLink(link ?? null)
			await refreshCollaboratorsRef.current()
		} catch (e) {
			console.error("Failed to create invite link:", e)
		} finally {
			setLoading(false)
		}
	}

	async function handleCopy() {
		if (!inviteLink) return
		await navigator.clipboard.writeText(inviteLink)
		setCopied(true)
		setTimeout(() => setCopied(false), 2000)
	}

	async function handleShareInvite() {
		if (!inviteLink) return

		try {
			await navigator.share({
				title: currentDoc.title,
				url: inviteLink,
			})
		} catch (error) {
			if (error instanceof Error && error.name !== "AbortError")
				console.error("Failed to share invite link:", error)
		}
	}

	async function handleCopyPublicLink() {
		let link = getPublicLink(currentDoc)
		await navigator.clipboard.writeText(link)
		setPublicCopied(true)
		setTimeout(() => setPublicCopied(false), 2000)
	}

	async function handleMakePublic() {
		setLoading(true)

		try {
			await makeDocumentPublic(db, currentDoc)
		} catch (e) {
			console.error("Failed to make document public:", e)
		} finally {
			setLoading(false)
		}
	}

	async function handleMakePrivate() {
		setLoading(true)
		try {
			await makeDocumentPrivate(db, currentDoc)
		} catch (e) {
			console.error("Failed to make document private:", e)
		} finally {
			setLoading(false)
		}
	}

	async function handleRevoke(inviteGroupId: string) {
		await revokeDocumentInvite(db, doc, inviteGroupId)
		refreshCollaboratorsRef.current()
		if (inviteLink?.includes(inviteGroupId)) {
			setInviteLink(null)
		}
	}

	async function handleLeave() {
		setLoading(true)
		try {
			await leavePersonalDocument(db, doc)
			setOpen(false)
			void navigate({ to: "/" })
		} finally {
			setLoading(false)
		}
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent data-testid={testIds.collab.docShareDialog}>
				<DialogHeader>
					<DialogTitle>
						<T k="sharing.document.title" />
					</DialogTitle>
					<DialogDescription>
						{!isAuthenticated
							? t("sharing.document.signInToShare")
							: isOwner
								? t("sharing.document.inviteOthers")
								: owner
									? t("sharing.document.sharedByUser", { name: owner.name })
									: t("sharing.document.viewingShared")}
					</DialogDescription>
				</DialogHeader>

				{!isAuthenticated && isOwner && (
					<div className="flex flex-col items-center gap-3 py-4">
						<CloudOff className="text-muted-foreground size-8" />
						<p className="text-muted-foreground text-center text-sm">
							<T k="sharing.document.syncRequired" />
						</p>
						<Link to="/settings" search={{ from: location.pathname }}>
							<Button size="sm">
								<T k="sharing.document.signInToSyncButton" />
							</Button>
						</Link>
					</div>
				)}

				{isAuthenticated && isOwner && (
					<div className="space-y-4">
						{inviteLink ? (
							<div className="space-y-2">
								<div className="bg-muted flex items-center gap-2 rounded p-2 text-xs">
									<input
										type="text"
										value={inviteLink}
										readOnly
										data-testid={testIds.collab.docShareInviteLinkInput}
										className="flex-1 truncate bg-transparent outline-none"
									/>
									<Button
										variant="ghost"
										size="icon-sm"
										onClick={handleCopy}
										aria-label={t("sharing.document.link.copyLabel")}
									>
										<IconTransition
											active={copied ? "on" : "off"}
											icons={{
												on: <Check className="size-3.5" />,
												off: <Copy className="size-3.5" />,
											}}
											className="size-3.5"
										/>
									</Button>
								</div>
								{canShareInvite && (
									<Button
										variant="outline"
										size="sm"
										className="w-full"
										onClick={handleShareInvite}
										data-testid={testIds.collab.docShareInviteNativeButton}
									>
										<NativeShareIcon className="mr-1 size-3.5" />
										<T k="sharing.document.link.share" />
									</Button>
								)}
								<Button
									variant="ghost"
									size="sm"
									className="w-full"
									onClick={() => setInviteLink(null)}
								>
									<X className="mr-1 size-3.5" />
									<T k="sharing.document.link.dismiss" />
								</Button>
							</div>
						) : (
							<div className="flex gap-2">
								<Button
									variant="outline"
									size="sm"
									className="flex-1"
									onClick={() => handleCreateLink("writer")}
									disabled={loading}
									data-testid={testIds.collab.docShareInviteWriterButton}
								>
									<LinkIcon className="mr-1 size-3.5" />
									<T k="sharing.document.link.canEdit" />
								</Button>
								<Button
									variant="outline"
									size="sm"
									className="flex-1"
									onClick={() => handleCreateLink("reader")}
									disabled={loading}
									data-testid={testIds.collab.docShareInviteReaderButton}
								>
									<LinkIcon className="mr-1 size-3.5" />
									<T k="sharing.document.link.canView" />
								</Button>
							</div>
						)}

						<div className="border-border space-y-2 border-t pt-3">
							<div className="text-muted-foreground text-xs font-medium">
								<T k="sharing.document.publicAccess" />
							</div>
							{docIsPublic ? (
								<div className="space-y-2">
									<div className="bg-muted flex items-center gap-2 rounded p-2 text-xs">
										<Globe className="size-3.5 shrink-0 text-green-600 dark:text-green-400" />
										<input
											type="text"
											value={getPublicLink(currentDoc)}
											readOnly
											data-testid={testIds.collab.docPublicLinkInput}
											className="flex-1 truncate bg-transparent outline-none"
										/>
										<Button
											variant="ghost"
											size="icon-sm"
											onClick={handleCopyPublicLink}
											aria-label={t("sharing.document.link.copyLabel")}
										>
											<IconTransition
												active={publicCopied ? "on" : "off"}
												icons={{
													on: <Check className="size-3.5" />,
													off: <Copy className="size-3.5" />,
												}}
												className="size-3.5"
											/>
										</Button>
									</div>
									<p className="text-muted-foreground text-xs">
										<T k="sharing.document.publicLink.description" />
									</p>
									<Button
										variant="ghost"
										size="sm"
										className="w-full"
										onClick={handleMakePrivate}
										disabled={loading}
										data-testid={testIds.collab.docPublicDisableButton}
									>
										<Lock className="mr-1 size-3.5" />
										<T k="sharing.document.publicLink.makePrivate" />
									</Button>
								</div>
							) : (
								<div className="space-y-2">
									<p className="text-muted-foreground text-xs">
										<T k="sharing.document.publicLink.description" />
									</p>
									<Button
										variant="outline"
										size="sm"
										className="w-full"
										onClick={handleMakePublic}
										disabled={loading}
										data-testid={testIds.collab.docPublicEnableButton}
									>
										<Globe className="mr-1 size-3.5" />
										<T k="sharing.document.publicLink.makePublic" />
									</Button>
								</div>
							)}
						</div>
					</div>
				)}

				{collaborators.length > 0 && (
					<div className="space-y-2">
						<div className="text-muted-foreground text-xs font-medium">
							<T k="sharing.document.collaborators.label" />
						</div>
						<ul className="space-y-1">
							{collaborators.map(c => (
								<li
									key={c.id}
									className="flex items-center justify-between py-1 text-sm"
								>
									<span className="flex items-center gap-2">
										{c.name}
										{c.id === ownerId && (
											<Badge variant="secondary">
												<T k="sharing.document.collaborators.you" />
											</Badge>
										)}
									</span>
									<div className="flex items-center gap-2">
										<span className="text-muted-foreground text-xs capitalize">
											{c.role === "writer"
												? t("sharing.document.link.canEdit")
												: t("sharing.document.link.canView")}
										</span>
										{isAdmin && (
											<Button
												variant="ghost"
												size="icon-sm"
												onClick={() => handleRevoke(c.inviteGroupId)}
												aria-label={t(
													"sharing.document.collaborators.removeAccess",
												)}
											>
												<Trash2 className="text-destructive size-3" />
											</Button>
										)}
									</div>
								</li>
							))}
						</ul>
					</div>
				)}

				{pendingInvites.length > 0 && isAdmin && (
					<div className="space-y-2">
						<div className="text-muted-foreground text-xs font-medium">
							<T k="sharing.document.pendingInvites.label" />
						</div>
						<ul className="space-y-1">
							{pendingInvites.map(invite => (
								<li
									key={invite.inviteGroupId}
									className="text-muted-foreground flex items-center justify-between py-1 text-sm"
									data-testid={testIds.collab.docSharePendingInviteRow}
									data-invite-group-id={invite.inviteGroupId}
								>
									<span>
										<T k="sharing.document.pendingInvites.pending" />
									</span>
									<Button
										variant="ghost"
										size="icon-sm"
										onClick={() => handleRevoke(invite.inviteGroupId)}
										aria-label={t("sharing.document.pendingInvites.revoke")}
										data-testid={testIds.collab.docSharePendingInviteRevoke}
										data-invite-group-id={invite.inviteGroupId}
									>
										<Trash2 className="text-destructive size-3" />
									</Button>
								</li>
							))}
						</ul>
					</div>
				)}

				{isCollaborator && (
					<div className="border-border border-t pt-2">
						<Button
							variant="ghost"
							size="sm"
							className="text-destructive hover:text-destructive w-full"
							onClick={handleLeave}
							disabled={loading}
						>
							<LogOut className="mr-1 size-3.5" />
							<T k="sharing.document.leave" />
						</Button>
					</div>
				)}
			</DialogContent>
		</Dialog>
	)
}
