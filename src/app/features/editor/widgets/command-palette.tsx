import { useRef, useState } from "react"
import { Search } from "lucide-react"
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/app/components/ui/dialog"
import { Kbd } from "@/app/components/ui/kbd"
import {
	getShortcutDefinitions,
	getShortcutLabel,
	type ShortcutId,
} from "@/app/lib/shortcut-registry"

export { CommandPalette, ShortcutsDialog }
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
	let [query, setQuery] = useState("")
	let inputRef = useRef<HTMLInputElement>(null)
	let filtered = paletteCommands.filter(shortcut =>
		`${shortcut.label} ${shortcut.group}`
			.toLowerCase()
			.includes(query.toLowerCase()),
	)

	function handleOpenChange(nextOpen: boolean) {
		if (!nextOpen) setQuery("")
		onOpenChange(nextOpen)
	}

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="max-w-lg gap-2 p-2">
				<DialogHeader className="sr-only">
					<DialogTitle>Command palette</DialogTitle>
				</DialogHeader>
				<div className="border-input flex h-11 items-center gap-2 border px-3">
					<Search className="text-muted-foreground size-4" />
					<input
						ref={inputRef}
						autoFocus
						value={query}
						onChange={event => setQuery(event.target.value)}
						placeholder="Search commands…"
						aria-label="Search commands"
						className="min-w-0 flex-1 bg-transparent text-sm outline-none"
					/>
				</div>
				<div
					className="max-h-[min(28rem,70vh)] overflow-auto py-1"
					role="listbox"
				>
					{filtered.map((shortcut, index) => (
						<button
							key={shortcut.id}
							type="button"
							className="hover:bg-accent focus-visible:bg-accent flex min-h-11 w-full items-center gap-3 px-3 text-left text-sm outline-none"
							onClick={() => {
								onRun(shortcut.id)
								onOpenChange(false)
							}}
							onKeyDown={event => {
								if (event.key === "Enter") return
								if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
								event.preventDefault()
								let buttons =
									event.currentTarget.parentElement?.querySelectorAll("button")
								let next = event.key === "ArrowDown" ? index + 1 : index - 1
								buttons
									?.item((next + filtered.length) % filtered.length)
									?.focus()
							}}
						>
							<span className="min-w-0 flex-1 truncate">{shortcut.label}</span>
							<span className="text-muted-foreground text-xs">
								{shortcut.group}
							</span>
							{"shortcutId" in shortcut && (
								<Kbd>{getShortcutLabel(shortcut.shortcutId)}</Kbd>
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
