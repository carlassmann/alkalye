import * as Layer from "effect/Layer"
import { indexedDbJournalLayer } from "../platform/indexeddb-journal"
import {
	DocumentSession,
	documentDatabaseName,
} from "../shared/document-session"
import type { DocumentSessionOptions } from "../shared/document-session"
import { browserDocumentLifecycle } from "./document-lifecycle"
import { browserSchedulerLayer } from "./scheduler"
export { DocumentSession } from "../shared/document-session"
export type {
	DocumentProjectionState,
	DocumentActivity,
	DocumentTransport,
	PositionedAction,
	DocumentSessionOptions,
} from "../shared/document-session"

export function browserDocumentSessionLayer(options: DocumentSessionOptions) {
	return DocumentSession.layer({
		...options,
		cooperativeWork: true,
		batchTyping: options.batchTyping ?? true,
	}).pipe(
		Layer.provide(indexedDbJournalLayer(documentDatabaseName(options))),
		Layer.provide(browserDocumentLifecycle),
		Layer.provide(browserSchedulerLayer),
	)
}
