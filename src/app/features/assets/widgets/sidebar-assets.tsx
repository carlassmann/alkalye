import { useRef, useState, useEffect, type ReactNode } from "react"
import { useForm } from "@tanstack/react-form"
import { z } from "zod"
import { Image as JazzImage } from "jazz-tools/react"
import { toast } from "sonner"
import {
	SidebarGroupLabel,
	SidebarGroupContent,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@/app/components/ui/sidebar"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu"
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/app/components/ui/context-menu"
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/app/components/ui/tooltip"
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/app/components/ui/dialog"
import { ConfirmDialog } from "@/app/components/ui/confirm-dialog"
import { Field, FieldError, FieldLabel } from "@/app/components/ui/field"
import { Input } from "@/app/components/ui/input"
import { Button } from "@/app/components/ui/button"
import {
	UploadProgressDialog,
	type UploadPhase,
} from "@/app/features/import-export"
import {
	Image as ImageIcon,
	Pencil,
	Trash2,
	Plus,
	Download,
	Upload,
	Film,
	VolumeX,
	Volume2,
	PenTool,
} from "lucide-react"
import { useIntl, T } from "@/shared/intl/setup"
import { useResolvedTheme } from "@/app/components/appearance"
import { useHasFinePointer } from "@/app/hooks/use-fine-pointer"
import type { SidebarAsset } from "../lib/asset-view-models"

export { SidebarAssets }
export type { SidebarAsset }

interface VideoUploadState {
	fileName: string
	phase: UploadPhase
	progress: number
	abortController: AbortController
}

interface AssetAction {
	id: string
	label: string
	icon: ReactNode
	onClick: () => void
	destructive?: boolean
}

interface SidebarAssetsProps {
	assets: SidebarAsset[]
	readOnly?: boolean
	onUploadImages?: (files: FileList) => void
	onUploadVideo?: (
		file: File,
		options: {
			onProgress: (p: { phase: UploadPhase; progress: number }) => void
			signal: AbortSignal
		},
	) => Promise<void>
	onRename?: (assetId: string, newName: string) => void
	onDelete?: (assetId: string) => void
	onDownload?: (assetId: string, name: string) => void
	onInsert?: (assetId: string, name: string) => void
	onToggleMute?: (assetId: string) => void
	onImportTldraw?: (file: File) => void
	onCreateTldraw?: () => void
	onEditTldraw?: (assetId: string) => void
	isAssetUsed?: (assetId: string) => boolean
	canUploadVideo?: boolean
}

function SidebarAssets({
	assets,
	readOnly,
	onUploadImages,
	onUploadVideo,
	onRename,
	onDelete,
	onDownload,
	onInsert,
	onToggleMute,
	onCreateTldraw,
	onImportTldraw,
	onEditTldraw,
	isAssetUsed,
	canUploadVideo,
}: SidebarAssetsProps) {
	let t = useIntl()
	let colorScheme = useResolvedTheme()
	let { isMobile } = useSidebar()
	let hasFinePointer = useHasFinePointer()
	let fileInputRef = useRef<HTMLInputElement>(null)
	let [renameOpen, setRenameOpen] = useState(false)
	let [renamingAsset, setRenamingAsset] = useState<SidebarAsset | null>(null)
	let [deleteOpen, setDeleteOpen] = useState(false)
	let [deletingAssetId, setDeletingAssetId] = useState<string | null>(null)
	let [isDragging, setIsDragging] = useState(false)
	let [videoUpload, setVideoUpload] = useState<VideoUploadState | null>(null)

	async function handleDrop(e: React.DragEvent) {
		e.preventDefault()
		setIsDragging(false)
		if (readOnly) return

		let files = Array.from(e.dataTransfer.files)
		await handleFiles(files)
	}

	async function handleFiles(files: File[]) {
		let tldrawFiles = files.filter(file =>
			file.name.toLowerCase().endsWith(".tldr"),
		)
		let imageFiles = files.filter(f => f.type.startsWith("image/"))
		let videoFiles = files.filter(f => f.type.startsWith("video/"))

		if (tldrawFiles[0]) onImportTldraw?.(tldrawFiles[0])
		if (tldrawFiles.length > 1) {
			toast.info(t("assets.importOneWhiteboard"))
		}

		if (imageFiles.length > 0 && onUploadImages) {
			let dt = new DataTransfer()
			imageFiles.forEach(f => dt.items.add(f))
			onUploadImages(dt.files)
		}

		for (let file of videoFiles) {
			if (!onUploadVideo) continue
			let abortController = new AbortController()
			setVideoUpload({
				fileName: file.name,
				phase: "compressing",
				progress: 0,
				abortController,
			})
			try {
				await onUploadVideo(file, {
					onProgress: p =>
						setVideoUpload(prev =>
							prev ? { ...prev, phase: p.phase, progress: p.progress } : null,
						),
					signal: abortController.signal,
				})
			} catch (err) {
				console.error("Video upload failed:", err)
			} finally {
				setVideoUpload(null)
			}
		}
	}

	function createTldraw() {
		onCreateTldraw?.()
	}

	function handleCancelUpload() {
		videoUpload?.abortController.abort()
		setVideoUpload(null)
	}

	function handleRename(asset: SidebarAsset) {
		setRenamingAsset(asset)
		setRenameOpen(true)
	}

	function handleSaveRename(newName: string) {
		if (renamingAsset && onRename) {
			onRename(renamingAsset.id, newName)
		}
		setRenameOpen(false)
		setRenamingAsset(null)
	}

	function handleDeleteClick(assetId: string) {
		if (isAssetUsed?.(assetId)) {
			setDeletingAssetId(assetId)
			setDeleteOpen(true)
		} else {
			onDelete?.(assetId)
		}
	}

	function handleConfirmDelete() {
		if (deletingAssetId) {
			onDelete?.(deletingAssetId)
			setDeletingAssetId(null)
		}
	}

	function getAssetActions(asset: SidebarAsset): AssetAction[] {
		let actions: AssetAction[] = []

		if (asset.type === "tldraw" && onEditTldraw) {
			actions.push({
				id: "edit-whiteboard",
				label: t("assets.editWhiteboard"),
				icon: <PenTool />,
				onClick: () => onEditTldraw(asset.id),
			})
		}
		if (onInsert) {
			actions.push({
				id: "insert",
				label: t("assets.insert"),
				icon: <Plus />,
				onClick: () => onInsert(asset.id, asset.name),
			})
		}
		if (onDownload) {
			actions.push({
				id: "download",
				label: t("assets.download"),
				icon: <Download />,
				onClick: () => onDownload(asset.id, asset.name),
			})
		}
		if (onRename) {
			actions.push({
				id: "rename",
				label: t("assets.rename"),
				icon: <Pencil />,
				onClick: () => handleRename(asset),
			})
		}
		if (asset.type === "video" && onToggleMute) {
			actions.push({
				id: "toggle-mute",
				label: asset.muteAudio
					? t("assets.unmuteAudio")
					: t("assets.muteAudio"),
				icon: asset.muteAudio ? <Volume2 /> : <VolumeX />,
				onClick: () => onToggleMute(asset.id),
			})
		}
		if (onDelete) {
			actions.push({
				id: "delete",
				label: t("assets.delete"),
				icon: <Trash2 />,
				onClick: () => handleDeleteClick(asset.id),
				destructive: true,
			})
		}

		return actions
	}

	return (
		<div
			className="relative flex flex-1 flex-col"
			onDragOver={e => {
				e.preventDefault()
				if (!readOnly) setIsDragging(true)
			}}
			onDragLeave={e => {
				e.preventDefault()
				if (!e.currentTarget.contains(e.relatedTarget as Node))
					setIsDragging(false)
			}}
			onDrop={handleDrop}
		>
			{isDragging && (
				<div className="bg-background/90 absolute inset-0 z-50 flex items-center justify-center backdrop-blur-sm">
					<div className="text-center">
						<Upload className="text-primary mx-auto mb-2 size-8" />
						<p className="text-sm font-medium">
							<T k="assets.dropMediaHere" />
						</p>
					</div>
				</div>
			)}
			<SidebarGroupLabel className="flex items-center justify-between pr-2">
				<span>
					<T k="assets.title" />
				</span>
				<DropdownMenu>
					<Tooltip>
						<DropdownMenuTrigger
							disabled={readOnly}
							render={
								<TooltipTrigger
									render={
										<button
											disabled={readOnly}
											aria-label={t("assets.addAsset")}
											className="text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent flex size-8 touch-manipulation items-center justify-center rounded disabled:pointer-events-none disabled:opacity-50"
										>
											<Plus className="size-4" />
										</button>
									}
								/>
							}
						/>
						<TooltipContent>
							<T k="assets.addAsset" />
						</TooltipContent>
					</Tooltip>
					<DropdownMenuContent align="end">
						{onCreateTldraw && (
							<DropdownMenuItem onClick={createTldraw}>
								<PenTool className="size-4" />
								{t("assets.newWhiteboard")}
							</DropdownMenuItem>
						)}
						<DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
							<Upload className="size-4" />
							{t("assets.uploadOrImport")}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarGroupLabel>
			<input
				ref={fileInputRef}
				type="file"
				accept={canUploadVideo ? "image/*,video/*,.tldr" : "image/*,.tldr"}
				multiple
				className="hidden"
				onChange={e => {
					if (e.target.files) {
						handleFiles(Array.from(e.target.files))
					}
					e.target.value = ""
				}}
			/>
			<SidebarGroupContent className="flex flex-1 flex-col">
				{assets.length === 0 ? (
					<ContextMenu disabled={readOnly || !hasFinePointer}>
						<ContextMenuTrigger
							className="flex flex-1 flex-col"
							onTouchStart={event => event.preventBaseUIHandler()}
						>
							<div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 text-xs">
								<ImageIcon className="size-6 opacity-50" />
								<p>
									<T k="assets.noAssetsYet" />
								</p>
							</div>
						</ContextMenuTrigger>
						<ContextMenuContent>
							{onCreateTldraw && (
								<ContextMenuItem onClick={createTldraw}>
									<PenTool />
									{t("assets.newWhiteboard")}
								</ContextMenuItem>
							)}
							<ContextMenuItem onClick={() => fileInputRef.current?.click()}>
								<Upload />
								{t("assets.uploadOrImport")}
							</ContextMenuItem>
						</ContextMenuContent>
					</ContextMenu>
				) : (
					<SidebarMenu>
						{assets.map(asset => {
							let actions = getAssetActions(asset)
							return (
								<SidebarMenuItem key={asset.id}>
									<ContextMenu disabled={readOnly || !hasFinePointer}>
										<ContextMenuTrigger
											onTouchStart={event => event.preventBaseUIHandler()}
										>
											<DropdownMenu>
												<DropdownMenuTrigger
													disabled={readOnly}
													render={
														<SidebarMenuButton disabled={readOnly} nativeButton>
															<div className="bg-muted size-8 shrink-0 overflow-hidden rounded">
																{asset.type === "image" && asset.imageId ? (
																	<JazzImage
																		imageId={asset.imageId}
																		className="size-full object-cover"
																	/>
																) : asset.type === "tldraw" &&
																  (colorScheme === "dark"
																		? asset.darkPreviewId
																		: asset.lightPreviewId) ? (
																	<JazzImage
																		imageId={
																			colorScheme === "dark"
																				? asset.darkPreviewId!
																				: asset.lightPreviewId!
																		}
																		className="size-full object-cover"
																	/>
																) : asset.type === "video" &&
																  asset.getVideoBlob ? (
																	<VideoThumbnail
																		assetId={asset.id}
																		getBlob={asset.getVideoBlob}
																	/>
																) : (
																	<div className="flex size-full items-center justify-center">
																		{asset.type === "video" ? (
																			<Film className="text-muted-foreground size-4" />
																		) : asset.type === "tldraw" ? (
																			<PenTool className="text-muted-foreground size-4" />
																		) : (
																			<ImageIcon className="text-muted-foreground size-4" />
																		)}
																	</div>
																)}
															</div>
															<span className="truncate">{asset.name}</span>
														</SidebarMenuButton>
													}
												/>
												<DropdownMenuContent
													side={isMobile ? "bottom" : "left"}
													align={isMobile ? "center" : "start"}
												>
													{actions.map(action => (
														<DropdownMenuItem
															key={action.id}
															onClick={action.onClick}
															variant={
																action.destructive ? "destructive" : "default"
															}
														>
															{action.icon}
															{action.label}
														</DropdownMenuItem>
													))}
												</DropdownMenuContent>
											</DropdownMenu>
										</ContextMenuTrigger>
										<ContextMenuContent>
											{actions.map(action => (
												<ContextMenuItem
													key={action.id}
													onClick={action.onClick}
													variant={
														action.destructive ? "destructive" : "default"
													}
												>
													{action.icon}
													{action.label}
												</ContextMenuItem>
											))}
										</ContextMenuContent>
									</ContextMenu>
								</SidebarMenuItem>
							)
						})}
					</SidebarMenu>
				)}
			</SidebarGroupContent>

			<RenameAssetDialog
				open={renameOpen}
				onOpenChange={open => {
					setRenameOpen(open)
					if (!open) setRenamingAsset(null)
				}}
				currentName={renamingAsset?.name ?? ""}
				onRename={handleSaveRename}
			/>
			<ConfirmDialog
				open={deleteOpen}
				onOpenChange={open => {
					setDeleteOpen(open)
					if (!open) setDeletingAssetId(null)
				}}
				title={t("assets.deleteTitle")}
				description={t("assets.deleteDescription")}
				confirmLabel={t("assets.deleteConfirm")}
				variant="destructive"
				onConfirm={handleConfirmDelete}
			/>
			{videoUpload && (
				<UploadProgressDialog
					open={true}
					fileName={videoUpload.fileName}
					phase={videoUpload.phase}
					progress={videoUpload.progress}
					onCancel={handleCancelUpload}
				/>
			)}
		</div>
	)
}

let thumbnailCache = new Map<string, string>()

function VideoThumbnail({
	assetId,
	getBlob,
}: {
	assetId: string
	getBlob: () => Blob | undefined
}) {
	let [thumbnailUrl, setThumbnailUrl] = useState<string | null>(
		() => thumbnailCache.get(assetId) ?? null,
	)

	useEffect(() => {
		// Already have thumbnail
		if (thumbnailUrl) return

		let blob = getBlob()
		if (!blob) return

		let videoUrl = URL.createObjectURL(blob)
		let video = document.createElement("video")
		video.src = videoUrl
		video.muted = true
		video.preload = "metadata"

		let cancelled = false

		video.onloadeddata = () => {
			if (cancelled) return
			video.currentTime = 0
		}

		video.onseeked = () => {
			if (cancelled) return
			let canvas = document.createElement("canvas")
			canvas.width = video.videoWidth
			canvas.height = video.videoHeight
			let ctx = canvas.getContext("2d")
			if (ctx) {
				ctx.drawImage(video, 0, 0)
				let dataUrl = canvas.toDataURL("image/jpeg", 0.7)
				thumbnailCache.set(assetId, dataUrl)
				setThumbnailUrl(dataUrl)
			}
			URL.revokeObjectURL(videoUrl)
		}

		video.onerror = () => {
			URL.revokeObjectURL(videoUrl)
		}

		return () => {
			cancelled = true
			URL.revokeObjectURL(videoUrl)
		}
	}, [assetId, getBlob, thumbnailUrl])

	if (!thumbnailUrl) {
		return (
			<div className="flex size-full items-center justify-center">
				<Film className="text-muted-foreground size-4" />
			</div>
		)
	}

	return <img src={thumbnailUrl} className="size-full object-cover" alt="" />
}

interface RenameAssetDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	currentName: string
	onRename: (name: string) => void
}

function makeAssetNameSchema(t: ReturnType<typeof useIntl>) {
	return z.object({
		name: z
			.string()
			.min(1, t("assets.nameRequired"))
			.max(100, t("assets.nameTooLong")),
	})
}

function RenameAssetDialog({
	open,
	onOpenChange,
	currentName,
	onRename,
}: RenameAssetDialogProps) {
	let t = useIntl()
	let assetNameSchema = makeAssetNameSchema(t)
	let form = useForm({
		defaultValues: { name: currentName },
		validators: { onSubmit: assetNameSchema },
		onSubmit: ({ value }) => {
			onRename(value.name.trim())
			onOpenChange(false)
		},
	})

	function handleOpenChangeComplete(isOpen: boolean) {
		if (isOpen) {
			form.reset({ name: currentName })
		}
	}

	return (
		<Dialog
			open={open}
			onOpenChange={onOpenChange}
			onOpenChangeComplete={handleOpenChangeComplete}
		>
			<DialogContent showCloseButton={false}>
				<DialogHeader>
					<DialogTitle>
						<T k="assets.renameAsset" />
					</DialogTitle>
				</DialogHeader>
				<form
					onSubmit={e => {
						e.preventDefault()
						form.handleSubmit()
					}}
					className="space-y-4"
				>
					<form.Field name="name">
						{field => {
							let isInvalid =
								field.state.meta.isTouched && !field.state.meta.isValid
							return (
								<Field data-invalid={isInvalid}>
									<FieldLabel htmlFor={field.name}>
										<T k="assets.name" />
									</FieldLabel>
									<Input
										id={field.name}
										name={field.name}
										value={field.state.value}
										onBlur={field.handleBlur}
										onChange={e => field.handleChange(e.target.value)}
										aria-invalid={isInvalid}
										placeholder={t("assets.assetName")}
										autoFocus
									/>
									{isInvalid && (
										<FieldError>
											{field.state.meta.errors.join(", ")}
										</FieldError>
									)}
								</Field>
							)
						}}
					</form.Field>
					<DialogFooter>
						<Button type="submit">
							<T k="assets.save" />
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
