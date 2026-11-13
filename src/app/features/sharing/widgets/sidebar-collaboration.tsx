import { useState } from "react"
import { useLibrary } from "@/app/features/documents"
import {
	SidebarGroupLabel,
	SidebarGroupContent,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/app/components/ui/sidebar"
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/app/components/ui/context-menu"
import { Globe, Lock, Trash2, UserCog, Users } from "lucide-react"
import { ShareDialog } from "../index"
type Collaborator = {
	id: string
	name: string
	role: string
	inviteGroupId: string
}

import { testIds } from "@/app/lib/test-ids"
import { useHasFinePointer } from "@/app/hooks/use-fine-pointer"
import { useIntl, T } from "@/shared/intl/setup"

export { SidebarCollaboration }

interface SidebarCollaborationProps {
	docId: string
	spaceGroupId?: string
}

function SidebarCollaboration({
	docId,
	spaceGroupId: _spaceGroupId,
}: SidebarCollaborationProps) {
	let t = useIntl()
	let hasFinePointer = useHasFinePointer()
	let [shareOpen, setShareOpen] = useState(false)
	let [collaborators, setCollaborators] = useState<Collaborator[]>([])

	let { documents, ownerId } = useLibrary()
	let doc = documents.find(doc => doc.id === docId)
	let isPublic = doc?.publicRead ?? false
	let currentUserId = ownerId
	// v2-todo(sharing): load collaborators and redeem verified invitations.

	let otherCollaborators = collaborators.filter(c => c.id !== currentUserId)
	let hasCollaborators = otherCollaborators.length > 0 || isPublic
	let isAdmin = doc?.canAdmin

	function removeCollaborator(collaborator: Collaborator) {
		if (!doc || !isAdmin) return
		// v2-todo(sharing): revoke collaborator access.
		setCollaborators(current =>
			current.filter(item => item.id !== collaborator.id),
		)
	}

	return (
		<>
			<SidebarGroupLabel>
				<T k="sharing.sidebar.collaboration" />
			</SidebarGroupLabel>
			<SidebarGroupContent>
				<SidebarMenu>
					{!hasCollaborators && !isPublic && (
						<SidebarMenuItem>
							<SidebarMenuButton
								disabled
								onClick={() => setShareOpen(true)}
								className="gap-2"
								nativeButton
								data-testid={testIds.collab.docShareOpenButton}
							>
								<Lock className="size-4" />
								<span>
									<T k="sharing.sidebar.private" />
								</span>
							</SidebarMenuButton>
						</SidebarMenuItem>
					)}

					{hasCollaborators && (
						<SidebarMenuItem>
							<SidebarMenuButton
								disabled
								onClick={() => setShareOpen(true)}
								className="gap-2"
								nativeButton
								data-testid={testIds.collab.docShareOpenButton}
							>
								<Users className="size-4" />
								<span>
									<T k="sharing.sidebar.shared" />
								</span>
							</SidebarMenuButton>
						</SidebarMenuItem>
					)}

					{otherCollaborators.map(c => (
						<ContextMenu key={c.id} disabled={!hasFinePointer}>
							<ContextMenuTrigger
								onTouchStart={event => event.preventBaseUIHandler()}
								render={
									<div className="text-muted-foreground flex items-center justify-between px-2 py-1 text-xs">
										<span className="truncate">{c.name}</span>
										<span className="shrink-0 opacity-60">
											{c.role === "writer"
												? t("sharing.sidebar.edit")
												: t("sharing.sidebar.view")}
										</span>
									</div>
								}
							/>
							<ContextMenuContent>
								<ContextMenuItem disabled onClick={() => setShareOpen(true)}>
									<UserCog />
									{t("sharing.sidebar.manage")}
								</ContextMenuItem>
								{isAdmin && (
									<ContextMenuItem
										variant="destructive"
										onClick={() => removeCollaborator(c)}
									>
										<Trash2 />
										{t("sharing.document.collaborators.removeAccess")}
									</ContextMenuItem>
								)}
							</ContextMenuContent>
						</ContextMenu>
					))}

					{isPublic && (
						<SidebarMenuItem>
							<SidebarMenuButton
								disabled
								onClick={() => setShareOpen(true)}
								className="gap-2"
								nativeButton
								data-testid={testIds.collab.docShareOpenButton}
							>
								<Globe className="size-4 text-green-600 dark:text-green-400" />
								<span>
									<T k="sharing.sidebar.public" />
								</span>
							</SidebarMenuButton>
						</SidebarMenuItem>
					)}
				</SidebarMenu>
			</SidebarGroupContent>

			{shareOpen && doc && (
				<ShareDialog doc={doc} open={shareOpen} onOpenChange={setShareOpen} />
			)}
		</>
	)
}
