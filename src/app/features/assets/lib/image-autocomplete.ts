import {
	type CompletionContext,
	type CompletionResult,
	type Completion,
} from "@codemirror/autocomplete"
import { type Extension } from "@codemirror/state"
import { completionSource } from "@/app/lib/completion-sources"

export { createImageAutocomplete }

interface AssetInfo {
	id: string
	name: string
}

function createImageAutocomplete(getAssets: () => AssetInfo[]): Extension {
	function imageCompletionSource(
		context: CompletionContext,
	): CompletionResult | null {
		let line = context.state.doc.lineAt(context.pos)
		let textBefore = line.text.slice(0, context.pos - line.from)

		let match = textBefore.match(/!\[([^\]]*)$/)
		if (!match) return null

		let assets = getAssets()
		if (assets.length === 0) return null

		let typed = match[1].toLowerCase()
		let from = context.pos - match[1].length

		let options: Completion[] = assets
			.filter(asset => asset.name.toLowerCase().includes(typed))
			.map(asset => ({
				label: asset.name,
				type: "text",
				detail: "image",
				apply: (view, _completion, from, to) => {
					let insertText = `${asset.name}](asset:${asset.id})`
					view.dispatch({
						changes: { from, to, insert: insertText },
						selection: { anchor: from + insertText.length },
					})
				},
			}))

		if (options.length === 0) return null

		return {
			from,
			options,
			validFor: /^[^}\]]*$/,
		}
	}

	return completionSource(imageCompletionSource)
}
