import { useIsBackedUp } from "@/app/features/auth"
import { useState, useRef } from "react"
import { useLibrary } from "@/app/features/documents"
import { useSpaces, createSpace, type Space } from "../lib/spaces"
import { SpaceAvatarImage } from "./space-avatar"
import { useParams, useNavigate, Link } from "@tanstack/react-router"
import { useIntl, T } from "@/shared/intl/setup"
import { User, Users, Check, Plus, SettingsIcon } from "lucide-react"
import {
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "@/app/components/ui/dropdown-menu"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/app/components/ui/dialog"
import { Button } from "@/app/components/ui/button"
import { Input } from "@/app/components/ui/input"
import { Label } from "@/app/components/ui/label"
import { testIds } from "@/app/lib/test-ids"
import { WorkspaceSelector } from "@/app/components/workspace-selector"
import { tryCatch } from "@/app/lib/try-catch"
import { toast } from "sonner"

export { SpaceSelector, SpaceInitials }

function SpaceSelector() {
	let t = useIntl()
	let isAuthenticated = useIsBackedUp()
	let params = useParams({ strict: false })
	let spaceId = params.spaceId ?? null
	let [dialogOpen, setDialogOpen] = useState(false)

	let spaces = useSpaces().filter(space => space.role)
	let currentSpaceInList = spaces.find(space => space.id === spaceId)
	let currentSpaceFromUrl = useSpaces().find(space => space.id === spaceId)
	let currentSpace = currentSpaceInList ?? currentSpaceFromUrl
	let displayName = currentSpace?.name ?? t("spaces.selector.personal")
	let isInSpace = Boolean(currentSpace)
	let isViewingPublicSpace = currentSpaceFromUrl && !currentSpaceInList

	return (
		<>
			<WorkspaceSelector
				label={displayName}
				icon={
					isInSpace && currentSpace ? (
						<SpaceAvatar space={currentSpace} />
					) : (
						<User />
					)
				}
				triggerTestId={testIds.space.selectorTrigger}
				actions={
					<>
						{currentSpaceInList && (
							<Button
								variant="ghost"
								size="icon"
								data-testid={testIds.space.settingsButton}
								render={
									<Link
										to="/spaces/$spaceId/settings"
										params={{ spaceId: currentSpaceInList.id }}
									/>
								}
							>
								<SettingsIcon />
								<span className="sr-only">
									<T k="spaces.selector.settings" />
								</span>
							</Button>
						)}
					</>
				}
			>
				<DropdownMenuItem render={<Link to="/" search={{ personal: true }} />}>
					<User className="size-4" />
					<span>
						<T k="spaces.selector.personal" />
					</span>
					{!spaceId && <Check className="ml-auto size-4" />}
				</DropdownMenuItem>
				{spaces.map(space => (
					<DropdownMenuItem
						key={space.id}
						data-testid={testIds.space.listItem}
						data-space-id={space.id}
						render={
							<Link to="/spaces/$spaceId" params={{ spaceId: space.id }} />
						}
					>
						<SpaceAvatar space={space} />
						<span>{space.name}</span>
						{spaceId === space.id && <Check className="ml-auto size-4" />}
					</DropdownMenuItem>
				))}
				{isViewingPublicSpace && currentSpaceFromUrl && (
					<>
						<DropdownMenuSeparator />
						<div className="text-muted-foreground px-2 py-1.5 text-xs">
							<T k="spaces.selector.viewingPublic" />
						</div>
						<DropdownMenuItem disabled>
							<Users className="size-4" />
							<span>{currentSpaceFromUrl.name}</span>
							<Check className="ml-auto size-4" />
						</DropdownMenuItem>
					</>
				)}
				{isAuthenticated && (
					<>
						<DropdownMenuSeparator />

						<DropdownMenuItem
							onClick={() => setDialogOpen(true)}
							data-testid={testIds.space.createButton}
						>
							<Plus className="size-4" />
							<span>
								<T k="spaces.selector.newSpace" />
							</span>
						</DropdownMenuItem>
					</>
				)}
			</WorkspaceSelector>
			<CreateSpaceDialog open={dialogOpen} onOpenChange={setDialogOpen} />
		</>
	)
}

function SpaceInitials({
	name,
	size = "sm",
}: {
	name: string
	size?: "sm" | "md"
}) {
	let initials = getInitials(name)
	let sizeClasses = size === "sm" ? "size-4 text-[8px]" : "size-12 text-base"

	return (
		<div
			className={`bg-muted text-muted-foreground flex shrink-0 items-center justify-center rounded font-medium ${sizeClasses}`}
		>
			{initials}
		</div>
	)
}

// --- Helpers ---

function CreateSpaceDialog({
	open,
	onOpenChange,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
}) {
	let { db, ownerId } = useLibrary()
	let t = useIntl()
	let navigate = useNavigate()
	let [name, setName] = useState("")
	let [saving, setSaving] = useState(false)
	let inputRef = useRef<HTMLInputElement>(null)

	function handleOpenChangeComplete(open: boolean) {
		if (!open) setName("")
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault()
		let trimmed = name.trim()
		if (!trimmed || saving) return

		setSaving(true)
		let saved = await tryCatch(createSpace(db, ownerId, trimmed))
		if (!saved.ok) {
			setSaving(false)
			toast.error(t("spaces.create.saveFailed"))
			return
		}
		onOpenChange(false)
		setSaving(false)
		setName("")
		let space = saved.value
		navigate({ to: "/spaces/$spaceId", params: { spaceId: space.id } })
	}

	return (
		<Dialog
			open={open}
			onOpenChange={onOpenChange}
			onOpenChangeComplete={handleOpenChangeComplete}
		>
			<DialogContent data-testid={testIds.space.createDialog}>
				<DialogHeader>
					<DialogTitle>
						<T k="spaces.create.title" />
					</DialogTitle>
					<DialogDescription>
						<T k="spaces.create.description" />
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit}>
					<div className="space-y-2">
						<Label htmlFor="space-name">
							<T k="spaces.create.nameLabel" />
						</Label>
						<Input
							ref={inputRef}
							id="space-name"
							data-testid={testIds.space.createNameInput}
							placeholder={t("spaces.create.namePlaceholder")}
							value={name}
							onChange={e => setName(e.target.value)}
							autoComplete="off"
						/>
					</div>

					<DialogFooter className="mt-4">
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => onOpenChange(false)}
							disabled={saving}
						>
							<T k="spaces.create.cancel" />
						</Button>
						<Button
							type="submit"
							size="sm"
							disabled={!name.trim() || saving}
							data-testid={testIds.space.createSubmit}
						>
							<T k={saving ? "spaces.create.saving" : "spaces.create.submit"} />
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}

function SpaceAvatar({ space }: { space: Space }) {
	return space.avatar ? (
		<SpaceAvatarImage
			space={space}
			className="size-4 shrink-0 rounded object-cover"
		/>
	) : (
		<SpaceInitials name={space.name} size="sm" />
	)
}

function getInitials(name: string): string {
	let words = name.trim().split(/\s+/)
	if (words.length === 0 || words[0] === "") return "?"
	if (words.length === 1) return words[0].charAt(0).toUpperCase()
	return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase()
}
