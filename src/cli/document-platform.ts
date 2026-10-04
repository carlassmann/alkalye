import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import * as Effect from "effect/Effect"
import * as EventJournal from "effect/eventlog/EventJournal"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import { DocumentLifecycle } from "../platform/document-lifecycle"
import { sqliteJournalLayer } from "../platform/sqlite-journal"
import {
	DocumentSession,
	documentDatabaseName,
} from "../shared/document-session"
import type { DocumentSessionOptions } from "../shared/document-session"

export function cliDocumentSessionLayer(
	directory: string,
	options: DocumentSessionOptions,
) {
	let platform = cliDocumentPlatform(directory)
	return DocumentSession.layer(options).pipe(
		Layer.provide(platform.journal(documentDatabaseName(options))),
		Layer.provide(platform.lifecycle),
	)
}

export function cliDocumentPlatform(directory: string) {
	let documents = join(directory, "documents")
	return {
		journal(database: string) {
			let name = new Bun.CryptoHasher("sha256").update(database).digest("hex")
			return Layer.unwrap(
				Effect.tryPromise({
					try: () => mkdir(documents, { recursive: true, mode: 0o700 }),
					catch: cause =>
						new EventJournal.EventJournalError({ method: "open", cause }),
				}).pipe(
					Effect.as(sqliteJournalLayer(join(documents, name + ".sqlite"))),
				),
			)
		},
		lifecycle: Layer.succeed(DocumentLifecycle, {
			hidden: Stream.never,
			changes: Stream.tick("1 second"),
			protect: () => Effect.succeed({ update() {} }),
		}),
	}
}
