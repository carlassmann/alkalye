import { StateEffect } from "@codemirror/state"
import { type ViewUpdate } from "@codemirror/view"

export { refreshDocumentLinks, hasDocumentLinksRefresh }

let refreshDocumentLinks = StateEffect.define<null>()

function hasDocumentLinksRefresh(update: ViewUpdate): boolean {
	return update.transactions.some(transaction =>
		transaction.effects.some(effect => effect.is(refreshDocumentLinks)),
	)
}
