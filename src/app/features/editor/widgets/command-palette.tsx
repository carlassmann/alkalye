import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { Search, X } from "lucide-react"
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/app/components/ui/dialog"
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
} from "@/app/components/ui/input-group"
import { Kbd } from "@/app/components/ui/kbd"
import {
	getShortcutDefinitions,
	getShortcutLabel,
	type ShortcutId,
} from "@/app/lib/shortcut-registry"
import { useHasFinePointer } from "@/app/hooks/use-fine-pointer"
import type { DocumentHeading } from "../lib/document-navigation"

export { CommandPalette, OutlineDialog, ShortcutsDialog }
export type { CommandId }

type CommandId =
	| ShortcutId
	| "clearFormatting"
	| "promoteHeading"
	| "demoteHeading"
	| "insertTable"
	| "insertDivider"
	| "insertWikilink"
	| "renumberLists"
	| "keyboardShortcuts"

interface CommandOverlayProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	onRun: (id: CommandId) => void
}

type ShortcutGroup = "Authoring" | "Editing" | "Navigation" | "Document"

let authoring = new Set<ShortcutId>([
	"bold",
	"italic",
	"inlineCode",
	"link",
	"image",
	"strikethrough",
	"heading1",
	"heading2",
	"heading3",
	"heading4",
	"heading5",
	"heading6",
	"body",
	"bulletList",
	"orderedList",
	"taskList",
	"toggleTask",
	"sortTasks",
	"blockquote",
	"codeBlock",
	"comment",
	"hardBreak",
	"indent",
	"outdent",
])
let editing = new Set<ShortcutId>([
	"moveLineUp",
	"moveLineDown",
	"duplicateLineUp",
	"duplicateLineDown",
	"deleteLine",
	"insertLineBelow",
	"insertLineAbove",
	"selectLine",
	"indentSelection",
	"outdentSelection",
	"addCursorAbove",
	"addCursorBelow",
	"selectNextOccurrence",
	"selectAllOccurrences",
	"expandSelection",
	"shrinkSelection",
	"rawPaste",
	"undo",
	"redo",
	"cut",
	"copy",
	"paste",
])
let navigation = new Set<ShortcutId>([
	"find",
	"replace",
	"findNext",
	"findPrevious",
	"goToFindMatch",
	"commandPalette",
	"documentOutline",
	"contextAction",
])

let shortcuts = getShortcutDefinitions().map(definition => ({
	id: definition.id,
	label: humanize(definition.id),
	group: groupFor(definition.id),
	shortcutId: definition.id,
}))

let paletteCommands = [
	...shortcuts,
	{
		id: "clearFormatting" as const,
		label: "Clear formatting",
		group: "Authoring" as const,
	},
	{
		id: "promoteHeading" as const,
		label: "Promote heading",
		group: "Authoring" as const,
	},
	{
		id: "demoteHeading" as const,
		label: "Demote heading",
		group: "Authoring" as const,
	},
	{
		id: "insertTable" as const,
		label: "Insert table",
		group: "Authoring" as const,
	},
	{
		id: "insertDivider" as const,
		label: "Insert divider",
		group: "Authoring" as const,
	},
	{
		id: "insertWikilink" as const,
		label: "Insert wikilink",
		group: "Authoring" as const,
	},
	{
		id: "renumberLists" as const,
		label: "Renumber ordered lists",
		group: "Editing" as const,
	},
	{
		id: "keyboardShortcuts" as const,
		label: "Keyboard shortcuts",
		group: "Navigation" as const,
	},
]

function CommandPalette({ open, onOpenChange, onRun }: CommandOverlayProps) {
	return (
		<CommandDialog
			open={open}
			onOpenChange={onOpenChange}
			title="Command palette"
			searchLabel="Search commands"
			emptyLabel="No matching commands"
			items={paletteCommands.map(command => ({
				id: command.id,
				label: command.label,
				searchText: `${command.label} ${command.group}`,
				group: command.group,
				shortcutId: "shortcutId" in command ? command.shortcutId : undefined,
				value: command.id,
			}))}
			onSelect={onRun}
		/>
	)
}

interface OutlineDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	headings: DocumentHeading[]
	onSelect: (heading: DocumentHeading) => void
}

function OutlineDialog({
	open,
	onOpenChange,
	headings,
	onSelect,
}: OutlineDialogProps) {
	return (
		<QuickJumpDialog
			open={open}
			onOpenChange={onOpenChange}
			title="Document outline"
			searchLabel="Find a heading"
			emptyLabel="No headings in this document"
			items={headings.map(heading => ({
				id: `${heading.from}`,
				label: heading.title,
				detail: `H${heading.level} · line ${heading.line}`,
				indent: heading.level - 1,
				value: heading,
			}))}
			onSelect={onSelect}
		/>
	)
}

interface QuickJumpItem<T> {
	id: string
	label: string
	detail?: string
	indent?: number
	value: T
}

interface QuickJumpDialogProps<T> {
	open: boolean
	onOpenChange: (open: boolean) => void
	title: string
	searchLabel: string
	emptyLabel: string
	items: QuickJumpItem<T>[]
	onSelect: (value: T) => void
}

function QuickJumpDialog<T>({
	open,
	onOpenChange,
	title,
	searchLabel,
	emptyLabel,
	items,
	onSelect,
}: QuickJumpDialogProps<T>) {
	return (
		<CommandDialog
			open={open}
			onOpenChange={onOpenChange}
			title={title}
			searchLabel={searchLabel}
			emptyLabel={emptyLabel}
			items={items.map(item => ({
				...item,
				searchText: `${item.label} ${item.detail ?? ""}`,
			}))}
			onSelect={onSelect}
		/>
	)
}

interface CommandDialogItem<T> {
	id: string
	label: string
	searchText: string
	group?: string
	shortcutId?: ShortcutId
	detail?: string
	indent?: number
	value: T
}

interface CommandDialogProps<T> {
	open: boolean
	onOpenChange: (open: boolean) => void
	title: string
	searchLabel: string
	emptyLabel: string
	items: CommandDialogItem<T>[]
	onSelect: (value: T) => void
}

function CommandDialog<T>({
	open,
	onOpenChange,
	title,
	searchLabel,
	emptyLabel,
	items,
	onSelect,
}: CommandDialogProps<T>) {
	let hasFinePointer = useHasFinePointer()
	let [query, setQuery] = useState("")
	let [activeIndex, setActiveIndex] = useState(0)
	let listRef = useRef<HTMLDivElement>(null)
	let filtered = items.filter(item =>
		item.searchText.toLowerCase().includes(query.toLowerCase()),
	)
	let selectedIndex =
		filtered.length === 0 ? -1 : Math.min(activeIndex, filtered.length - 1)
	let activeItem = filtered[selectedIndex]
	let listId = `command-dialog-${title.toLowerCase().replaceAll(" ", "-")}`

	useEffect(() => {
		let active = listRef.current?.querySelector<HTMLElement>(
			'[data-active="true"]',
		)
		active?.scrollIntoView?.({ block: "nearest" })
	}, [activeIndex, open, query])

	function handleOpenChange(nextOpen: boolean) {
		if (!nextOpen) {
			setQuery("")
			setActiveIndex(0)
		}
		onOpenChange(nextOpen)
	}

	function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
		if (event.key === "Enter") {
			if (!activeItem) return
			event.preventDefault()
			handleSelect(activeItem)
			return
		}
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
		if (filtered.length === 0) return
		event.preventDefault()
		let direction = event.key === "ArrowDown" ? 1 : -1
		setActiveIndex(
			(selectedIndex + direction + filtered.length) % filtered.length,
		)
	}

	function handleSelect(item: CommandDialogItem<T>) {
		onSelect(item.value)
		handleOpenChange(false)
	}

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent
				showCloseButton={false}
				className="top-[max(1rem,env(safe-area-inset-top))] max-w-lg translate-y-0 gap-2 p-2 sm:top-24 sm:translate-y-0"
			>
				<DialogHeader className="sr-only">
					<DialogTitle>{title}</DialogTitle>
				</DialogHeader>
				<InputGroup className="h-11">
					<InputGroupInput
						type="search"
						autoFocus={hasFinePointer}
						value={query}
						onChange={event => {
							setQuery(event.target.value)
							setActiveIndex(0)
						}}
						onKeyDown={handleSearchKeyDown}
						placeholder={`${searchLabel}…`}
						aria-label={searchLabel}
						aria-controls={listId}
						aria-activedescendant={
							activeItem ? `${listId}-${activeItem.id}` : undefined
						}
						aria-expanded={open}
						role="combobox"
						spellCheck={false}
						className="h-full text-base md:text-sm"
					/>
					<InputGroupAddon>
						<Search className="size-4" />
					</InputGroupAddon>
					<InputGroupAddon align="inline-end">
						<DialogClose
							render={<InputGroupButton size="icon-sm" aria-label="Close" />}
						>
							<X />
						</DialogClose>
					</InputGroupAddon>
				</InputGroup>
				<div
					id={listId}
					ref={listRef}
					role="listbox"
					className="max-h-[min(28rem,70dvh)] overflow-auto py-1"
				>
					{filtered.length === 0 && (
						<p className="text-muted-foreground px-3 py-8 text-center text-sm">
							{emptyLabel}
						</p>
					)}
					{filtered.map((item, index) => (
						<button
							key={item.id}
							id={`${listId}-${item.id}`}
							type="button"
							role="option"
							tabIndex={-1}
							aria-selected={index === selectedIndex}
							data-active={index === selectedIndex}
							className="hover:bg-accent data-[active=true]:bg-accent flex min-h-11 w-full items-center gap-3 px-3 text-left text-sm outline-none"
							onMouseEnter={() => setActiveIndex(index)}
							onClick={() => handleSelect(item)}
						>
							<span
								className="min-w-0 flex-1 truncate"
								style={{ paddingLeft: `${Math.min(item.indent ?? 0, 4)}rem` }}
							>
								{item.label}
							</span>
							{item.detail && (
								<span className="text-muted-foreground shrink-0 text-xs">
									{item.detail}
								</span>
							)}
							{item.group && (
								<span className="text-muted-foreground text-xs">
									{item.group}
								</span>
							)}
							{item.shortcutId && (
								<Kbd>{getShortcutLabel(item.shortcutId)}</Kbd>
							)}
						</button>
					))}
				</div>
			</DialogContent>
		</Dialog>
	)
}

function ShortcutsDialog({ open, onOpenChange, onRun }: CommandOverlayProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[85vh] max-w-2xl overflow-auto">
				<DialogHeader>
					<DialogTitle>Keyboard shortcuts</DialogTitle>
				</DialogHeader>
				{(
					["Authoring", "Editing", "Navigation", "Document"] as ShortcutGroup[]
				).map(group => (
					<section key={group}>
						<h3 className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
							{group}
						</h3>
						<div className="divide-border divide-y">
							{shortcuts
								.filter(item => item.group === group)
								.map(shortcut => (
									<button
										key={shortcut.id}
										type="button"
										className="hover:bg-accent flex min-h-11 w-full items-center gap-3 px-2 text-left text-sm"
										onClick={() => {
											onRun(shortcut.id)
											onOpenChange(false)
										}}
									>
										<span className="flex-1">{shortcut.label}</span>
										<Kbd>{getShortcutLabel(shortcut.id)}</Kbd>
									</button>
								))}
						</div>
					</section>
				))}
			</DialogContent>
		</Dialog>
	)
}

function groupFor(id: ShortcutId): ShortcutGroup {
	if (authoring.has(id)) return "Authoring"
	if (editing.has(id)) return "Editing"
	if (navigation.has(id)) return "Navigation"
	return "Document"
}

function humanize(value: string): string {
	let words = value
		.replace(/([a-z\d])([A-Z])/g, "$1 $2")
		.replace(/(\d+)/g, " $1")
	return words.charAt(0).toUpperCase() + words.slice(1)
}
