import { useState, useRef } from "react"
import { co, type ResolveQuery } from "jazz-tools"
import {
	useAccount,
	useCoState,
	useIsAuthenticated,
	Image,
} from "jazz-tools/react"
import { useParams, useNavigate, Link } from "@tanstack/react-router"
import { useIntl, T } from "@/shared/intl/setup"
import { User, Users, Check, Plus, SettingsIcon, UserPlus } from "lucide-react"
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
import { UserAccount, Space, createSpace } from "@/schema"
import { getSpaceGroup } from "../lib/spaces"
import { testIds } from "@/app/lib/test-ids"
import { WorkspaceSelector } from "@/app/components/workspace-selector"
import { waitForLocalJazzStorage } from "@/app/lib/local-jazz-poke"
import { tryCatch } from "@/app/lib/try-catch"
import { toast } from "sonner"

export { SpaceSelector, SpaceInitials }

let spacesQuery = { root: { spaces: { $each: { avatar: true } } } } as const
type LoadedSpaces = co.loaded<typeof UserAccount, typeof spacesQuery>

let currentSpaceQuery = { avatar: true } as const satisfies ResolveQuery<
	typeof Space
>

function SpaceSelector() {
	let t = useIntl()
	let me = useAccount(UserAccount, { resolve: spacesQuery })
	let isAuthenticated = useIsAuthenticated()
	let navigate = useNavigate()
	let params = useParams({ strict: false })
	let spaceId = params.spaceId ?? null
	let [dialogOpen, setDialogOpen] = useState(false)

	// Load current space directly (for public spaces not in user's list)
	let currentSpaceFromUrl = useCoState(Space, spaceId ?? undefined, {
		resolve: currentSpaceQuery,
	})

	let spaces = me?.$isLoaded ? getSortedSpaces(me.root.spaces) : []
	let currentSpaceInList = spaceId
		? spaces.find(s => s.$jazz.id === spaceId)
		: null

	// Use current space from list if available, otherwise from URL (for public spaces)
	let currentSpace = currentSpaceInList ?? currentSpaceFromUrl
	let displayName = currentSpace?.$isLoaded
		? currentSpace.name
		: t("spaces.selector.personal")
	let isInSpace = currentSpace?.$isLoaded

	// Check if current space is not in user's list (public space they're viewing)
	let isViewingPublicSpace =
		spaceId && currentSpaceFromUrl?.$isLoaded && !currentSpaceInList

	// Check if user can add this space to their list
	let spaceGroup = currentSpaceFromUrl?.$isLoaded
		? getSpaceGroup(currentSpaceFromUrl)
		: null
	let canAddToSpaces =
		isViewingPublicSpace && isAuthenticated && spaceGroup?.myRole()

	return (
		<>
			<WorkspaceSelector
				label={displayName}
				icon={
					isInSpace && currentSpace.$isLoaded ? (
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
										params={{ spaceId: currentSpaceInList.$jazz.id }}
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
				<DropdownMenuItem
					onClick={() => navigate({ to: "/", search: { personal: true } })}
				>
					<User className="size-4" />
					<span>
						<T k="spaces.selector.personal" />
					</span>
					{!spaceId && <Check className="ml-auto size-4" />}
				</DropdownMenuItem>
				{spaces.map(space => (
					<DropdownMenuItem
						key={space.$jazz.id}
						data-testid={testIds.space.listItem}
						data-space-id={space.$jazz.id}
						render={
							<Link
								to="/spaces/$spaceId"
								params={{ spaceId: space.$jazz.id }}
							/>
						}
					>
						<SpaceAvatar space={space} />
						<span>{space.name}</span>
						{spaceId === space.$jazz.id && <Check className="ml-auto size-4" />}
					</DropdownMenuItem>
				))}
				{isViewingPublicSpace && currentSpaceFromUrl?.$isLoaded && (
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
						{canAddToSpaces && (
							<AddToSpacesMenuItem space={currentSpaceFromUrl!} me={me} />
						)}
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
			<CreateSpaceDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				me={me}
			/>
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

type MaybeLoadedSpace = ReturnType<
	typeof useCoState<typeof Space, typeof currentSpaceQuery>
>

function AddToSpacesMenuItem({
	space,
	me,
}: {
	space: MaybeLoadedSpace
	me: ReturnType<typeof useAccount<typeof UserAccount, typeof spacesQuery>>
}) {
	async function handleAddToSpaces() {
		if (!me.$isLoaded || !me.root?.spaces?.$isLoaded || !space?.$isLoaded)
			return
		// Check if already in list
		let alreadyHas = me.root.spaces.some(s => s?.$jazz.id === space.$jazz.id)
		if (!alreadyHas) {
			me.root.spaces.$jazz.push(space)
		}
	}

	return (
		<DropdownMenuItem onClick={handleAddToSpaces}>
			<UserPlus className="size-4" />
			<span>
				<T k="spaces.selector.addToMySpaces" />
			</span>
		</DropdownMenuItem>
	)
}

function CreateSpaceDialog({
	open,
	onOpenChange,
	me,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	me: ReturnType<typeof useAccount<typeof UserAccount, typeof spacesQuery>>
}) {
	let t = useIntl()
	let navigate = useNavigate()
	let [name, setName] = useState("")
	let [saving, setSaving] = useState(false)
	let inputRef = useRef<HTMLInputElement>(null)
	let pendingSpace = useRef<ReturnType<typeof createSpace> | null>(null)

	function handleOpenChangeComplete(open: boolean) {
		if (!open) setName("")
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault()
		let trimmed = name.trim()
		if (!trimmed || saving || !me.$isLoaded || !me.root) return

		setSaving(true)
		let space = pendingSpace.current ?? createSpace(trimmed, me.root)
		pendingSpace.current = space
		if (space.name !== trimmed) space.$jazz.set("name", trimmed)
		let saved = await tryCatch(waitForLocalJazzStorage(me))
		if (!saved.ok) {
			setSaving(false)
			toast.error(t("spaces.create.saveFailed"))
			return
		}
		onOpenChange(false)
		setSaving(false)
		setName("")
		pendingSpace.current = null
		navigate({ to: "/spaces/$spaceId", params: { spaceId: space.$jazz.id } })
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

type LoadedSpaceWithAvatar = NonNullable<
	NonNullable<LoadedSpaces["root"]["spaces"]>[number]
>

function getSortedSpaces(
	spaces: LoadedSpaces["root"]["spaces"],
): LoadedSpaceWithAvatar[] {
	if (!spaces) return []

	return Array.from(spaces)
		.filter((s): s is LoadedSpaceWithAvatar => s != null && s.$isLoaded)
		.sort((a, b) => a.name.localeCompare(b.name))
}

function SpaceAvatar({ space }: { space: LoadedSpaceWithAvatar }) {
	let avatarId = space.avatar?.$jazz.id

	if (avatarId) {
		return (
			<Image
				imageId={avatarId}
				width={16}
				height={16}
				alt={space.name}
				className="size-4 shrink-0 rounded object-cover"
			/>
		)
	}

	return <SpaceInitials name={space.name} size="sm" />
}

function getInitials(name: string): string {
	let words = name.trim().split(/\s+/)
	if (words.length === 0 || words[0] === "") return "?"
	if (words.length === 1) return words[0].charAt(0).toUpperCase()
	return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase()
}
