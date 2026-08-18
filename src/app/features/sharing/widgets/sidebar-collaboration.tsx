import { useState, useEffect } from "react"
import { useCoState, useAccount } from "jazz-tools/react"
import { co, type ResolveQuery } from "jazz-tools"
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
import { ShareDialog } from "./share-dialog"
import { Document, UserAccount } from "@/schema"
import {
	listCollaborators,
	isDocumentPublic,
	getDocumentGroup,
	revokeDocumentInvite,
	type Collaborator,
} from "../lib/document-sharing"
import { testIds } from "@/app/lib/test-ids"
import { useHasFinePointer } from "@/app/hooks/use-fine-pointer"
import { useIntl, T } from "@/shared/intl/setup"

export { SidebarCollaboration }

let docResolve = { content: true } as const satisfies ResolveQuery<
	typeof Document
>

type LoadedDocWithContent = co.loaded<typeof Document, typeof docResolve>

interface SidebarCollaborationProps {
	docId: string
	spaceGroupId?: string
}

function SidebarCollaboration({
	docId,
	spaceGroupId,
}: SidebarCollaborationProps) {
	let t = useIntl()
	let hasFinePointer = useHasFinePointer()
	let [shareOpen, setShareOpen] = useState(false)
	let [collaborators, setCollaborators] = useState<Collaborator[]>([])

	let me = useAccount(UserAccount)
	let doc = useCoState(Document, docId, {
		resolve: docResolve,
	})

	let isPublic = doc?.$isLoaded ? isDocumentPublic(doc) : false
	let currentUserId = me.$isLoaded ? me.$jazz.id : null

	useEffect(() => {
		async function loadCollaborators() {
			if (!doc?.$isLoaded) return
			let result = await listCollaborators(doc, spaceGroupId)
			setCollaborators(result.collaborators)
		}
		loadCollaborators()
	}, [doc, spaceGroupId])

	let otherCollaborators = collaborators.filter(c => c.id !== currentUserId)
	let hasCollaborators = otherCollaborators.length > 0 || isPublic
	let isAdmin = doc?.$isLoaded && getDocumentGroup(doc)?.myRole() === "admin"

	function removeCollaborator(collaborator: Collaborator) {
		if (!doc?.$isLoaded || !isAdmin) return
		revokeDocumentInvite(doc, collaborator.inviteGroupId)
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
								<ContextMenuItem onClick={() => setShareOpen(true)}>
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

			{shareOpen && doc?.$isLoaded && (
				<ShareDialog
					doc={doc as LoadedDocWithContent}
					open={shareOpen}
					onOpenChange={setShareOpen}
				/>
			)}
		</>
	)
}
