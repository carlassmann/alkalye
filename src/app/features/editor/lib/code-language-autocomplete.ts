import {
	type Completion,
	type CompletionContext,
	type CompletionResult,
} from "@codemirror/autocomplete"
import { languages } from "@codemirror/language-data"
import { type Extension } from "@codemirror/state"
import { completionSource } from "@/app/lib/completion-sources"

export {
	createCodeLanguageAutocomplete,
	getLastCodeLanguage,
	setLastCodeLanguage,
}

let lastCodeLanguage = ""

function createCodeLanguageAutocomplete(): Extension {
	return completionSource(getCodeLanguageCompletions)
}

function getLastCodeLanguage(): string {
	return lastCodeLanguage
}

function setLastCodeLanguage(language: string): void {
	lastCodeLanguage = language
}

function getCodeLanguageCompletions(
	context: CompletionContext,
): CompletionResult | null {
	let line = context.state.doc.lineAt(context.pos)
	let before = line.text.slice(0, context.pos - line.from)
	let match = before.match(/^(`{3,}|~{3,})([\w+-]*)$/)
	if (!match) return null

	let typed = match[2]
	let options = languageOptions().filter(option =>
		option.label.toLowerCase().includes(typed.toLowerCase()),
	)
	if (options.length === 0) return null

	return {
		from: context.pos - typed.length,
		options,
		validFor: /^[\w+-]*$/,
	}
}

function languageOptions(): Completion[] {
	let seen = new Set<string>()
	let options: Completion[] = []
	for (let language of languages) {
		let label = language.alias[0] ?? language.name.toLowerCase()
		if (seen.has(label)) continue
		seen.add(label)
		options.push({
			label,
			detail: language.name,
			type: "type",
			apply: (view, _completion, from, to) => {
				setLastCodeLanguage(label)
				view.dispatch({
					changes: { from, to, insert: label },
					selection: { anchor: from + label.length },
				})
			},
		})
	}
	return options
}
