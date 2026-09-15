import { Link, useNavigate } from "@tanstack/react-router"
import { co, type ResolveQuery } from "jazz-tools"
import { createImage } from "jazz-tools/media"
import { useCoState, useAccount, Image } from "jazz-tools/react"
import { useState, useEffect, useRef } from "react"
import { ArrowLeft, Loader2, Trash2, Upload, UserRoundPlus } from "lucide-react"
import Cropper from "react-easy-crop"
import { Space, UserAccount } from "@/schema"
import { SpaceShareDialog } from "@/app/features/sharing"
import { Button } from "@/app/components/ui/button"
import { Input } from "@/app/components/ui/input"
import { Badge } from "@/app/components/ui/badge"
import { Empty, EmptyHeader, EmptyTitle } from "@/app/components/ui/empty"
import {
	ConfirmDialog,
	useConfirmDialog,
} from "@/app/components/ui/confirm-dialog"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
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
import { SpaceNotFound, SpaceUnauthorized } from "@/app/components/error-states"
import {
	getSpaceGroup,
	leaveSpace,
	changeSpaceCollaboratorRole,
	revokeSpaceInvite,
	listSpaceMembers,
	isSpaceMember,
	permanentlyDeleteSpace,
	type SpaceMember,
} from "../lib/spaces"
import { SpaceInitials } from "../widgets/space-selector"
import { testIds } from "@/app/lib/test-ids"
import { useIntl } from "@/shared/intl/setup"

export { SpaceSettingsScreen, spaceSettingsResolve }

let spaceSettingsResolve = {
	documents: true,
	avatar: true,
} as const satisfies ResolveQuery<typeof Space>

type LoadedSpace = co.loaded<typeof Space, typeof spaceSettingsResolve>

interface SpaceSettingsScreenProps {
	spaceId: string
	loaderData: {
		space: LoadedSpace | null
		loadingState: string | null
	}
}

function SpaceSettingsScreen({
	spaceId,
	loaderData,
}: SpaceSettingsScreenProps) {
	let space = useCoState(Space, spaceId, { resolve: spaceSettingsResolve })

	if (!loaderData.space) {
		if (loaderData.loadingState === "unauthorized") return <SpaceUnauthorized />
		return <SpaceNotFound />
	}

	if (!space.$isLoaded) {
		return (
			<Empty className="h-screen">
				<EmptyHeader>
					<Loader2 className="text-muted-foreground size-8 animate-spin" />
					<EmptyTitle>Loading space...</EmptyTitle>
				</EmptyHeader>
			</Empty>
		)
	}

	return <SpaceSettingsContent space={space} spaceId={spaceId} />
}

function SpaceSettingsContent({
	space,
	spaceId,
}: {
	space: LoadedSpace
	spaceId: string
}) {
	let t = useIntl()
	let isPublicSpaceViewer = !isSpaceMember(space)

	return (
		<>
			<title>
				{space.name} {t("spaces.settings.title")}
			</title>
			<div
				className="bg-background fixed inset-0 overflow-auto"
				style={{
					paddingTop: "calc(48px + env(safe-area-inset-top))",
					paddingBottom: "env(safe-area-inset-bottom)",
					paddingLeft: "env(safe-area-inset-left)",
					paddingRight: "env(safe-area-inset-right)",
				}}
			>
				<div
					className="bg-background border-border fixed top-0 right-0 left-0 z-10 flex items-center justify-center border-b"
					style={{
						paddingTop: "env(safe-area-inset-top)",
						paddingLeft: "env(safe-area-inset-left)",
						paddingRight: "env(safe-area-inset-right)",
						height: "calc(48px + env(safe-area-inset-top))",
					}}
				>
					<div className="flex w-full max-w-2xl items-center gap-3 px-4">
						<Link to="/spaces/$spaceId" params={{ spaceId }}>
							<Button
								variant="ghost"
								size="icon"
								aria-label={t("spaces.settings.backButton")}
							>
								<ArrowLeft className="size-4" />
							</Button>
						</Link>
						<h1 className="text-foreground text-lg font-semibold">
							{t("spaces.settings.title")}
						</h1>
					</div>
				</div>
				<div className="mx-auto max-w-2xl px-4 py-8">
					{isPublicSpaceViewer ? (
						<PublicSpaceViewerSettings space={space} />
					) : (
						<div className="space-y-8">
							<SpaceNameSection space={space} />
							<SpaceMembersSection space={space} />
							<DangerZoneSection space={space} />
						</div>
					)}
				</div>
			</div>
		</>
	)
}

function PublicSpaceViewerSettings({ space }: { space: LoadedSpace }) {
	let t = useIntl()
	let navigate = useNavigate()
	let me = useAccount(UserAccount, { resolve: { root: { spaces: true } } })
	let leaveDialog = useConfirmDialog()

	function handleLeave() {
		if (!me.$isLoaded || !me.root?.spaces?.$isLoaded) return
		let idx = me.root.spaces.findIndex(s => s?.$jazz.id === space.$jazz.id)
		if (idx !== -1) {
			me.root.spaces.$jazz.splice(idx, 1)
		}
		navigate({ to: "/" })
	}

	return (
		<section>
			<div className="bg-muted/30 mb-6 rounded-lg p-4">
				<div className="text-muted-foreground text-sm">
					{t("spaces.settings.viewingInfo")}
				</div>
			</div>
			<div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30">
				<div>
					<div className="text-sm font-medium">
						{t("spaces.settings.leaveTitle")}
					</div>
					<div className="text-muted-foreground text-xs">
						{t("spaces.settings.leaveDescription")}
					</div>
				</div>
				<Button
					variant="outline"
					size="sm"
					onClick={() => leaveDialog.setOpen(true)}
				>
					{t("spaces.settings.leaveButton")}
				</Button>
			</div>
			<ConfirmDialog
				open={leaveDialog.open}
				onOpenChange={leaveDialog.onOpenChange}
				title={t("spaces.settings.leaveConfirmTitle")}
				description={t("spaces.settings.leaveConfirmDescription", {
					spaceName: space.name,
				})}
				confirmLabel={t("spaces.settings.leaveButton")}
				variant="destructive"
				onConfirm={handleLeave}
			/>
		</section>
	)
}

function SpaceNameSection({ space }: { space: LoadedSpace }) {
	let t = useIntl()
	let spaceGroup = getSpaceGroup(space)
	let isAdmin = spaceGroup?.myRole() === "admin"

	function handleNameChange(e: React.ChangeEvent<HTMLInputElement>) {
		let newName = e.target.value
		space.$jazz.set("name", newName)
		space.$jazz.set("updatedAt", new Date())
	}

	return (
		<section>
			<h2 className="text-muted-foreground mb-3 text-sm font-medium">
				{t("spaces.settings.general")}
			</h2>
			<div className="bg-muted/30 space-y-4 rounded-lg p-4">
				<div>
					<div className="text-muted-foreground mb-1 text-xs">
						{t("spaces.settings.spaceName")}
					</div>
					<Input
						value={space.name}
						onChange={handleNameChange}
						disabled={!isAdmin}
						className="text-lg font-medium"
						data-testid={testIds.space.settingsNameInput}
					/>
				</div>
				<SpaceAvatarUpload space={space} isAdmin={isAdmin} />
			</div>
		</section>
	)
}

function SpaceAvatarUpload({
	space,
	isAdmin,
}: {
	space: LoadedSpace
	isAdmin: boolean
}) {
	let t = useIntl()
	let fileInputRef = useRef<HTMLInputElement>(null)
	let [isUploading, setIsUploading] = useState(false)
	let [cropperOpen, setCropperOpen] = useState(false)
	let [selectedImage, setSelectedImage] = useState<string | null>(null)
	let removeDialog = useConfirmDialog()

	function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
		let file = e.target.files?.[0]
		if (!file) return

		let reader = new FileReader()
		reader.onloadend = () => {
			setSelectedImage(reader.result as string)
			setCropperOpen(true)
		}
		reader.readAsDataURL(file)

		if (fileInputRef.current) {
			fileInputRef.current.value = ""
		}
	}

	async function handleCropComplete(croppedFile: File) {
		setIsUploading(true)
		try {
			let image = await createImage(croppedFile, {
				owner: space.$jazz.owner,
				maxSize: 512,
			})
			space.$jazz.set("avatar", image)
			space.$jazz.set("updatedAt", new Date())
		} finally {
			setIsUploading(false)
			setSelectedImage(null)
		}
	}

	function handleRemoveAvatar() {
		space.$jazz.set("avatar", undefined)
		space.$jazz.set("updatedAt", new Date())
	}

	let avatarId = space.avatar?.$jazz.id

	return (
		<div>
			<div className="text-muted-foreground mb-1 text-xs">
				{t("spaces.settings.avatar")}
			</div>
			<div className="flex items-center gap-3">
				<div className="flex size-12 items-center justify-center overflow-hidden rounded-lg">
					{avatarId ? (
						<Image
							imageId={avatarId}
							width={48}
							height={48}
							alt={space.name}
							className="size-full object-cover"
						/>
					) : (
						<SpaceInitials name={space.name} size="md" />
					)}
				</div>
				<Button
					variant="outline"
					size="sm"
					disabled={!isAdmin || isUploading}
					onClick={() => fileInputRef.current?.click()}
				>
					{isUploading ? (
						<>
							<Loader2 className="mr-2 size-4 animate-spin" />
							{t("spaces.settings.avatarUploading")}
						</>
					) : (
						<>
							<Upload className="mr-2 size-4" />
							{avatarId
								? t("spaces.settings.avatarUploadChange")
								: t("spaces.settings.avatarUploadNew")}
						</>
					)}
				</Button>
				{avatarId && (
					<Button
						variant="outline"
						size="sm"
						disabled={!isAdmin || isUploading}
						onClick={() => removeDialog.setOpen(true)}
					>
						<Trash2 className="mr-2 size-4" />
						{t("spaces.settings.avatarRemove")}
					</Button>
				)}
				<input
					ref={fileInputRef}
					type="file"
					accept="image/*"
					className="hidden"
					onChange={handleFileSelect}
				/>
			</div>
			<AvatarCropperDialog
				open={cropperOpen}
				onOpenChange={setCropperOpen}
				imageSrc={selectedImage}
				onCrop={handleCropComplete}
			/>
			<ConfirmDialog
				open={removeDialog.open}
				onOpenChange={removeDialog.onOpenChange}
				title={t("spaces.settings.avatarRemoveConfirmTitle")}
				description={t("spaces.settings.avatarRemoveConfirmDescription")}
				confirmLabel={t("spaces.settings.avatarRemove")}
				variant="destructive"
				onConfirm={handleRemoveAvatar}
			/>
		</div>
	)
}

function AvatarCropperDialog({
	open,
	onOpenChange,
	imageSrc,
	onCrop,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	imageSrc: string | null
	onCrop: (croppedFile: File) => void
}) {
	let t = useIntl()
	let [crop, setCrop] = useState({ x: 0, y: 0 })
	let [zoom, setZoom] = useState(1)
	let [croppedAreaPixels, setCroppedAreaPixels] = useState<{
		x: number
		y: number
		width: number
		height: number
	} | null>(null)

	function handleCropComplete(
		_: unknown,
		croppedAreaPixels: { x: number; y: number; width: number; height: number },
	) {
		setCroppedAreaPixels(croppedAreaPixels)
	}

	async function handleConfirm() {
		if (!imageSrc || !croppedAreaPixels) return

		try {
			let file = await getCroppedImg(imageSrc, croppedAreaPixels, "avatar.jpg")
			onCrop(file)
			onOpenChange(false)
		} catch (e) {
			console.error("Error cropping image:", e)
		}
	}

	function handleOpenChangeComplete(nextOpen: boolean) {
		if (!nextOpen) {
			setCrop({ x: 0, y: 0 })
			setZoom(1)
			setCroppedAreaPixels(null)
		}
	}

	if (!imageSrc) return null

	return (
		<Dialog
			open={open}
			onOpenChange={onOpenChange}
			onOpenChangeComplete={handleOpenChangeComplete}
		>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>{t("spaces.settings.avatarCropTitle")}</DialogTitle>
					<DialogDescription>
						{t("spaces.settings.avatarCropDescription")}
					</DialogDescription>
				</DialogHeader>
				<div className="relative h-64 w-full">
					<Cropper
						image={imageSrc}
						crop={crop}
						zoom={zoom}
						aspect={1}
						onCropChange={setCrop}
						onCropComplete={handleCropComplete}
						onZoomChange={setZoom}
					/>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						{t("spaces.settings.avatarCropCancel")}
					</Button>
					<Button onClick={handleConfirm}>
						{t("spaces.settings.avatarCropSave")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

async function getCroppedImg(
	imageSrc: string,
	pixelCrop: { x: number; y: number; width: number; height: number },
	fileName: string,
): Promise<File> {
	let image = new window.Image()
	let canvas = document.createElement("canvas")
	let ctx = canvas.getContext("2d")

	if (!ctx) {
		throw new Error("No 2d context")
	}

	return new Promise((resolve, reject) => {
		image.onload = () => {
			canvas.width = pixelCrop.width
			canvas.height = pixelCrop.height

			ctx.drawImage(
				image,
				pixelCrop.x,
				pixelCrop.y,
				pixelCrop.width,
				pixelCrop.height,
				0,
				0,
				pixelCrop.width,
				pixelCrop.height,
			)

			canvas.toBlob(
				blob => {
					if (!blob) {
						reject(new Error("Canvas is empty"))
						return
					}
					let file = new File([blob], fileName, { type: "image/jpeg" })
					resolve(file)
				},
				"image/jpeg",
				0.95,
			)
		}
		image.onerror = reject
		image.src = imageSrc
	})
}

function SpaceMembersSection({ space }: { space: LoadedSpace }) {
	let t = useIntl()
	let me = useAccount(UserAccount)
	let spaceGroup = getSpaceGroup(space)
	let myRole = spaceGroup?.myRole()
	let canEditMembers = myRole === "admin" || myRole === "manager"
	let [members, setMembers] = useState<SpaceMember[]>([])
	let [shareOpen, setShareOpen] = useState(false)
	let [editMember, setEditMember] = useState<SpaceMember | null>(null)

	let loadMembersRef = useRef(async () => {
		let loaded = await listSpaceMembers(space)
		setMembers(loaded)
	})

	useEffect(() => {
		loadMembersRef.current = async () => {
			let loaded = await listSpaceMembers(space)
			setMembers(loaded)
		}
	})

	useEffect(() => {
		loadMembersRef.current()
	}, [spaceGroup])

	if (!spaceGroup) return null

	let adminCount =
		spaceGroup?.members.filter(m => m.role === "admin").length ?? 0

	function handleEditMember(member: SpaceMember) {
		if (!canEditMembers) return
		if (member.role === "admin" && member.id !== me?.$jazz.id) return
		if (
			member.id === me?.$jazz.id &&
			member.role === "admin" &&
			adminCount <= 1
		)
			return
		setEditMember(member)
	}

	return (
		<section>
			<div className="mb-3 flex items-center justify-between">
				<h2 className="text-muted-foreground text-sm font-medium">
					{t("spaces.members.title")}
				</h2>
				{myRole === "admin" && (
					<Button
						variant="outline"
						size="sm"
						onClick={() => setShareOpen(true)}
						data-testid={testIds.space.inviteButton}
					>
						<UserRoundPlus />
						{t("spaces.members.invite")}
					</Button>
				)}
			</div>
			<div className="bg-muted/30 rounded-lg p-4">
				{members.length > 0 ? (
					<ul className="space-y-2">
						{members.map(member => {
							let isMe = member.id === me?.$jazz.id
							let isOtherAdmin = member.role === "admin" && !isMe
							let isLastAdmin =
								isMe && member.role === "admin" && adminCount <= 1
							let isEditable = canEditMembers && !isOtherAdmin && !isLastAdmin
							return (
								<li
									key={member.id}
									className="flex items-center justify-between py-1"
								>
									<span className="flex items-center gap-2 text-sm">
										{member.name}
										{isMe && (
											<Badge variant="secondary">
												{t("spaces.members.youBadge")}
											</Badge>
										)}
									</span>
									<span className="flex items-center gap-2">
										{isEditable && (
											<Button
												variant="outline"
												size="sm"
												onClick={() => handleEditMember(member)}
											>
												{t("spaces.members.editButton")}
											</Button>
										)}
										<span className="text-muted-foreground w-14 text-right text-xs">
											{getRoleLabel(t, member.role)}
										</span>
									</span>
								</li>
							)
						})}
					</ul>
				) : (
					<p className="text-muted-foreground text-sm">
						{t("spaces.members.loading")}
					</p>
				)}
			</div>
			<SpaceShareDialog
				space={space}
				open={shareOpen}
				onOpenChange={setShareOpen}
			/>
			<MemberEditDialog
				space={space}
				member={editMember}
				onOpenChange={open => !open && setEditMember(null)}
				onMemberUpdated={() => loadMembersRef.current()}
			/>
		</section>
	)
}

function MemberEditDialog({
	space,
	member,
	onOpenChange,
	onMemberUpdated,
}: {
	space: LoadedSpace
	member: SpaceMember | null
	onOpenChange: (open: boolean) => void
	onMemberUpdated: () => void
}) {
	let t = useIntl()
	let [role, setRole] = useState<string>(member?.role ?? "reader")
	let [loading, setLoading] = useState(false)

	useEffect(() => {
		if (member) setRole(member.role)
	}, [member])

	async function handleSave() {
		if (!member?.inviteGroupId) return
		if (role === member.role) {
			onOpenChange(false)
			return
		}
		setLoading(true)
		try {
			await changeSpaceCollaboratorRole(
				space,
				member.inviteGroupId,
				role as "admin" | "manager" | "writer" | "reader",
			)
			onMemberUpdated()
			onOpenChange(false)
		} catch (e) {
			console.error("Failed to change role:", e)
		} finally {
			setLoading(false)
		}
	}

	async function handleRemove() {
		if (!member?.inviteGroupId) return
		setLoading(true)
		try {
			revokeSpaceInvite(space, member.inviteGroupId)
			onMemberUpdated()
			onOpenChange(false)
		} finally {
			setLoading(false)
		}
	}

	return (
		<Dialog open={!!member} onOpenChange={onOpenChange}>
			<DialogContent showCloseButton={false}>
				<DialogHeader>
					<DialogTitle>{t("spaces.members.editDialogTitle")}</DialogTitle>
					<DialogDescription>
						{t("spaces.members.editDialogDescription", {
							memberName: member?.name ?? "",
						})}
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4 py-2">
					<div>
						<div className="text-muted-foreground mb-1 text-xs">
							{t("spaces.members.roleLabel")}
						</div>
						<Select value={role} onValueChange={v => v && setRole(v)}>
							<SelectTrigger className="w-full">
								<SelectValue>{getRoleLabel(t, role)}</SelectValue>
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="admin">{t("spaces.role.admin")}</SelectItem>
								<SelectItem value="manager">
									{t("spaces.role.manager")}
								</SelectItem>
								<SelectItem value="writer">
									{t("spaces.role.writer")}
								</SelectItem>
								<SelectItem value="reader">
									{t("spaces.role.reader")}
								</SelectItem>
							</SelectContent>
						</Select>
					</div>
				</div>
				<DialogFooter className="flex-col gap-2 sm:flex-row">
					<Button
						variant="destructive"
						onClick={handleRemove}
						disabled={loading}
						className="sm:mr-auto"
					>
						{t("spaces.members.removeButton")}
					</Button>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						{t("spaces.members.editCancel")}
					</Button>
					<Button onClick={handleSave} disabled={loading}>
						{t("spaces.members.editSave")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

function getRoleLabel(t: ReturnType<typeof useIntl>, role: string): string {
	switch (role) {
		case "admin":
			return t("spaces.role.admin")
		case "manager":
			return t("spaces.role.manager")
		case "writer":
			return t("spaces.role.writer")
		case "reader":
			return t("spaces.role.reader")
		default:
			return role
	}
}

function DangerZoneSection({ space }: { space: LoadedSpace }) {
	let t = useIntl()
	let navigate = useNavigate()
	let me = useAccount(UserAccount)
	let spaceGroup = getSpaceGroup(space)
	let myRole = spaceGroup?.myRole()
	let isAdmin = myRole === "admin"

	let adminCount =
		spaceGroup?.members.filter(m => m.role === "admin").length ?? 0
	let isLastAdmin = isAdmin && adminCount === 1
	let canLeave = !isLastAdmin
	let canDelete = isLastAdmin

	let leaveDialog = useConfirmDialog()
	let [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
	let [loading, setLoading] = useState(false)

	async function handleLeave() {
		if (!me?.$isLoaded) return
		setLoading(true)
		try {
			await leaveSpace(space, me)
			navigate({ to: "/" })
		} finally {
			setLoading(false)
		}
	}

	async function handleDelete() {
		if (!me?.$isLoaded) return
		try {
			await permanentlyDeleteSpace(space, me)
			navigate({ to: "/" })
		} catch (e) {
			console.error("Failed to delete space:", e)
		}
	}

	return (
		<section>
			<h2 className="text-muted-foreground mb-3 text-sm font-medium">
				{t("spaces.dangerZone.title")}
			</h2>
			<div className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30">
				{canLeave && (
					<div className="flex items-center justify-between">
						<div>
							<div className="text-sm font-medium">
								{t("spaces.dangerZone.leaveTitle")}
							</div>
							<div className="text-muted-foreground text-xs">
								{t("spaces.dangerZone.leaveDescription")}
							</div>
						</div>
						<Button
							variant="outline"
							size="sm"
							onClick={() => leaveDialog.setOpen(true)}
							disabled={loading}
						>
							{t("spaces.settings.leaveButton")}
						</Button>
					</div>
				)}
				{isAdmin && (
					<div className="flex items-center justify-between">
						<div>
							<div className="text-sm font-medium">
								{t("spaces.dangerZone.deleteTitle")}
							</div>
							<div className="text-muted-foreground text-xs">
								{canDelete
									? t("spaces.dangerZone.deleteDescriptionCanDelete")
									: t("spaces.dangerZone.deleteDescriptionCannotDelete")}
							</div>
						</div>
						<Button
							variant="destructive"
							size="sm"
							disabled={!canDelete}
							onClick={() => setDeleteDialogOpen(true)}
							data-testid={testIds.space.dangerDeleteButton}
						>
							{t("spaces.dangerZone.deleteButton")}
						</Button>
					</div>
				)}
			</div>
			<ConfirmDialog
				open={leaveDialog.open}
				onOpenChange={leaveDialog.onOpenChange}
				title={t("spaces.dangerZone.leaveConfirmTitle")}
				description={t("spaces.dangerZone.leaveConfirmDescription", {
					spaceName: space.name,
				})}
				confirmLabel={t("spaces.settings.leaveButton")}
				variant="destructive"
				onConfirm={handleLeave}
			/>
			<PermanentDeleteSpaceDialog
				open={deleteDialogOpen}
				onOpenChange={setDeleteDialogOpen}
				spaceName={space.name}
				onConfirm={handleDelete}
			/>
		</section>
	)
}

function PermanentDeleteSpaceDialog({
	open,
	onOpenChange,
	spaceName,
	onConfirm,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	spaceName: string
	onConfirm: () => void
}) {
	let t = useIntl()
	let confirmPhrase = t("spaces.dangerZone.deleteConfirmPhrase")
	let [nameInput, setNameInput] = useState("")
	let [confirmInput, setConfirmInput] = useState("")

	let nameMatches = nameInput === spaceName
	let confirmMatches = confirmInput.toLowerCase() === confirmPhrase
	let canDelete = nameMatches && confirmMatches

	function handleOpenChangeComplete(nextOpen: boolean) {
		if (!nextOpen) {
			setNameInput("")
			setConfirmInput("")
		}
	}

	function handleConfirm() {
		if (!canDelete) return
		onConfirm()
		onOpenChange(false)
	}

	return (
		<Dialog
			open={open}
			onOpenChange={onOpenChange}
			onOpenChangeComplete={handleOpenChangeComplete}
		>
			<DialogContent showCloseButton={false}>
				<DialogHeader>
					<DialogTitle>{t("spaces.dangerZone.deleteConfirmTitle")}</DialogTitle>
					<DialogDescription>
						{t("spaces.dangerZone.deleteConfirmDescription")}
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4 py-2">
					<div>
						<label className="text-muted-foreground mb-1 block text-xs">
							{t("spaces.dangerZone.deleteConfirmNamePrompt")}{" "}
							<span className="text-foreground font-medium">{spaceName}</span>
						</label>
						<Input
							value={nameInput}
							onChange={e => setNameInput(e.target.value)}
							placeholder={spaceName}
							autoComplete="off"
							data-testid={testIds.space.dangerDeleteNameInput}
						/>
					</div>
					<div>
						<label className="text-muted-foreground mb-1 block text-xs">
							{t("spaces.dangerZone.deleteConfirmPhrasePrompt", {
								phrase: confirmPhrase,
							})}
						</label>
						<Input
							value={confirmInput}
							onChange={e => setConfirmInput(e.target.value)}
							placeholder={confirmPhrase}
							autoComplete="off"
							data-testid={testIds.space.dangerDeletePhraseInput}
						/>
					</div>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						{t("spaces.dangerZone.deleteConfirmCancel")}
					</Button>
					<Button
						variant="destructive"
						onClick={handleConfirm}
						disabled={!canDelete}
						data-testid={testIds.space.dangerDeleteConfirmButton}
					>
						{t("spaces.dangerZone.deleteConfirmSubmit")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
