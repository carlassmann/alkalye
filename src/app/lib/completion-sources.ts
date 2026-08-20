import {
	autocompletion,
	type CompletionContext,
	type CompletionResult,
} from "@codemirror/autocomplete"
import { Facet, type Extension } from "@codemirror/state"

export { completionSource, combinedAutocompletion }

type SynchronousCompletionSource = (
	context: CompletionContext,
) => CompletionResult | null

let completionSources = Facet.define<
	SynchronousCompletionSource,
	readonly SynchronousCompletionSource[]
>({
	combine: values => values,
})

function completionSource(source: SynchronousCompletionSource): Extension {
	return completionSources.of(source)
}

function combinedAutocompletion(): Extension {
	return autocompletion({
		override: [
			context => {
				for (let source of context.state.facet(completionSources)) {
					let result = source(context)
					if (result) return result
				}
				return null
			},
		],
	})
}
