import { useState, type ReactNode } from "react"
import { toast } from "sonner"
import { TldrawRevision } from "../lib/schema"
import { tldrawNameFromFile, type TldrawSave } from "../lib/tldraw"
import { useIntl } from "@/shared/intl/setup"
import type { SidebarAsset } from "./sidebar-assets"
import { TldrawEditorDialog } from "./tldraw-editor-dialog"

export { useTldrawEditor }

interface CreatedTldrawAsset {
	id: string
	name: string
}

interface TldrawEditorState {
	assetId?: string
	name: string
	initialJson?: string
	mode: "create" | "edit" | "import"
	onCreated?: (asset: CreatedTldrawAsset) => void
}

interface TldrawEditorOptions {
	assets: SidebarAsset[]
	readOnly: boolean
	createAsset: (name: string, save: TldrawSave) => Promise<CreatedTldrawAsset>
	updateAsset: (assetId: string, save: TldrawSave) => Promise<void>
}

interface TldrawEditorController {
	dialog: ReactNode
	create: (onCreated?: (asset: CreatedTldrawAsset) => void) => void
	edit: (assetId: string) => void
	importFile: (file: File) => void
}

function useTldrawEditor({
	assets,
	readOnly,
	createAsset,
	updateAsset,
}: TldrawEditorOptions): TldrawEditorController {
	let t = useIntl()
	let [editor, setEditor] = useState<TldrawEditorState | null>(null)

	function create(onCreated?: (asset: CreatedTldrawAsset) => void) {
		if (readOnly) return
		setEditor({
			name: getNextWhiteboardName(assets, t("assets.whiteboard")),
			mode: "create",
			onCreated,
		})
	}

	function importFile(file: File) {
		if (readOnly) return
		void openFile(file)
	}

	async function openFile(file: File) {
		let tldrawFile = await import("../lib/tldraw-file")
		try {
			let json = await file.text()
			tldrawFile.validateTldrawFile(json)
			setEditor({
				name: tldrawNameFromFile(file),
				initialJson: json,
				mode: "import",
			})
		} catch (error) {
			console.error("Failed to open tldraw file:", error)
			let message =
				error instanceof tldrawFile.TldrawFileError &&
				error.code === "multiple-pages"
					? t("assets.multiplePagesUnsupported")
					: error instanceof tldrawFile.TldrawFileError &&
						  error.code === "embedded-media"
						? t("assets.embeddedMediaUnsupported")
						: t("assets.invalidTldraw")
			toast.error(message)
		}
	}

	function edit(assetId: string) {
		if (readOnly) return
		void openAsset(assetId)
	}

	async function openAsset(assetId: string) {
		let asset = assets.find(candidate => candidate.id === assetId)
		if (asset?.type !== "tldraw" || !asset.tldrawRevisionId) return
		let revision = await TldrawRevision.load(asset.tldrawRevisionId, {
			resolve: { snapshot: true },
		})
		let blob = revision?.$isLoaded ? revision.snapshot.toBlob() : undefined
		if (!blob) {
			toast.error(t("assets.whiteboardLoading"))
			return
		}
		setEditor({
			assetId,
			name: asset.name,
			initialJson: await blob.text(),
			mode: "edit",
		})
	}

	let dialog = editor ? (
		<TldrawEditorDialog
			open={true}
			assetId={editor.assetId}
			name={editor.name}
			initialJson={editor.initialJson}
			mode={editor.mode}
			onOpenChange={open => {
				if (!open) setEditor(null)
			}}
			onSave={async save => {
				if (editor.assetId) {
					await updateAsset(editor.assetId, save)
					return
				}
				let created = await createAsset(editor.name, save)
				editor.onCreated?.(created)
			}}
		/>
	) : null

	return { dialog, create, edit, importFile }
}

function getNextWhiteboardName(assets: SidebarAsset[], baseName: string) {
	let names = new Set(assets.map(asset => asset.name.toLocaleLowerCase()))
	if (!names.has(baseName.toLocaleLowerCase())) return baseName
	let suffix = 2
	while (names.has(`${baseName} ${suffix}`.toLocaleLowerCase())) suffix++
	return `${baseName} ${suffix}`
}
