import { useState } from "react"
import { Upload } from "lucide-react"
import { importMarkdownFiles, type ImportedFile } from "../index"
import { T } from "@/shared/intl/setup"

export { ImportDropZone }

interface ImportDropZoneProps {
	onImport: (files: ImportedFile[]) => Promise<void>
	children: React.ReactNode
}

function ImportDropZone({ onImport, children }: ImportDropZoneProps) {
	let [isDragging, setIsDragging] = useState(false)

	async function handleDrop(e: React.DragEvent) {
		if (!isFileDrag(e)) return
		e.preventDefault()
		setIsDragging(false)

		let dataTransfer = e.dataTransfer
		let hasDirectories = Array.from(dataTransfer.items).some(
			item => item.webkitGetAsEntry?.()?.isDirectory,
		)

		let imported: ImportedFile[]
		if (hasDirectories) {
			// v2-todo(import-export): folder import.
			imported = []
		} else if (dataTransfer.files.length > 0) {
			imported = await importMarkdownFiles(dataTransfer.files)
		} else {
			return
		}

		await onImport(imported)
	}

	return (
		<div
			className="relative flex h-full flex-col"
			onDragOver={e => {
				if (!isFileDrag(e)) return
				e.preventDefault()
				setIsDragging(true)
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
							<T k="importExport.dropZone.hint" />
						</p>
					</div>
				</div>
			)}
			{children}
		</div>
	)
}

// Documents dragged within the sidebar carry no files and must reach the list
function isFileDrag(e: React.DragEvent): boolean {
	return e.dataTransfer.types.includes("Files")
}
