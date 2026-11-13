import { useState, useRef, useEffect } from "react"
import { useAll } from "jazz-tools/react"
import {
	app,
	useLibrary,
	createDocument,
	updateContent,
	type Database,
	type LibraryDocument,
} from "../lib/library"
import { copyDocumentAssets } from "@/app/features/assets"
import { exportComments, importComments } from "@/app/features/import-export"
import { setFrontmatterField } from "@/app/features/editor"
import { User } from "lucide-react"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/app/components/ui/dialog"
import { Button } from "@/app/components/ui/button"
import { Checkbox } from "@/app/components/ui/checkbox"
import { Input } from "@/app/components/ui/input"
import { Label } from "@/app/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/app/components/ui/select"
import { Progress } from "@/app/components/ui/progress"
import { useIntl } from "@/shared/intl/setup"
export { DuplicateDocDialog, duplicateDocument }
export type { DuplicateDocDialogProps, DuplicateProgress }

type LoadedDocument = LibraryDocument
type DuplicateProgress = {
	total: number
	copied: number
	status: "idle" | "copying" | "done" | "error"
	error?: string
}

type SpaceOption = {
	id: string
	name: string
}

interface DuplicateDocDialogProps {
	doc: LoadedDocument
	open: boolean
	onOpenChange: (open: boolean) => void
	onDuplicate?: (newDocId: string, destination: SpaceOption | null) => void
}

function DuplicateDocDialog({
	doc,
	open,
	onOpenChange,
	onDuplicate,
}: DuplicateDocDialogProps) {
	let t = useIntl()
	let { db, ownerId } = useLibrary()
	let { data: spaces = [] } = useAll(app.spaces.where({ ownerId }))
	let [name, setName] = useState("")
	let [destination, setDestination] = useState<string>("personal")
	let [copyComments, setCopyComments] = useState(true)
	let [progress, setProgress] = useState<DuplicateProgress>({
		total: 0,
		copied: 0,
		status: "idle",
	})
	let inputRef = useRef<HTMLInputElement>(null)

	let docName = getDocName(doc, t("doc.untitled"))
	let isDuplicating = progress.status === "copying"

	useEffect(() => {
		if (open) {
			setName(t("doc.duplicateDialog.copyName", { name: docName }))
			setDestination("personal")
			setCopyComments(true)
			setProgress({ total: 0, copied: 0, status: "idle" })
			setTimeout(() => {
				inputRef.current?.focus()
				inputRef.current?.select()
			}, 0)
		}
	}, [open, docName, t])

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault()
		let trimmed = name.trim()
		if (!trimmed) return

		let selectedSpace: SpaceOption | null = null
		if (destination !== "personal") {
			let space = spaces.find(s => s.id === destination)
			if (space) {
				selectedSpace = { id: space.id, name: space.name }
			}
		}

		try {
			let newDocId = await duplicateDocument({
				doc,
				newName: trimmed,
				destination: selectedSpace,
				copyComments,
				db,
				ownerId,
				onProgress: setProgress,
				t,
			})
			onDuplicate?.(newDocId, selectedSpace)
			onOpenChange(false)
		} catch (err) {
			setProgress(p => ({
				...p,
				status: "error",
				error: err instanceof Error ? err.message : t("doc.errorUnknown"),
			}))
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t("doc.duplicateDialog.title")}</DialogTitle>
					<DialogDescription>
						{t("doc.duplicateDialog.description")}
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit}>
					<div className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="doc-name">{t("doc.duplicateDialog.name")}</Label>
							<Input
								ref={inputRef}
								id="doc-name"
								value={name}
								onChange={e => setName(e.target.value)}
								autoComplete="off"
							/>
						</div>

						<div className="space-y-2">
							<Label>{t("doc.duplicateDialog.destination")}</Label>
							<Select
								value={destination}
								onValueChange={v => v && setDestination(v)}
							>
								<SelectTrigger className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="personal">
										<User className="size-4" />
										<span>{t("doc.duplicateDialog.personal")}</span>
									</SelectItem>
									{spaces.map(space => (
										<SelectItem key={space.id} value={space.id}>
											<SpaceInitials name={space.name} size="sm" />
											<span>{space.name}</span>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<label className="flex items-center gap-2 text-sm">
							<Checkbox
								checked={copyComments}
								onCheckedChange={checked => setCopyComments(Boolean(checked))}
							/>
							<span>{t("doc.duplicateDialog.copyComments")}</span>
						</label>
					</div>

					{isDuplicating && progress.total > 0 && (
						<div className="space-y-2 pt-2">
							<div className="text-muted-foreground flex justify-between text-sm">
								<span>{t("doc.duplicateDialog.copyingAssets")}</span>
								<span>
									{progress.copied}/{progress.total}
								</span>
							</div>
							<Progress value={progress.copied} max={progress.total} />
						</div>
					)}

					{progress.status === "error" && (
						<p className="text-destructive text-sm">{progress.error}</p>
					)}

					<DialogFooter className="mt-4">
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => onOpenChange(false)}
							disabled={isDuplicating}
						>
							{t("doc.cancel")}
						</Button>
						<Button
							type="submit"
							size="sm"
							disabled={!name.trim() || isDuplicating}
						>
							{isDuplicating
								? progress.total > 0
									? t("doc.duplicateDialog.copyingProgress", {
											copied: String(progress.copied),
											total: String(progress.total),
										})
									: t("doc.duplicateDialog.duplicating")
								: t("doc.duplicate")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}

type DuplicateOptions = {
	doc: LoadedDocument
	newName: string
	destination: SpaceOption | null
	copyComments: boolean
	db: Database
	ownerId: string
	onProgress?: (progress: DuplicateProgress) => void
	t?: ReturnType<typeof useIntl>
}
async function duplicateDocument(options: DuplicateOptions): Promise<string> {
	let { db, ownerId, doc, destination, newName } = options
	options.onProgress?.({ total: 1, copied: 0, status: "copying" })
	let content = setFrontmatterField(doc.content, "title", newName)
	let copy = await createDocument(db, ownerId, content, destination?.id)
	content = await copyDocumentAssets(db, doc.id, copy.id, content)
	await updateContent(db, copy, content)
	if (options.copyComments)
		await importComments(
			db,
			copy.id,
			ownerId,
			await exportComments(db, doc.id),
			doc.content,
		)
	options.onProgress?.({ total: 1, copied: 1, status: "done" })
	return copy.id
}
function getDocName(doc: LoadedDocument, fallback: string) {
	return doc.title || fallback
}
function SpaceInitials({ name }: { name: string; size?: string }) {
	return (
		<div className="bg-muted text-muted-foreground flex size-4 shrink-0 items-center justify-center rounded text-[8px] font-medium">
			{name
				.split(/\s+/)
				.slice(0, 2)
				.map(word => word[0])
				.join("")
				.toUpperCase()}
		</div>
	)
}
