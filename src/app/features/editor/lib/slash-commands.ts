import {
	startCompletion,
	type Completion,
	type CompletionContext,
} from "@codemirror/autocomplete"
import type { Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { completionSource } from "@/app/lib/completion-sources"
import { insertCodeBlock, insertMarkdownBlock, insertImage } from "./commands"
import { insertTable } from "./table-commands"

export { createSlashCommands }

interface SlashCommand {
	label: string
	detail: string
	run: (view: EditorView) => void
}

let commands: SlashCommand[] = [
	prefixCommand("Heading 1", "Large section heading", "# "),
	prefixCommand("Heading 2", "Medium section heading", "## "),
	prefixCommand("Heading 3", "Small section heading", "### "),
	prefixCommand("Paragraph", "Plain text block", ""),
	prefixCommand("Bullet list", "Unordered list", "- "),
	prefixCommand("Ordered list", "Numbered list", "1. "),
	prefixCommand("Task", "Checkbox task", "- [ ] "),
	prefixCommand("Quote", "Block quote", "> "),
	command("Code block", "Fenced code with language", view => {
		insertCodeBlock(view)
	}),
	command("Divider", "Horizontal rule", view => {
		insertMarkdownBlock("---")(view)
	}),
	command("Table", "3-column table", view => {
		insertTable(view)
	}),
	command("Image", "Choose an asset", view => {
		if (!dispatchEditorAction(view, "image")) insertImage(view)
	}),
	command("Wikilink", "Link another document", view => {
		let from = view.state.selection.main.from
		view.dispatch({
			changes: { from, insert: "[[]]" },
			selection: { anchor: from + 2 },
		})
	}),
	command("Comment", "Hidden Markdown comment", view => {
		let from = view.state.selection.main.from
		let markup = "<!-- comment -->"
		view.dispatch({
			changes: { from, insert: markup },
			selection: { anchor: from + 5, head: from + 12 },
		})
	}),
]

function createSlashCommands(): Extension {
	return [
		completionSource(getSlashCompletions),
		EditorView.updateListener.of(update => {
			if (!update.docChanged) return
			let position = update.state.selection.main.head
			let line = update.state.doc.lineAt(position)
			let before = line.text.slice(0, position - line.from)
			if (!/^\s*\/$/.test(before)) return
			queueSlashCompletion(update.view)
		}),
	]
}

function queueSlashCompletion(view: EditorView): void {
	setTimeout(() => {
		if (!view.contentDOM.isConnected) return
		let position = view.state.selection.main.head
		let line = view.state.doc.lineAt(position)
		let before = line.text.slice(0, position - line.from)
		if (/^\s*\/$/.test(before)) startCompletion(view)
	}, 400)
}

function getSlashCompletions(context: CompletionContext) {
	let line = context.state.doc.lineAt(context.pos)
	let before = line.text.slice(0, context.pos - line.from)
	let match = before.match(/^\s*\/([\w-]*)$/)
	if (!match) return null
	let slash = line.from + before.lastIndexOf("/")

	return {
		from: slash + 1,
		options: commands.map(item => ({
			label: item.label,
			detail: item.detail,
			type: "keyword",
			apply: applySlashCommand(item, slash),
		})),
		filter: true,
	}
}

function applySlashCommand(
	item: SlashCommand,
	slash: number,
): Exclude<Completion["apply"], string | undefined> {
	return (view, _completion, _from, to) => {
		view.dispatch({
			changes: { from: slash, to, insert: "" },
			selection: { anchor: slash },
		})
		item.run(view)
	}
}

function prefixCommand(
	label: string,
	detail: string,
	prefix: string,
): SlashCommand {
	return command(label, detail, view => {
		let from = view.state.selection.main.from
		view.dispatch({
			changes: { from, insert: prefix },
			selection: { anchor: from + prefix.length },
		})
	})
}

function command(
	label: string,
	detail: string,
	run: SlashCommand["run"],
): SlashCommand {
	return { label, detail, run }
}

function dispatchEditorAction(
	view: EditorView,
	action: "comment" | "image",
): boolean {
	return (
		view.dom.dispatchEvent(
			new CustomEvent("alkalye:editor-action", {
				bubbles: true,
				cancelable: true,
				detail: action,
			}),
		) === false
	)
}
