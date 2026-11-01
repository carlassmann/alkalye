import { useState } from "react"
import { Folder, Plus, Check } from "lucide-react"
import { Combobox } from "@base-ui/react/combobox"
import { co } from "jazz-tools"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/app/components/ui/dialog"
import { Button } from "@/app/components/ui/button"
import { Document } from "@/schema"
import { cn } from "@/app/lib/cn"
import { useIntl } from "@/shared/intl/setup"
import { moveDocumentsToFolder } from "../lib/folders"
import { notifySkippedDocuments } from "./sidebar-bulk-actions"

export { MoveToFolderDialog }

type SidebarDoc = co.loaded<typeof Document>

interface MoveToFolderDialogProps {
	docs: SidebarDoc[]
	existingFolders: string[]
	open?: boolean
	onOpenChange?: (open: boolean) => void
}

function MoveToFolderDialog({
	docs,
	existingFolders,
	open: controlledOpen,
	onOpenChange,
}: MoveToFolderDialogProps) {
	let t = useIntl()
	let [internalOpen, setInternalOpen] = useState(false)
	let open = controlledOpen ?? internalOpen
	let setOpen = onOpenChange ?? setInternalOpen

	let [inputValue, setInputValue] = useState("")
	let paths = new Set(docs.map(doc => doc.path ?? null))
	let currentPath = paths.size === 1 ? ([...paths][0] ?? null) : null
	let isAnyInFolder = docs.some(doc => doc.path)

	let filteredFolders = existingFolders.filter(folder =>
		folder.toLowerCase().includes(inputValue.toLowerCase()),
	)
	let showCreateOption =
		inputValue.trim() &&
		!existingFolders.some(f => f.toLowerCase() === inputValue.toLowerCase())

	async function handleMoveToFolder(newPath: string | null) {
		notifySkippedDocuments(await moveDocumentsToFolder(docs, newPath), t)
	}

	function handleSelect(value: string | null) {
		if (!value) return
		void handleMoveToFolder(value === "__root__" ? null : value)
		setOpen(false)
		setInputValue("")
	}

	function handleCreateAndMove() {
		if (!inputValue.trim()) return
		void handleMoveToFolder(inputValue.trim())
		setOpen(false)
		setInputValue("")
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent className="max-w-sm">
				<DialogHeader>
					<DialogTitle>{t("doc.moveToFolderDialog.title")}</DialogTitle>
					<DialogDescription>
						{paths.size > 1
							? t("doc.sidebar.selectedCount", { count: String(docs.length) })
							: currentPath
								? t("doc.moveToFolderDialog.currentLocation", {
										path: currentPath,
									})
								: t("doc.moveToFolderDialog.notInFolder")}
					</DialogDescription>
				</DialogHeader>

				<Combobox.Root
					value={null}
					onValueChange={handleSelect}
					onInputValueChange={value => setInputValue(value)}
				>
					<div className="relative">
						<Combobox.Input
							placeholder={t("doc.moveToFolderDialog.placeholder")}
							className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring h-9 w-full rounded-none border px-3 py-1 text-sm focus-visible:ring-1 focus-visible:outline-none"
						/>
					</div>

					<Combobox.Portal>
						<Combobox.Positioner sideOffset={4} className="z-50">
							<Combobox.Popup className="bg-popover text-popover-foreground ring-foreground/10 max-h-60 w-[var(--anchor-width)] overflow-auto rounded-none shadow-md ring-1">
								{filteredFolders.length === 0 && !showCreateOption && (
									<div className="text-muted-foreground px-3 py-2 text-sm">
										{t("doc.moveToFolderDialog.noFolders")}
									</div>
								)}

								{isAnyInFolder && (
									<Combobox.Item
										value="__root__"
										className="data-highlighted:bg-accent data-highlighted:text-accent-foreground flex cursor-pointer items-center gap-2 px-3 py-2 text-sm outline-none"
									>
										<Folder className="text-muted-foreground size-4" />
										<span className="text-muted-foreground italic">
											{t("doc.moveToFolderDialog.rootOption")}
										</span>
									</Combobox.Item>
								)}

								{filteredFolders.map(folder => (
									<Combobox.Item
										key={folder}
										value={folder}
										className={cn(
											"data-highlighted:bg-accent data-highlighted:text-accent-foreground flex cursor-pointer items-center gap-2 px-3 py-2 text-sm outline-none",
											folder === currentPath && "bg-accent/50",
										)}
									>
										<Folder className="text-muted-foreground size-4" />
										<span className="flex-1 truncate">{folder}</span>
										{folder === currentPath && (
											<Check className="text-muted-foreground size-4" />
										)}
									</Combobox.Item>
								))}

								{showCreateOption && (
									<button
										type="button"
										onClick={handleCreateAndMove}
										className="hover:bg-accent hover:text-accent-foreground flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-sm outline-none"
									>
										<Plus className="text-muted-foreground size-4" />
										<span>
											Create &ldquo;
											<span className="font-medium">{inputValue}</span>&rdquo;
										</span>
									</button>
								)}
							</Combobox.Popup>
						</Combobox.Positioner>
					</Combobox.Portal>
				</Combobox.Root>

				<div className="flex justify-end gap-2 pt-2">
					<Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
						{t("doc.cancel")}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	)
}
