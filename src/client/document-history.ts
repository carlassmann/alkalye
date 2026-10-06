import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type * as Context from "effect/Context"
import { CommittedActionSchema } from "../shared/document-actions"
import { historicalDocument } from "../shared/document-history"
import type { DocumentMoment } from "../shared/document-history"
import type { DocumentSession } from "./document-session"
import { BrowserStorage } from "./storage"
import type { Storage } from "./storage"

interface DocumentHistoryOptions {
	session: Pick<
		Context.Service.Shape<typeof DocumentSession>,
		"historyCursor" | "historyPage"
	> &
		Partial<Pick<Context.Service.Shape<typeof DocumentSession>, "localHistory">>
	storage: Pick<Storage, "get" | "set">
	subject: string
	document: string
	online(): boolean
}

let HistorySchema = Schema.Array(
	Schema.Struct({
		position: Schema.Natural,
		action: CommittedActionSchema,
	}),
)

export function loadDocumentHistory(
	session: Context.Service.Shape<typeof DocumentSession>,
	subject: string,
	document: string,
) {
	return Effect.gen(function* () {
		let storage = yield* BrowserStorage
		return yield* downloadDocumentHistory({
			session,
			storage,
			subject,
			document,
			online: () => navigator.onLine,
		})
	})
}

export function downloadDocumentHistory(options: DocumentHistoryOptions) {
	return Effect.gen(function* () {
		let { session, storage, subject, document } = options
		let local = yield* session.localHistory?.() ?? Effect.succeed(undefined)
		if (local)
			return {
				moments: local,
				complete: true,
				at: (position: number) => historicalDocument(document, local, position),
			}
		let cursor = session.historyCursor()
		let key = "document-history:" + subject + ":" + document + ":" + cursor.log
		let cached = yield* storage
			.get(key)
			.pipe(Effect.catch(() => Effect.succeed(undefined)))
		let moments: DocumentMoment[] = [
			...(yield* Schema.decodeUnknownEffect(HistorySchema)(cached).pipe(
				Effect.catch(() => Effect.succeed([])),
			)),
		]
		let downloaded = moments.at(-1)?.position ?? 0
		while (options.online() && downloaded < cursor.position) {
			let page = yield* session.historyPage(downloaded).pipe(Effect.result)
			if (page._tag === "Failure") {
				if (!moments.length) return yield* Effect.fail(page.failure)
				break
			}
			if (!page.success.length) break
			for (let moment of page.success) {
				if (moment.position > cursor.position) break
				if (moment.position <= downloaded)
					return yield* Effect.fail(
						new Error("Document history is out of order"),
					)
				moments.push(moment)
				downloaded = moment.position
			}
			yield* storage
				.set(key, moments)
				.pipe(
					Effect.catch(() =>
						Effect.logWarning("Could not cache document history"),
					),
				)
		}
		if (!moments.length)
			return yield* Effect.fail(
				new Error("Reconnect to download this document's history"),
			)
		return {
			moments,
			complete: downloaded >= cursor.position,
			at: (position: number) => historicalDocument(document, moments, position),
		}
	})
}
