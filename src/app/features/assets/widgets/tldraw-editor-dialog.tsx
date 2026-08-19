import {
	Component,
	lazy,
	Suspense,
	useEffect,
	useRef,
	useState,
	type ErrorInfo,
	type ReactNode,
} from "react"
import { Loader2, Save, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/app/components/ui/button"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/app/components/ui/dialog"
import { ConfirmDialog } from "@/app/components/ui/confirm-dialog"
import { T, useIntl } from "@/shared/intl/setup"
import type { TldrawSave } from "../lib/tldraw"
import type { TldrawCanvasHandle } from "./tldraw-canvas"
import { WhiteboardPresence } from "./whiteboard-presence"

export { TldrawEditorDialog }

let LazyTldrawCanvas = lazy(() =>
	import("./tldraw-canvas").then(module => ({
		default: module.TldrawCanvas,
	})),
)

interface TldrawEditorDialogProps {
	open: boolean
	assetId?: string
	name: string
	initialJson?: string
	mode: "create" | "edit" | "import"
	onOpenChange: (open: boolean) => void
	onSave: (save: TldrawSave) => Promise<void>
}

function TldrawEditorDialog({
	open,
	assetId,
	name,
	initialJson,
	mode,
	onOpenChange,
	onSave,
}: TldrawEditorDialogProps) {
	let t = useIntl()
	let canvas = useRef<TldrawCanvasHandle | null>(null)
	let [dirty, setDirty] = useState(false)
	let [confirmClose, setConfirmClose] = useState(false)
	let [saving, setSaving] = useState(false)
	let [ready, setReady] = useState(false)
	let handleSaveRef = useRef(handleSave)
	handleSaveRef.current = handleSave

	useEffect(() => {
		if (!open) return
		function handleKeyDown(event: KeyboardEvent) {
			if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s")
				return
			event.preventDefault()
			void handleSaveRef.current()
		}
		document.addEventListener("keydown", handleKeyDown)
		return () => document.removeEventListener("keydown", handleKeyDown)
	}, [open])

	function requestClose() {
		if (dirty) {
			setConfirmClose(true)
			return
		}
		onOpenChange(false)
	}

	async function handleSave() {
		if (!canvas.current || saving) return
		if (!canvas.current.hasShapes()) {
			toast.error(t("assets.addBeforeSaving"))
			return
		}
		setSaving(true)
		try {
			let save = await canvas.current.save()
			await onSave(save)
			setDirty(false)
			onOpenChange(false)
			toast.success(
				mode === "edit"
					? t("assets.whiteboardSaved")
					: t("assets.whiteboardAdded"),
			)
		} catch (error) {
			console.error("Failed to save whiteboard:", error)
			toast.error(t("assets.whiteboardSaveFailed"))
		} finally {
			setSaving(false)
		}
	}

	return (
		<>
			<Dialog open={open} onOpenChange={next => !next && requestClose()}>
				<DialogContent
					animated={false}
					showCloseButton={false}
					className="inset-0 top-0 left-0 isolate !flex h-[100dvh] max-w-none translate-x-0 flex-col gap-0 rounded-none border-0 p-0 ring-0 sm:top-0 sm:max-w-none sm:translate-y-0"
				>
					<DialogHeader className="border-border bg-background z-10 flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 flex-row items-end justify-between gap-3 border-b px-2 pt-[env(safe-area-inset-top)] pb-1.5 sm:h-14 sm:items-center sm:px-3 sm:pt-0 sm:pb-0">
						<div className="flex min-w-0 flex-1 items-center gap-2 px-1">
							<div className="min-w-0">
								<DialogTitle className="truncate text-sm font-medium sm:text-base">
									{name}
								</DialogTitle>
								<DialogDescription className="sr-only">
									{t("assets.whiteboardEditorDescription")}
								</DialogDescription>
							</div>
							{assetId && <WhiteboardPresence assetId={assetId} />}
						</div>
						<div className="flex shrink-0 items-center gap-1.5">
							<Button
								variant="ghost"
								size="sm"
								className="min-h-11 min-w-11 sm:min-h-9"
								onClick={requestClose}
								disabled={saving}
							>
								<X className="size-4" />
								<span className="hidden sm:inline">
									<T k="common.cancel" />
								</span>
								<span className="sr-only sm:hidden">
									<T k="common.cancel" />
								</span>
							</Button>
							<Button
								size="sm"
								className="min-h-11 min-w-11 sm:min-h-9"
								onClick={handleSave}
								disabled={!ready || saving}
							>
								{saving ? (
									<Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
								) : (
									<Save className="size-4" />
								)}
								<span>
									{saving
										? t("assets.saving")
										: mode === "import"
											? t("assets.import")
											: t("assets.save")}
								</span>
							</Button>
						</div>
					</DialogHeader>
					<div className="relative min-h-0 flex-1 overflow-hidden">
						<CanvasErrorBoundary
							fallback={
								<div className="text-muted-foreground flex size-full items-center justify-center p-6 text-center text-sm">
									{t("assets.invalidTldraw")}
								</div>
							}
						>
							<Suspense
								fallback={
									<div className="bg-muted/30 flex size-full items-center justify-center">
										<Loader2 className="text-muted-foreground size-6 animate-spin motion-reduce:animate-none" />
									</div>
								}
							>
								<LazyTldrawCanvas
									initialJson={initialJson}
									onDirty={() => setDirty(true)}
									onReady={handle => {
										canvas.current = handle
										setReady(true)
									}}
								/>
							</Suspense>
						</CanvasErrorBoundary>
					</div>
				</DialogContent>
			</Dialog>
			<ConfirmDialog
				open={confirmClose}
				onOpenChange={setConfirmClose}
				title={t("assets.discardWhiteboardTitle")}
				description={t("assets.discardWhiteboardDescription")}
				confirmLabel={t("assets.discard")}
				variant="destructive"
				onConfirm={() => {
					setDirty(false)
					onOpenChange(false)
				}}
			/>
		</>
	)
}

interface CanvasErrorBoundaryProps {
	children: ReactNode
	fallback: ReactNode
}

interface CanvasErrorBoundaryState {
	failed: boolean
}

class CanvasErrorBoundary extends Component<
	CanvasErrorBoundaryProps,
	CanvasErrorBoundaryState
> {
	state = { failed: false }

	static getDerivedStateFromError() {
		return { failed: true }
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error("Failed to open whiteboard:", error, info)
	}

	render() {
		return this.state.failed ? this.props.fallback : this.props.children
	}
}
