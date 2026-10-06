import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FiberSet from "effect/FiberSet"
import * as Stream from "effect/Stream"
import * as Schema from "effect/Schema"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpApiClient from "effect/http-api/HttpApiClient"
import { Storage } from "../src/client/storage"
import {
	browserDocumentSessionLayer,
	DocumentSession,
} from "../src/client/document-session"
import type { DocumentTransport } from "../src/client/document-session"
import { makeDocumentTransport } from "../src/client/document-transport"
import { mountEditor } from "../src/client/components/editor"
import { editorPreferences } from "../src/shared/preferences"
import { DocumentApi } from "../src/shared/document-api"
import {
	CommittedActionSchema,
	DocumentConflict,
	DocumentHistoryUnavailable,
	DocumentSnapshotSchema,
	buildAction,
	restoreSnapshot,
} from "../src/shared/document-actions"
import type { CommittedAction } from "../src/shared/document-actions"
import { Replica } from "../src/shared/crdt"
import { AuthenticationRequired } from "../src/shared/authentication"
import { newComment, newDocument } from "../src/shared/documents"
import {
	verifyColdDocumentReplay,
	verifyConcurrentDocumentActions,
	verifyDocumentActionRecovery,
} from "./browser-document-actions"
import { verifyLocalFileSync } from "./browser-local-file-sync"
import { verifyDocumentSessionRecovery } from "./browser-document-recovery"
import { verifyDocumentSessionClosing } from "./browser-document-closing"
import { verifyLocalDocumentCreation } from "./browser-document-creation"
import { verifyAcceptedDocumentSnapshots } from "./browser-document-snapshots"
import { verifyReceivedDocumentBatches } from "./browser-document-batches"
import { verifyDocumentOpeningRace } from "./browser-document-opening"
import { verifyDocumentIndex } from "./browser-document-index"
import { verifyDocumentDiscussion } from "./browser-document-discussion"
import { verifyReceivedDocumentCompensations } from "./browser-document-undo"
import { verifyDocumentUndo } from "./browser-native-undo"
import { verifyRejectedDocumentActions } from "./browser-document-rejection"
import { verifyDocumentBlobs } from "./browser-document-blobs"
import { verifyCommentDialogLifetime } from "./browser-comment-dialogs"
import {
	bootstrapBrowserAccount,
	verifyBrowserAccountIsolation,
	verifyPersistentBrowserLogout,
} from "./browser-account-fixture"

declare global {
	interface Window {
		documentApiResults: string[]
		documentApiFailure?: string
		documentApiDone: boolean
		documentApiMeasurements?: {
			snapshotDownloadMilliseconds: number
			restoreMilliseconds: number
			encodedBodySize: number | undefined
			decodedBodySize: number | undefined
		}
	}
}
window.documentApiResults = []
window.documentApiDone = false
function check(value: unknown, message: string) {
	if (!value) throw new Error(message)
	window.documentApiResults.push(message)
}
let test = Effect.scoped(
	Effect.gen(function* () {
		let identity = yield* bootstrapBrowserAccount(check)
		let api = yield* HttpApiClient.make(DocumentApi, {
			baseUrl: location.origin,
		})
		check(
			!document.cookie.includes("alkalye-session"),
			"native browser session stays HttpOnly",
		)
		yield* api.workspaces.create({
			payload: {
				workspace: "browser-workspace",
				name: "Browser workspace",
				request: "create",
			},
		})
		let source =
			"---\ntitle: Browser source\npath: Writing\n---\nQuote\n" +
			"Paragraph text.\n".repeat(3125)
		let action = yield* buildAction(
			new Replica(identity.subject + "-browser-document-writer"),
			"browser-document",
			"Create document",
			staged => newDocument(staged, "browser-document", "Untitled", source),
		)
		let position = yield* api.documents.create({
			payload: { workspace: "browser-workspace", action },
		})
		let snapshotStarted = performance.now()
		let snapshot = yield* api.documents.snapshot({
			params: { document: "browser-document" },
		})
		let snapshotDownloadMilliseconds = performance.now() - snapshotStarted
		check(
			snapshot.position === position,
			"typed browser client opens document from current snapshot",
		)
		let replica = yield* restoreSnapshot(
			snapshot,
			identity.subject + "-browser-document-writer",
		)
		let comment = yield* buildAction(
			replica,
			"browser-document",
			"Comment",
			staged =>
				newComment(
					staged,
					"browser-comment",
					"browser-document",
					"Quote",
					"Discussion",
					"Browser writer",
				),
		)
		yield* api.documents.commit({
			params: { document: "browser-document" },
			payload: comment,
		})
		let current = yield* api.documents.snapshot({
			params: { document: "browser-document" },
		})
		let sidebar = yield* api.workspaces.snapshot({
			params: { workspace: "browser-workspace" },
		})
		check(
			sidebar.documents[0]?.metadata.title === "Browser source",
			"browser sidebar projection derives title from frontmatter",
		)
		let history = yield* api.documents.history({
			params: { document: "browser-document" },
			query: { after: snapshot.position, log: snapshot.log },
		})
		check(
			history.length === 1 && history[0]?.action.label === "Comment",
			"history is downloaded separately from document open",
		)
		let storage = yield* Effect.acquireRelease(Storage.open(), storage =>
			Effect.sync(() => storage.close()),
		)
		let cacheKey = `document-snapshot:${identity.subject}:browser-document`
		yield* storage.set(cacheKey, current)
		let cached = Schema.decodeUnknownSync(DocumentSnapshotSchema)(
			yield* storage.get(cacheKey),
		)
		let restoreStarted = performance.now()
		let offline = yield* restoreSnapshot(cached, "offline-reader")
		let restoreMilliseconds = performance.now() - restoreStarted
		let download = performance
			.getEntriesByType("resource")
			.find(entry =>
				entry.name.endsWith("/api/documents/browser-document/snapshot"),
			)
		window.documentApiMeasurements = {
			snapshotDownloadMilliseconds,
			restoreMilliseconds,
			encodedBodySize:
				download instanceof PerformanceResourceTiming
					? download.encodedBodySize
					: undefined,
			decodedBodySize:
				download instanceof PerformanceResourceTiming
					? download.decodedBodySize
					: undefined,
		}
		check(
			offline.text("browser-document") === source,
			"browser IndexedDB restores a 50,000-character document without fetching history",
		)
		check(
			offline.fields("browser-comment").body === "Discussion",
			"cached whole-document state includes comments",
		)
		let remote: DocumentTransport = yield* makeDocumentTransport(
			location.origin,
			identity.subject,
		)
		let online = true
		let snapshotRequests = 0
		let historyRequests = 0
		let commitRequests = 0
		let loseReceipt = false
		let receiptUnavailable = false
		let injectedAction: CommittedAction | undefined
		let epochChanged = false
		let transport: DocumentTransport = {
			snapshot(document) {
				return Effect.suspend(() => {
					snapshotRequests++
					return online ? remote.snapshot(document) : Effect.fail("offline")
				})
			},
			commit(action) {
				return Effect.gen(function* () {
					if (!online) return yield* Effect.fail("offline")
					commitRequests++
					let position = yield* remote.commit(action)
					if (loseReceipt) {
						loseReceipt = false
						receiptUnavailable = true
					}
					return position
				})
			},
			history(document, after, log, limit) {
				return Effect.suspend(() => {
					historyRequests++
					if (epochChanged) {
						epochChanged = false
						return Effect.fail(
							new DocumentHistoryUnavailable({
								document,
								reason: "EpochChanged",
								position: after,
								message: "Injected epoch change",
							}),
						)
					}
					if (injectedAction) {
						let action = injectedAction
						injectedAction = undefined
						return Effect.succeed([{ position: after + 1, action }])
					}
					if (receiptUnavailable) {
						receiptUnavailable = false
						return Effect.fail("receipt response lost")
					}
					return online
						? remote.history(document, after, log, limit)
						: Effect.fail("offline")
				})
			},
		}
		let options = {
			document: "browser-document",
			subject: identity.subject,
			author: "Native writer",
			transport,
		}
		let saved = yield* Effect.gen(function* () {
			let session = yield* DocumentSession
			check(
				snapshotRequests === 1 && historyRequests === 0,
				"document session opens from one snapshot without requesting history",
			)
			let host = document.createElement("main")
			document.body.append(host)
			yield* Effect.addFinalizer(() => Effect.sync(() => host.remove()))
			let writes = yield* FiberSet.make<unknown, unknown>()
			let fork = yield* FiberSet.runtime(writes)<never>()
			let view = mountEditor(host, {
				content: session.replica.text(options.document),
				atoms: session.replica.visible(options.document),
				editable: true,
				preferences: editorPreferences({}),
				documents: () => session.replica.documents("browser-workspace"),
				isDrawing: id => session.replica.fields(id).type === "whiteboard",
				openDrawing() {},
				openDocument() {},
				createLinkedDocument: async () => {
					throw new Error("Unexpected linked document creation")
				},
				report(error) {
					throw error
				},
				comments: () => [],
				change(content, base) {
					let edit = session.edit(content, base)
					fork(edit.saved)
					view.update(session.replica.text(options.document), edit.atoms, true)
					return edit
				},
				undo() {},
				select() {},
				requestAsset() {},
				attach() {},
				command() {},
				find() {},
			})
			online = false
			let editor = host.querySelector("textarea")
			if (!(editor instanceof HTMLTextAreaElement))
				return yield* Effect.die("Editor missing")
			editor.value += "\nOffline editor change"
			editor.dispatchEvent(new Event("input", { bubbles: true }))
			yield* FiberSet.awaitEmpty(writes)
			check(
				session.pending().length === 1,
				"real editor input persists an exact whole-document action locally while offline",
			)
			let transaction = IDBDatabase.prototype.transaction
			let failWrite = true
			IDBDatabase.prototype.transaction = function (
				this: IDBDatabase,
				names: string | string[],
				mode?: IDBTransactionMode,
				options?: IDBTransactionOptions,
			) {
				if (failWrite && this.name.startsWith("alkalye-document-v1:")) {
					failWrite = false
					throw new DOMException(
						"Injected document storage failure",
						"UnknownError",
					)
				}
				return transaction.call(this, names, mode, options)
			}
			yield* Effect.addFinalizer(() =>
				Effect.sync(() => {
					IDBDatabase.prototype.transaction = transaction
				}),
			)
			editor.value += "\nRetry this failed save"
			editor.dispatchEvent(new Event("input", { bubbles: true }))
			yield* FiberSet.awaitEmpty(writes)
			check(
				session.unsaved() === 1 && !!session.failures.current().save,
				"a failed IndexedDB save retains the optimistic edit and reports an unsaved failure",
			)
			IDBDatabase.prototype.transaction = transaction
			editor.value += "\nNext editor input"
			editor.dispatchEvent(new Event("input", { bubbles: true }))
			yield* FiberSet.awaitEmpty(writes)
			check(
				session.unsaved() === 0 &&
					session.pending().length === 3 &&
					!session.failures.current().save,
				"the next input retries earlier unsaved edits in order before saving itself",
			)
			let beforeLargePaste = session.replica.text(options.document)
			editor.value += "x".repeat(200_001)
			editor.dispatchEvent(new Event("input", { bubbles: true }))
			yield* FiberSet.awaitEmpty(writes)
			check(
				session.replica.text(options.document) === beforeLargePaste &&
					editor.value === beforeLargePaste &&
					session.unsaved() === 0,
				"an oversized paste fails before optimistic mutation and cannot block the save queue",
			)
			editor.value += "\nValid edit after rejected paste"
			editor.dispatchEvent(new Event("input", { bubbles: true }))
			yield* FiberSet.awaitEmpty(writes)
			check(
				session.pending().length === 4 &&
					session.replica
						.text(options.document)
						.endsWith("Valid edit after rejected paste"),
				"a normal editor input still saves after a permanently invalid paste",
			)
			let action = session.pending()[0]
			if (!action) return yield* Effect.die("Missing pending action")
			let invalidLabel = yield* session
				.commit({ ...action, label: "" })
				.pipe(Effect.result)
			check(
				invalidLabel._tag === "Failure" &&
					session.unsaved() === 0 &&
					session.pending().length === 4,
				"an invalid action label fails without poisoning the queue or pending actions",
			)
			let failCache = true
			IDBDatabase.prototype.transaction = function (
				this: IDBDatabase,
				names: string | string[],
				mode?: IDBTransactionMode,
				options?: IDBTransactionOptions,
			) {
				if (
					failCache &&
					mode === "readwrite" &&
					names.includes("cache") &&
					this.name.startsWith("alkalye-document-v1:")
				) {
					failCache = false
					throw new DOMException("Injected cache failure", "UnknownError")
				}
				return transaction.call(this, names, mode, options)
			}
			let cacheEdit = session.edit(
				session.replica.text(options.document) + "\nCache recovery",
			)
			yield* cacheEdit.saved
			yield* session.failures.changes.pipe(
				Stream.filter(value => !!value.snapshot),
				Stream.take(1),
				Stream.runDrain,
				Effect.timeout("5 seconds"),
			)
			check(
				!session.failures.current().save &&
					!!session.failures.current().snapshot,
				"a derived cache failure does not turn durable source into unsaved work",
			)
			IDBDatabase.prototype.transaction = transaction
			yield* session.edit(
				session.replica.text(options.document) + "\nSuccessful cache retry",
			).saved
			yield* session.failures.changes.pipe(
				Stream.filter(value => !value.snapshot),
				Stream.take(1),
				Stream.runDrain,
				Effect.timeout("5 seconds"),
			)
			check(
				!session.failures.current().snapshot,
				"a successful background cache save clears its earlier transient failure",
			)
			yield* session.save
			return { action, source: session.replica.text(options.document) }
		}).pipe(Effect.scoped, Effect.provide(browserDocumentSessionLayer(options)))
		yield* Effect.scoped(
			Effect.gen(function* () {
				let session = yield* DocumentSession
				check(
					snapshotRequests === 1 &&
						session.replica.text(options.document) === saved.source &&
						session.pending()[0]?.id === saved.action.id,
					"offline reopening restores cached source and original pending action without network access",
				)
				check(
					session.replica.actor !== saved.action.actor,
					"a reopened tab has a separate actor and preserves the previous tab's pending actor",
				)
				online = true
				yield* session.sync
				check(
					session.pending().length === 0,
					"reconnect removes pending work only after reading the authoritative receipt",
				)
				let current = yield* remote.snapshot(options.document)
				let restored = yield* restoreSnapshot(current, "session-reader")
				check(
					restored.text(options.document) === saved.source &&
						restored.fields("browser-comment").body === "Discussion",
					"reconnected server state preserves edited source and existing comments",
				)
				let replayed = yield* session.commit(saved.action).pipe(Effect.result)
				check(
					replayed._tag === "Success" && session.pending().length === 0,
					"a duplicate local proposal does not resurrect already accepted work",
				)
				let changed = yield* session
					.commit({ ...saved.action, label: "Changed identity" })
					.pipe(Effect.result)
				check(
					changed._tag === "Failure" && session.pending().length === 0,
					"reusing a proposal identity with different content is rejected without changing pending work",
				)
				let edit = session.edit(saved.source + "\nLost receipt")
				if (!edit.operation)
					return yield* Effect.die("Missing lost-receipt edit")
				yield* edit.saved
				loseReceipt = true
				let interrupted = yield* session.sync.pipe(Effect.result)
				check(
					interrupted._tag === "Failure" && session.pending().length === 1,
					"a lost response after server commit leaves the original action durably pending",
				)
			}).pipe(Effect.provide(browserDocumentSessionLayer(options))),
		)
		let requestsBeforeRecovery = commitRequests
		yield* Effect.scoped(
			Effect.gen(function* () {
				let session = yield* DocumentSession
				yield* session.sync
				check(
					session.pending().length === 0 &&
						commitRequests === requestsBeforeRecovery,
					"reopening after a lost receipt reconciles accepted work before attempting another write",
				)
				let poison = yield* buildAction(
					session.replica,
					options.document,
					"Poison",
					staged =>
						newComment(
							staged,
							"poison-child",
							"another-document",
							"",
							"Poison",
							"Writer",
						),
				)
				injectedAction = Schema.decodeUnknownSync(CommittedActionSchema)({
					...poison,
					subject: identity.subject,
					before: [],
				})
				let poisoned = yield* session.sync.pipe(Effect.result)
				check(
					poisoned._tag === "Failure" &&
						poisoned.failure instanceof DocumentConflict &&
						session.pending().length === 0,
					"invalid child ownership in received history fails before entering the durable journal",
				)
				yield* Effect.scoped(
					DocumentSession.use(reopened =>
						Effect.sync(() =>
							check(
								reopened.replica.text(options.document) ===
									session.replica.text(options.document),
								"a rejected history page cannot poison later document reopening",
							),
						),
					).pipe(Effect.provide(browserDocumentSessionLayer(options))),
				)
				let receiptEdit = session.edit(
					session.replica.text(options.document) + "\nReceipt equality",
				)
				if (!receiptEdit.operation)
					return yield* Effect.die("Missing receipt edit")
				yield* receiptEdit.saved
				let pending = session.pending()[0]
				if (!pending) return yield* Effect.die("Missing equality proposal")
				injectedAction = Schema.decodeUnknownSync(CommittedActionSchema)({
					...pending,
					subject: identity.subject,
					label: "Different label",
					before: [],
				})
				let mismatch = yield* session.sync.pipe(Effect.result)
				check(
					mismatch._tag === "Failure" &&
						mismatch.failure instanceof DocumentConflict &&
						session.pending()[0]?.id === pending.id,
					"a mismatched authoritative receipt preserves the original pending action",
				)
				epochChanged = true
				let epoch = yield* session.sync.pipe(Effect.result)
				check(
					epoch._tag === "Failure" &&
						epoch.failure instanceof DocumentHistoryUnavailable &&
						session.pending()[0]?.id === pending.id,
					"an epoch error remains typed and preserves pending work",
				)
				yield* session.sync
				let before = session.replica.text(options.document)
				yield* Effect.scoped(
					Effect.gen(function* () {
						let peer = yield* DocumentSession
						online = false
						let left = session.edit(before + "\nFirst tab")
						let right = peer.edit(before + "\nSecond tab")
						if (!left.operation || !right.operation)
							return yield* Effect.die("Missing simultaneous edits")
						yield* left.saved
						yield* right.saved
						yield* session.replay
						check(
							session.replica.text(options.document) ===
								peer.replica.text(options.document) &&
								session.pending().length === 2 &&
								peer.pending().length === 2,
							"two simultaneous local sessions converge while preserving both offline actions",
						)
						online = true
						let commits = commitRequests
						yield* session.sync
						yield* peer.sync
						check(
							commitRequests === commits + 2 &&
								session.pending().length === 0 &&
								peer.pending().length === 0,
							"both sessions reconcile receipts without submitting duplicate actions",
						)
					}).pipe(Effect.provide(browserDocumentSessionLayer(options))),
				)
			}).pipe(Effect.provide(browserDocumentSessionLayer(options))),
		)
		let combined = yield* Effect.scoped(
			Effect.gen(function* () {
				let session = yield* DocumentSession
				online = false
				let source = session.replica.text(options.document) + "\nMixed actions"
				let edit = session.edit(source)
				if (!edit.operation) return yield* Effect.die("Missing mixed edit")
				let actions = yield* Effect.all(
					[
						session.change("Add comment", staged =>
							newComment(
								staged,
								"mixed-comment",
								options.document,
								"Mixed actions",
								"An offline discussion",
								"Browser writer",
							),
						),
						session.change("Attach asset", staged => [
							staged.set("mixed-asset", "type", "asset"),
							staged.set("mixed-asset", "document", options.document),
							staged.set("mixed-asset", "name", "Photo.png"),
							staged.set("mixed-asset", "blob", "immutable-blob-reference"),
						]),
					],
					{ concurrency: "unbounded" },
				)
				check(
					session.unsaved() === 0 &&
						session.pending().length === 3 &&
						session.pending()[0]?.id === edit.operation.id &&
						session.replica.fields("mixed-comment").body ===
							"An offline discussion" &&
						session.replica.fields("mixed-asset").name === "Photo.png",
					"comment and asset actions flush preceding source edits and persist offline in the same document journal",
				)
				let actors = [
					edit.operation.actor,
					...actions.map(action => action.actor),
				]
				let operationIds = session
					.pending()
					.flatMap(action => action.changes.map(change => change.id))
				check(
					new Set(actors).size === 3 &&
						new Set(operationIds).size === operationIds.length,
					"concurrent action creation and source editing use distinct actors and operation identities",
				)
				check(
					session
						.pending()
						.every(action =>
							action.changes.every(change => change.author === options.author),
						),
					"source and whole-document actions preserve the session author's identity",
				)
				let before = JSON.stringify(session.replica.checkpoint())
				let invalid = yield* session
					.change("", staged => [staged.set("mixed-comment", "body", "Bad")])
					.pipe(Effect.result)
				let foreign = yield* session
					.change("Foreign document", staged => [
						staged.set("foreign-comment", "document", "another-document"),
						staged.set("foreign-comment", "body", "Bad"),
					])
					.pipe(Effect.result)
				check(
					invalid._tag === "Failure" &&
						foreign._tag === "Failure" &&
						JSON.stringify(session.replica.checkpoint()) === before &&
						session.pending().length === 3,
					"invalid and cross-document action builders leave the document and pending work unchanged",
				)
				let transaction = IDBDatabase.prototype.transaction
				let failWrite = true
				IDBDatabase.prototype.transaction = function (
					this: IDBDatabase,
					names: string | string[],
					mode?: IDBTransactionMode,
					options?: IDBTransactionOptions,
				) {
					if (
						failWrite &&
						mode === "readwrite" &&
						names.includes("entries") &&
						this.name.startsWith("alkalye-document-v1:")
					) {
						failWrite = false
						throw new DOMException(
							"Injected action write failure",
							"UnknownError",
						)
					}
					return transaction.call(this, names, mode, options)
				}
				yield* Effect.addFinalizer(() =>
					Effect.sync(() => {
						IDBDatabase.prototype.transaction = transaction
					}),
				)
				let failed = yield* session
					.change("Failed comment edit", staged => [
						staged.set("mixed-comment", "body", "Not saved"),
					])
					.pipe(Effect.result)
				check(
					failed._tag === "Failure" &&
						JSON.stringify(session.replica.checkpoint()) === before &&
						session.pending().length === 3,
					"a failed journal write cannot publish an uncommitted comment change",
				)
				let duringWrite: ReturnType<typeof session.edit> | undefined
				IDBDatabase.prototype.transaction = function (
					this: IDBDatabase,
					names: string | string[],
					mode?: IDBTransactionMode,
					options?: IDBTransactionOptions,
				) {
					if (
						!duringWrite &&
						mode === "readwrite" &&
						names.includes("entries") &&
						this.name.startsWith("alkalye-document-v1:")
					)
						duringWrite = session.edit(
							source + "\nTyped during action persistence",
						)
					return transaction.call(this, names, mode, options)
				}
				let action = yield* session.change("Resolve comment", staged => [
					staged.set("mixed-comment", "resolved", "true"),
				])
				IDBDatabase.prototype.transaction = transaction
				if (!duringWrite?.operation)
					return yield* Effect.die("Missing interleaved typing")
				check(
					session.unsaved() === 1 &&
						duringWrite.operation.id !== action.id &&
						session.replica
							.text(options.document)
							.endsWith("Typed during action persistence") &&
						session.replica.fields("mixed-comment").resolved === "true",
					"typing during an action write preserves both the optimistic source and durable comment state",
				)
				yield* duringWrite.saved
				let grant = yield* session.change("Grant reader", staged => [
					staged.set(options.document, "access:browser-guest", "reader"),
				])
				check(
					grant.accessGuards[0]?.field === "access:browser-guest" &&
						grant.accessGuards[0]?.observed === "",
					"permission actions retain the register observed in durable document state",
				)
				yield* session.save
				return {
					source: session.replica.text(options.document),
					pending: session.pending().map(action => action.id),
					grant,
				}
			}).pipe(Effect.provide(browserDocumentSessionLayer(options))),
		)
		yield* Effect.scoped(
			Effect.gen(function* () {
				let session = yield* DocumentSession
				check(
					snapshotRequests === 1 &&
						session.replica.text(options.document) === combined.source &&
						session.replica.fields("mixed-comment").resolved === "true" &&
						session.replica.fields("mixed-asset").blob ===
							"immutable-blob-reference" &&
						JSON.stringify(session.pending().map(action => action.id)) ===
							JSON.stringify(combined.pending),
					"offline reopening restores mixed document state and every original pending action identity",
				)
				let grant = session
					.pending()
					.find(action => action.id === combined.grant.id)
				check(
					grant?.actor === combined.grant.actor &&
						grant.label === "Grant reader" &&
						grant.changes[0]?.author === options.author &&
						JSON.stringify(grant.accessGuards) ===
							JSON.stringify(combined.grant.accessGuards),
					"cached reopening preserves permission action authors, identities, labels and observed guards",
				)
				online = true
				yield* session.sync
				let restored = yield* restoreSnapshot(
					yield* remote.snapshot(options.document),
					"mixed-reader",
				)
				check(
					session.pending().length === 0 &&
						restored.text(options.document) === combined.source &&
						restored.fields("mixed-comment").resolved === "true" &&
						restored.fields("mixed-asset").name === "Photo.png",
					"reconnect accepts mixed source, comment and asset actions without clock gaps or lost fields",
				)
				check(
					restored.fields(options.document)["access:browser-guest"] ===
						"reader",
					"reconnect applies the preserved permission proposal under current owner authorization",
				)
				yield* verifyDocumentSessionRecovery(check)
				yield* verifyConcurrentDocumentActions(options, check)
				yield* verifyDocumentActionRecovery(options, check)
			}).pipe(Effect.provide(browserDocumentSessionLayer(options))),
		)
		online = false
		yield* verifyColdDocumentReplay(options, check, () => snapshotRequests)
		yield* verifyLocalFileSync(identity.subject, check)
		yield* verifyDocumentSessionClosing(options, check)
		let oversized = yield* Effect.scoped(
			DocumentSession.use(() => Effect.void).pipe(
				Effect.provide(
					browserDocumentSessionLayer({ ...options, subject: "x".repeat(100) }),
				),
			),
		).pipe(Effect.result)
		check(
			oversized._tag === "Failure",
			"oversized derived actor identities fail before loading a document",
		)
		let malformed = yield* Effect.scoped(
			DocumentSession.use(() => Effect.void).pipe(
				Effect.provide(
					browserDocumentSessionLayer({
						...options,
						subject: "invalid:subject",
					}),
				),
			),
		).pipe(Effect.result)
		check(
			malformed._tag === "Failure",
			"invalid actor characters fail when opening instead of rejecting every edit",
		)
		let wrongAccount = yield* makeDocumentTransport(
			location.origin,
			"another-account",
		)
		check(
			(yield* wrongAccount.snapshot(options.document).pipe(Effect.result))
				._tag === "Failure",
			"a bound browser client rejects a different account's cookie",
		)
		yield* verifyLocalDocumentCreation(identity.subject, check)
		yield* verifyAcceptedDocumentSnapshots(identity.subject, check)
		yield* verifyReceivedDocumentBatches(identity.subject, check)
		yield* verifyDocumentOpeningRace(identity.subject, check)
		yield* verifyDocumentIndex(identity.subject, check)
		yield* verifyDocumentDiscussion(identity.subject, check)
		yield* verifyDocumentBlobs(identity, check)
		yield* verifyReceivedDocumentCompensations(identity.subject, check)
		yield* verifyRejectedDocumentActions(identity.subject, check)
		yield* verifyDocumentUndo(identity.subject, check)
		yield* verifyCommentDialogLifetime(check)
		yield* verifyBrowserAccountIsolation(identity, check)
		yield* verifyPersistentBrowserLogout(identity, check)
		let resumed = yield* identity.connect.pipe(Effect.result)
		let requested = yield* identity
			.request(Effect.succeed(true))
			.pipe(Effect.result)
		check(
			resumed._tag === "Failure" &&
				resumed.failure instanceof AuthenticationRequired &&
				requested._tag === "Failure" &&
				requested.failure instanceof AuthenticationRequired &&
				identity.state.current().status === "signedOut",
			"explicit logout prevents automatic sign-in and rejects account requests before running them",
		)
		check(
			(yield* api.documents
				.snapshot({ params: { document: "browser-document" } })
				.pipe(Effect.result))._tag === "Failure",
			"logout revokes cookie access to document snapshots",
		)
		yield* storage.set(cacheKey, undefined)
	}),
).pipe(Effect.provide(FetchHttpClient.layer))
let exit = await Effect.runPromiseExit(test)
if (Exit.isFailure(exit)) window.documentApiFailure = String(exit.cause)
window.documentApiDone = true
