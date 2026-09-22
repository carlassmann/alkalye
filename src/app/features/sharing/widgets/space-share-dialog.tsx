import { IconTransition } from "@/app/components/ui/icon-transition"
import { useState, useEffect } from "react"
import { toast } from "sonner"
import { useAccount, useIsAuthenticated } from "jazz-tools/react"
import { useNavigate, Link, useLocation } from "@tanstack/react-router"
import {
	Copy,
	Check,
	Link as LinkIcon,
	Trash2,
	LogOut,
	CloudOff,
	Globe,
	Lock,
} from "lucide-react"
import { co } from "jazz-tools"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/app/components/ui/dialog"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/app/components/ui/select"
import { Badge } from "@/app/components/ui/badge"
import { Button } from "@/app/components/ui/button"
import { Space, UserAccount } from "@/schema"
import { useIntl, T } from "@/shared/intl/setup"
import {
	createSpaceInvite,
	listSpaceCollaborators,
	getSpaceOwner,
	revokeSpaceInvite,
	changeSpaceCollaboratorRole,
	leaveSpace,
	isSpacePublic,
	makeSpacePublic,
	makeSpacePrivate,
	getSpaceGroup,
} from "@/app/features/spaces"
import { testIds } from "@/app/lib/test-ids"

export { SpaceShareDialog }
export type { SpaceShareDialogProps }

type InviteRole = "writer" | "reader"

type Collaborator = {
	id: string
	name: string
	role: string
	inviteGroupId: string
}

type LoadedSpace = co.loaded<typeof Space, { documents: true }>

interface SpaceShareDialogProps {
	space: LoadedSpace
	open?: boolean
	onOpenChange?: (open: boolean) => void
}

function SpaceShareDialog({
	space,
	open: controlledOpen,
	onOpenChange,
}: SpaceShareDialogProps) {
	let t = useIntl()
	let navigate = useNavigate()
	let location = useLocation()
	let isAuthenticated = useIsAuthenticated()
	let [internalOpen, setInternalOpen] = useState(false)

	let open = controlledOpen ?? internalOpen
	let setOpen = onOpenChange ?? setInternalOpen
	let [inviteLink, setInviteLink] = useState<string | null>(null)
	let [inviteRole, setInviteRole] = useState<InviteRole | null>(null)
	let [copied, setCopied] = useState(false)
	let [loading, setLoading] = useState(false)
	let [collaborators, setCollaborators] = useState<Collaborator[]>([])
	let [pendingInvites, setPendingInvites] = useState<
		{ inviteGroupId: string }[]
	>([])
	let [owner, setOwner] = useState<{ id: string; name: string } | null>(null)
	let [spaceIsPublic, setSpaceIsPublic] = useState(() => isSpacePublic(space))
	let [publicCopied, setPublicCopied] = useState(false)
	let me = useAccount(UserAccount, { resolve: { root: { spaces: true } } })

	let spaceGroup = getSpaceGroup(space)
	let isAdmin = spaceGroup?.myRole() === "admin"
	let isCollaborator = spaceGroup && !isAdmin

	async function refreshCollaborators() {
		let result = await listSpaceCollaborators(space)
		setCollaborators(result.collaborators)
		setPendingInvites(result.pendingInvites)
		let spaceOwner = await getSpaceOwner(space)
		setOwner(spaceOwner)
	}

	useEffect(() => {
		if (!open) return
		refreshCollaborators()
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, space])

	async function handleCreateLink(role: InviteRole) {
		if (!me?.$isLoaded) return
		setLoading(true)

		try {
			let { link } = await createSpaceInvite(space, role)
			setInviteLink(link)
			setInviteRole(role)
			await refreshCollaborators()
		} catch (e) {
			console.error("Failed to create invite link:", e)
			toast.error(t("sharing.space.link.createFailed"))
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

	function handleRevoke(inviteGroupId: string) {
		revokeSpaceInvite(space, inviteGroupId)
		refreshCollaborators()
		if (inviteLink?.includes(inviteGroupId)) {
			setInviteLink(null)
			setInviteRole(null)
		}
	}

	async function handleLeave() {
		if (!me?.$isLoaded) return
		setLoading(true)
		try {
			await leaveSpace(space, me)
			setOpen(false)
			navigate({ to: "/" })
		} catch (e) {
			console.error("Failed to leave space:", e)
			toast.error(t("sharing.space.leaveFailed"))
		} finally {
			setLoading(false)
		}
	}

	async function handleCopyPublicLink() {
		let link = getSpacePublicLink(space)
		await navigator.clipboard.writeText(link)
		setPublicCopied(true)
		setTimeout(() => setPublicCopied(false), 2000)
	}

	function handleMakePublic() {
		setLoading(true)
		try {
			makeSpacePublic(space)
			setSpaceIsPublic(true)
		} catch (e) {
			console.error("Failed to make space public:", e)
			toast.error(t("sharing.space.publicLink.makeFailed"))
		} finally {
			setLoading(false)
		}
	}

	function handleMakePrivate() {
		setLoading(true)
		try {
			makeSpacePrivate(space)
			setSpaceIsPublic(false)
		} catch (e) {
			console.error("Failed to make space private:", e)
			toast.error(t("sharing.space.publicLink.makePrivateFailed"))
		} finally {
			setLoading(false)
		}
	}

	async function handleChangeRole(inviteGroupId: string, newRole: InviteRole) {
		try {
			await changeSpaceCollaboratorRole(space, inviteGroupId, newRole)
			await refreshCollaborators()
		} catch (e) {
			console.error("Failed to change role:", e)
			toast.error(t("sharing.space.changeRoleFailed"))
		}
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent data-testid={testIds.space.shareDialog}>
				<DialogHeader>
					<DialogTitle>
						<T k="sharing.space.title" />
					</DialogTitle>
					<DialogDescription>
						{!isAuthenticated
							? t("sharing.space.signInToShare")
							: isAdmin
								? t("sharing.space.inviteOthers")
								: owner
									? t("sharing.space.sharedByUser", { name: owner.name })
									: t("sharing.space.viewingShared")}
					</DialogDescription>
				</DialogHeader>

				{!isAuthenticated && isAdmin && (
					<div className="flex flex-col items-center gap-3 py-4">
						<CloudOff className="text-muted-foreground size-8" />
						<p className="text-muted-foreground text-center text-sm">
							<T k="sharing.space.syncRequired" />
						</p>
						<Link to="/settings" search={{ from: location.pathname }}>
							<Button size="sm">
								<T k="sharing.document.signInToSyncButton" />
							</Button>
						</Link>
					</div>
				)}

				{isAuthenticated && isAdmin && (
					<div className="space-y-4">
						{inviteLink ? (
							<div className="space-y-2">
								<div className="text-muted-foreground text-xs">
									{t("sharing.space.link.roleInviteLink", {
										role:
											inviteRole === "writer"
												? t("sharing.role.writer")
												: t("sharing.role.reader"),
									})}
								</div>
								<div className="bg-muted flex items-center gap-2 rounded p-2 text-xs">
									<input
										type="text"
										value={inviteLink}
										readOnly
										data-testid={testIds.space.shareInviteLinkInput}
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
								<Button
									variant="ghost"
									size="sm"
									className="w-full"
									onClick={() => {
										setInviteLink(null)
										setInviteRole(null)
									}}
								>
									<T k="sharing.space.link.createDifferent" />
								</Button>
							</div>
						) : (
							<div className="space-y-2">
								<div className="text-muted-foreground text-xs font-medium">
									<T k="sharing.space.link.createInviteLink" />
								</div>
								<div className="flex gap-2">
									<Button
										variant="outline"
										size="sm"
										className="flex-1"
										onClick={() => handleCreateLink("writer")}
										disabled={loading}
										data-testid={testIds.space.shareWriterInviteButton}
									>
										<LinkIcon className="mr-1 size-3.5" />
										<T k="sharing.role.writer" />
									</Button>
									<Button
										variant="outline"
										size="sm"
										className="flex-1"
										onClick={() => handleCreateLink("reader")}
										disabled={loading}
										data-testid={testIds.space.shareReaderInviteButton}
									>
										<LinkIcon className="mr-1 size-3.5" />
										<T k="sharing.role.reader" />
									</Button>
								</div>
							</div>
						)}

						<div className="border-border space-y-2 border-t pt-3">
							<div className="text-muted-foreground text-xs font-medium">
								<T k="sharing.space.publicAccess" />
							</div>
							{spaceIsPublic ? (
								<div className="space-y-2">
									<div className="bg-muted flex items-center gap-2 rounded p-2 text-xs">
										<Globe className="size-3.5 shrink-0 text-green-600 dark:text-green-400" />
										<input
											type="text"
											value={getSpacePublicLink(space)}
											readOnly
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
										<T k="sharing.space.publicLink.viewDescription" />
									</p>
									<Button
										variant="ghost"
										size="sm"
										className="w-full"
										onClick={handleMakePrivate}
										disabled={loading}
									>
										<Lock className="mr-1 size-3.5" />
										<T k="sharing.space.publicLink.makePrivate" />
									</Button>
								</div>
							) : (
								<div className="space-y-2">
									<p className="text-muted-foreground text-xs">
										<T k="sharing.space.publicLink.description" />
									</p>
									<Button
										variant="outline"
										size="sm"
										className="w-full"
										onClick={handleMakePublic}
										disabled={loading}
									>
										<Globe className="mr-1 size-3.5" />
										<T k="sharing.space.publicLink.makePublic" />
									</Button>
								</div>
							)}
						</div>
					</div>
				)}

				{collaborators.length > 0 && (
					<div className="space-y-2">
						<div className="text-muted-foreground text-xs font-medium">
							<T k="sharing.space.members.label" />
						</div>
						<ul className="space-y-1">
							{collaborators.map(c => (
								<li
									key={c.id}
									className="flex items-center justify-between py-1 text-sm"
								>
									<span className="flex items-center gap-2">
										{c.name}
										{c.id === me?.$jazz.id && (
											<Badge variant="secondary">
												<T k="sharing.space.members.you" />
											</Badge>
										)}
									</span>
									<div className="flex items-center gap-2">
										{isAdmin && c.id !== me?.$jazz.id ? (
											<>
												<Select
													value={c.role}
													onValueChange={newRole =>
														handleChangeRole(
															c.inviteGroupId,
															newRole as InviteRole,
														)
													}
												>
													<SelectTrigger size="sm" className="h-6 text-xs">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="writer">
															<T k="sharing.role.writer" />
														</SelectItem>
														<SelectItem value="reader">
															<T k="sharing.role.reader" />
														</SelectItem>
													</SelectContent>
												</Select>
												<Button
													variant="ghost"
													size="icon-sm"
													onClick={() => handleRevoke(c.inviteGroupId)}
													aria-label={t("sharing.space.members.removeAccess")}
												>
													<Trash2 className="text-destructive size-3" />
												</Button>
											</>
										) : (
											<span className="text-muted-foreground text-xs">
												{c.role === "writer"
													? t("sharing.role.writer")
													: c.role === "admin"
														? t("sharing.role.admin")
														: t("sharing.role.reader")}
											</span>
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
							<T k="sharing.space.pendingInvites.label" />
						</div>
						<ul className="space-y-1">
							{pendingInvites.map(invite => (
								<li
									key={invite.inviteGroupId}
									className="text-muted-foreground flex items-center justify-between py-1 text-sm"
									data-testid={testIds.space.sharePendingInviteRow}
									data-invite-group-id={invite.inviteGroupId}
								>
									<span>
										<T k="sharing.space.pendingInvites.pending" />
									</span>
									<Button
										variant="ghost"
										size="icon-sm"
										onClick={() => handleRevoke(invite.inviteGroupId)}
										aria-label={t("sharing.space.pendingInvites.revoke")}
										data-testid={testIds.space.sharePendingInviteRevoke}
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
							<T k="sharing.space.leave" />
						</Button>
					</div>
				)}
			</DialogContent>
		</Dialog>
	)
}

function getSpacePublicLink(space: LoadedSpace): string {
	let baseURL = window.location.origin
	return `${baseURL}/spaces/${space.$jazz.id}`
}
