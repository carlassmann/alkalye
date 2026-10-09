import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { webCryptoLayer } from "../src/platform/web-crypto"
import {
	browserDocumentSessionLayer,
	DocumentSession,
} from "../src/client/document-session"
import { makeDocumentTransport } from "../src/client/document-transport"
import { mountEditor } from "../src/client/components/editor"
import { editorPreferences } from "../src/shared/preferences"
import { Replica } from "../src/shared/crdt"
import {
	buildAction,
	DocumentActionSchema,
	committedAction,
	restoreSnapshot,
	PermissionDenied,
	DocumentConflict,
	CommittedActionSchema,
} from "../src/shared/document-actions"
import { StoreUnavailable } from "../src/shared/document-api"
import { newDocument, setFields } from "../src/shared/documents"
import {
	BrowserJournal,
	indexedDbJournalLayer,
} from "../src/platform/indexeddb-journal"

type Check = (value: unknown, message: string) => void

export function verifyRejectedDocumentActions(subject: string, check: Check) {
	return Effect.gen(function* () {
		let remote = yield* makeDocumentTransport(location.origin, subject)
		for (let document of [
			"rejected-undo",
			"rejected-typing",
			"rejected-permission",
			"rejected-network",
			"rejected-late-receipt",
			"rejected-insertion",
			"rejected-deletion",
		])
			yield* remote.create({
				subject,
				workspace: "personal-" + subject,
				action: yield* buildAction(
					new Replica(subject + "-" + document + "-birth"),
					document,
					"Create",
					staged =>
						newDocument(
							staged,
							document,
							"Untitled",
							document === "rejected-deletion" ? "AXB" : "AB",
						),
				),
			})
		let loseWithdrawalResponse = true
		let withdrawalAttempts: string[] = []
		let options = {
			document: "rejected-undo",
			subject,
			transport: {
				...remote,
				withdraw: (action: Parameters<typeof remote.withdraw>[0]) =>
					remote.withdraw(action).pipe(
						Effect.andThen(
							Effect.suspend(() => {
								withdrawalAttempts.push(JSON.stringify(action))
								if (!loseWithdrawalResponse) return Effect.void
								loseWithdrawalResponse = false
								return Effect.fail(new Error("Lost withdrawal response"))
							}),
						),
					),
			},
		}
		let preserved = yield* Effect.scoped(
			DocumentSession.use(session =>
				Effect.gen(function* () {
					let original = yield* session.change("Source and mode", staged => [
						staged.edit(options.document, "AXB"),
						staged.set(options.document, "mode", "slideshow"),
					])
					yield* session.sync
					let fact = yield* remote.action(options.document, original.id)
					let before = new Replica(session.replica.actor)
					before.restore(session.replica.checkpoint())
					let undo = yield* session.compensate(fact)
					let undoFact = yield* committedAction(
						before,
						undo,
						subject,
						fact,
					).pipe(Effect.provide(webCryptoLayer))
					let redo = yield* session.compensate(undoFact)
					let later = yield* session.change("Independent note", staged => [
						staged.set(options.document, "presentationNote", "Keep me"),
					])
					yield* remote.commit(
						yield* buildAction(
							yield* restoreSnapshot(
								yield* remote.snapshot(options.document),
								subject + "-rejected-undo-peer",
							),
							options.document,
							"Peer mode",
							staged => [staged.set(options.document, "mode", "teleprompter")],
						),
					)
					let lost = yield* session.sync.pipe(Effect.result)
					check(
						lost._tag === "Failure" &&
							session.rejected().length === 2 &&
							session.rejected().every(item => !item.withdrawn) &&
							session.pending()[0]?.id === later.id,
						"a lost withdrawal response preserves the rejected chain and exact healthy proposal",
					)
					yield* session.sync
					check(
						!session.pending().length &&
							session.rejected().length === 2 &&
							session.replica.text(options.document) === "AXB" &&
							session.replica.fields(options.document).mode === "teleprompter",
						"a real stale undo quarantines its dependent redo and restores current accepted state",
					)
					check(
						session
							.rejected()
							.map(item => item.action.id)
							.join() === [undo.id, redo.id].join() &&
							session
								.rejected()
								.every(
									item =>
										item.withdrawn === true &&
										item.root === undo.id &&
										item.failure._tag === "UndoUnavailable" &&
										item.failure.reason === "Stale",
								),
						"rejection preserves both exact proposals and their typed root failure",
					)
					check(
						(yield* remote.action(options.document, later.id)).changes[0]
							?.value === "Keep me",
						"a later independent action synchronizes past a definitely rejected undo",
					)
					let retry = yield* session.commit(undo).pipe(Effect.result)
					check(
						retry._tag === "Failure" &&
							Schema.is(
								Schema.Struct({ _tag: Schema.Literal("UndoUnavailable") }),
							)(retry.failure),
						"retrying an exact quarantined proposal reports its recorded failure",
					)
					let blocked = yield* session.compensate(undoFact).pipe(Effect.result)
					check(
						blocked._tag === "Failure" &&
							Schema.is(
								Schema.Struct({ _tag: Schema.Literal("UndoUnavailable") }),
							)(blocked.failure),
						"a new redo referencing a quarantined action fails explicitly",
					)
					check(
						withdrawalAttempts.length === 3 &&
							withdrawalAttempts[0] === withdrawalAttempts[1],
						"withdrawal retries submit the exact same original bytes after a lost response",
					)
					yield* session.save
					return session.rejected()
				}),
			).pipe(Effect.provide(browserDocumentSessionLayer(options))),
		)
		let getAll = IDBObjectStore.prototype.getAll
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				IDBObjectStore.prototype.getAll = getAll
			}),
		)
		let readsFromStart = 0
		IDBObjectStore.prototype.getAll = function (query, count) {
			if (
				this.name === "positions" &&
				this.transaction.db.name === database(options) &&
				query instanceof IDBKeyRange &&
				query.lower === 0
			)
				readsFromStart++
			return getAll.call(this, query, count)
		}
		let downloads = 0
		yield* Effect.scoped(
			DocumentSession.use(session =>
				Effect.sync(() =>
					check(
						JSON.stringify(session.rejected()) === JSON.stringify(preserved) &&
							session.replica.text(options.document) === "AXB" &&
							!session.pending().length &&
							downloads === 0 &&
							readsFromStart === 0,
						"cold offline reopening retains rejection forensics without downloading state or history",
					),
				),
			).pipe(
				Effect.provide(
					browserDocumentSessionLayer({
						...options,
						transport: {
							...remote,
							snapshot: () =>
								Effect.sync(() => {
									downloads++
									throw new Error("Offline snapshot")
								}),
							history: () =>
								Effect.sync(() => {
									downloads++
									throw new Error("Offline history")
								}),
						},
					}),
				),
			),
		)

		IDBObjectStore.prototype.getAll = getAll
		let withdrawals = 0
		yield* Effect.scoped(
			DocumentSession.use(session =>
				Effect.gen(function* () {
					yield* session.sync
					check(
						withdrawals === 0 &&
							session.rejected().every(item => item.withdrawn),
						"a cold synchronized reopening does not resubmit acknowledged withdrawals",
					)
				}),
			).pipe(
				Effect.provide(
					browserDocumentSessionLayer({
						...options,
						transport: {
							...remote,
							withdraw: action =>
								remote
									.withdraw(action)
									.pipe(Effect.tap(() => Effect.sync(() => withdrawals++))),
						},
					}),
				),
			),
		)

		yield* Effect.scoped(
			DocumentSession.use(session =>
				Effect.gen(function* () {
					let first = preserved[0]
					if (!first) return yield* Effect.die("Missing withdrawn proposal")
					let before = JSON.stringify(session.replica.checkpoint())
					let result = yield* session.sync.pipe(Effect.result)
					check(
						result._tag === "Failure" &&
							JSON.stringify(session.replica.checkpoint()) === before &&
							session.rejected().length === preserved.length,
						"accepted history cannot resurrect an acknowledged withdrawn proposal",
					)
				}),
			).pipe(
				Effect.provide(
					browserDocumentSessionLayer({
						...options,
						transport: {
							...remote,
							history: (document, after, log, limit) =>
								Effect.gen(function* () {
									let first = preserved[0]
									if (!first)
										return yield* Effect.die("Missing withdrawn proposal")
									let real = yield* remote.history(document, after, log, limit)
									return [
										...real,
										{
											position: after + 1,
											action: Schema.decodeUnknownSync(CommittedActionSchema)({
												...first.action,
												subject,
												before: [],
											}),
										},
									]
								}),
						},
					}),
				),
			),
		)

		yield* BrowserJournal.use(storage =>
			Effect.gen(function* () {
				let cached = yield* storage.cache
				if (!cached) return yield* Effect.die("Missing rejection cache")
				let value = Schema.decodeUnknownSync(
					Schema.Record(Schema.String, Schema.Unknown),
				)(cached.value)
				let items = Schema.decodeUnknownSync(Schema.Array(Schema.Unknown))(
					value.rejected,
				)
				let first = Schema.decodeUnknownSync(
					Schema.Record(Schema.String, Schema.Unknown),
				)(items[0])
				let action = Schema.decodeUnknownSync(DocumentActionSchema)(
					first.action,
				)
				yield* storage.saveCache(cached.position, {
					...value,
					rejected: [
						{ ...first, action: { ...action, label: "Corrupted cache body" } },
						...items.slice(1),
					],
				})
			}),
		).pipe(Effect.provide(indexedDbJournalLayer(database(options))))
		yield* Effect.scoped(
			DocumentSession.use(session =>
				Effect.gen(function* () {
					check(
						JSON.stringify(session.rejected()) === JSON.stringify(preserved),
						"a changed rejected cache body is repaired from its exact journal proposal",
					)
					yield* session.save
				}),
			).pipe(Effect.provide(browserDocumentSessionLayer(options))),
		)

		let rejecting = false
		let typingOptions = {
			document: "rejected-typing",
			subject,
			transport: {
				...remote,
				commit: (action: Parameters<typeof remote.commit>[0]) =>
					remote.commit(action).pipe(
						Effect.tapError(error =>
							Effect.sync(() => {
								if (
									Schema.is(
										Schema.Struct({ _tag: Schema.Literal("UndoUnavailable") }),
									)(error)
								)
									rejecting = true
							}),
						),
					),
			},
		}
		yield* Effect.scoped(
			DocumentSession.use(session =>
				Effect.gen(function* () {
					let original = yield* session.change(
						"Typed source and mode",
						staged => [
							staged.edit(typingOptions.document, "AXB"),
							staged.set(typingOptions.document, "mode", "slideshow"),
						],
					)
					yield* session.sync
					let undo = yield* session.compensate(
						yield* remote.action(typingOptions.document, original.id),
					)
					let host = document.createElement("main")
					document.body.append(host)
					yield* Effect.addFinalizer(() => Effect.sync(() => host.remove()))
					let edits: ReturnType<typeof session.edit>[] = []
					let view = mountEditor(host, {
						content: session.replica.text(typingOptions.document),
						atoms: session.replica.visible(typingOptions.document),
						editable: true,
						preferences: editorPreferences({}),
						documents: () => [],
						openDocument() {},
						isDrawing: () => false,
						openDrawing() {},
						createLinkedDocument: async () => {
							throw new Error("Unexpected link")
						},
						report(error) {
							throw error
						},
						comments: () => [],
						select() {},
						undo() {},
						requestAsset() {},
						attach() {},
						command() {},
						find() {},
						change(content, base) {
							let edit = session.edit(content, base)
							edits.push(edit)
							return edit
						},
					})
					let textarea = host.querySelector("textarea")
					if (!textarea) throw new Error("Missing actual editor")
					let transaction = IDBDatabase.prototype.transaction
					let injected = false
					yield* Effect.addFinalizer(() =>
						Effect.sync(() => {
							IDBDatabase.prototype.transaction = transaction
							host.remove()
						}),
					)
					IDBDatabase.prototype.transaction = function (
						this: IDBDatabase,
						names: string | string[],
						mode?: IDBTransactionMode,
						options?: IDBTransactionOptions,
					) {
						if (
							!injected &&
							rejecting &&
							mode === "readwrite" &&
							(typeof names === "string"
								? names === "entries"
								: Array.from(names).includes("entries")) &&
							this.name === database(typingOptions)
						) {
							injected = true
							textarea.value += "!"
							textarea.dispatchEvent(new Event("input", { bubbles: true }))
						}
						return transaction.call(this, names, mode, options)
					}
					yield* remote.commit(
						yield* buildAction(
							yield* restoreSnapshot(
								yield* remote.snapshot(typingOptions.document),
								subject + "-rejected-typing-peer",
							),
							typingOptions.document,
							"Peer mode",
							staged => [
								staged.set(typingOptions.document, "mode", "teleprompter"),
							],
						),
					)
					yield* session.sync
					IDBDatabase.prototype.transaction = transaction
					check(
						injected &&
							session.replica.text(typingOptions.document) === "AXB!" &&
							session.rejected().length === 1 &&
							session.rejected()[0]?.action.id === undo.id,
						"typing during journal persistence survives a projection swap without reproducing a rejected undo",
					)
					textarea.value += "?"
					textarea.dispatchEvent(new Event("input", { bubbles: true }))
					check(
						session.replica.text(typingOptions.document) === "AXB!?" &&
							textarea.value === "AXB!?" &&
							edits.every(edit => edit.operation?.remove.length === 0),
						"ordinary input against the stale displayed base preserves restored remote text",
					)
					let operations = edits.flatMap(edit =>
						edit.operation ? [edit.operation] : [],
					)
					check(
						operations.length === 2 &&
							new Set(operations.map(operation => operation.id)).size === 2 &&
							operations.every(
								operation =>
									!undo.changes.some(change => change.id === operation.id),
							),
						"rollback keeps draft operation identities unique and never reuses a rejected id",
					)
					yield* session.flush
					let pendingTyping = session.pending()
					yield* session.sync
					for (let operation of operations) {
						let proposal = pendingTyping.find(action =>
							action.changes.some(change => change.id === operation.id),
						)
						if (!proposal) throw new Error("Missing retained typing proposal")
						let accepted = yield* remote.action(
							typingOptions.document,
							proposal.id,
						)
						check(
							accepted.changes.some(change => change.id === operation.id) &&
								JSON.stringify(accepted.changes) ===
									JSON.stringify(proposal.changes),
							"typing retained through rollback reaches the server with its original operation identity",
						)
					}
					view.update(
						session.replica.text(typingOptions.document),
						session.replica.visible(typingOptions.document),
						true,
					)
					let deletion = yield* session.change(
						"Delete and set mode",
						staged => [
							staged.edit(typingOptions.document, "AB!?"),
							staged.set(typingOptions.document, "mode", "slideshow"),
						],
					)
					yield* session.sync
					yield* session.compensate(
						yield* remote.action(typingOptions.document, deletion.id),
					)
					view.update(
						session.replica.text(typingOptions.document),
						session.replica.visible(typingOptions.document),
						true,
					)
					textarea.dispatchEvent(new CompositionEvent("compositionstart"))
					textarea.value += "漢"
					yield* remote.commit(
						yield* buildAction(
							yield* restoreSnapshot(
								yield* remote.snapshot(typingOptions.document),
								subject + "-rejected-ime-peer",
							),
							typingOptions.document,
							"Peer mode during composition",
							staged => [
								staged.set(typingOptions.document, "mode", "teleprompter"),
							],
						),
					)
					yield* session.sync
					view.update(
						session.replica.text(typingOptions.document),
						session.replica.visible(typingOptions.document),
						true,
					)
					check(
						textarea.value === "AXB!?漢" &&
							session.replica.text(typingOptions.document) === "AB!?",
						"rollback defers updating an active IME composition while accepted text changes",
					)
					textarea.dispatchEvent(new CompositionEvent("compositionend"))
					check(
						textarea.value === "AB!?漢" &&
							session.replica.text(typingOptions.document) === "AB!?漢",
						"ending composition keeps its own input without restoring text from a rejected deletion undo",
					)
					yield* session.flush
					yield* session.sync
				}),
			).pipe(Effect.provide(browserDocumentSessionLayer(typingOptions))),
		)

		let permissionOptions = {
			document: "rejected-permission",
			subject,
			transport: remote,
		}
		yield* Effect.scoped(
			DocumentSession.use(session =>
				Effect.gen(function* () {
					let root = yield* session.change("Grant reader", staged => [
						staged.set(
							permissionOptions.document,
							"access:rejection-reader",
							"reader",
						),
					])
					let dependent = yield* session.change("Promote reader", staged => [
						staged.set(
							permissionOptions.document,
							"access:rejection-reader",
							"writer",
						),
					])
					let independent = yield* session.change(
						"Independent content",
						staged => [staged.edit(permissionOptions.document, "AB!")],
					)
					yield* remote.commit(
						yield* buildAction(
							yield* restoreSnapshot(
								yield* remote.snapshot(permissionOptions.document),
								subject + "-rejected-permission-peer",
							),
							permissionOptions.document,
							"Peer permission",
							staged => [
								staged.set(
									permissionOptions.document,
									"access:rejection-reader",
									"writer",
								),
							],
						),
					)
					yield* session.sync
					check(
						!session.pending().length &&
							session
								.rejected()
								.map(item => item.action.id)
								.join() === [root.id, dependent.id].join() &&
							session
								.rejected()
								.every(item => item.failure._tag === "AccessConflict"),
						"permission conflicts quarantine later actions that observed the rejected permission register",
					)
					check(
						(yield* remote.action(permissionOptions.document, independent.id))
							.changes[0]?.kind === "text" &&
							session.replica.text(permissionOptions.document) === "AB!",
						"permission recovery preserves and synchronizes independent source edits",
					)
				}),
			).pipe(Effect.provide(browserDocumentSessionLayer(permissionOptions))),
		)

		let pauseWithdrawal = true
		let lateOptions = {
			document: "rejected-late-receipt",
			subject,
			transport: {
				...remote,
				withdraw: (action: Parameters<typeof remote.withdraw>[0]) =>
					Effect.suspend(() =>
						pauseWithdrawal
							? Effect.fail(new Error("Withdrawal offline"))
							: remote.withdraw(action),
					),
			},
		}
		yield* Effect.scoped(
			DocumentSession.use(session =>
				Effect.gen(function* () {
					let own = "AB\n![Own](asset:late-photo)",
						peer = own + "\n![Peer](asset:late-photo)"
					let original = yield* session.change("Link an asset", staged => [
						...setFields(staged, "late-photo", {
							type: "asset",
							document: lateOptions.document,
							name: "Photo",
							blob: "retained-reference",
						}),
						staged.edit(lateOptions.document, own),
					])
					yield* session.sync
					let fact = yield* remote.action(lateOptions.document, original.id)
					let before = new Replica(session.replica.actor)
					before.restore(session.replica.checkpoint())
					let undo = yield* session.compensate(fact)
					let undoFact = yield* committedAction(
						before,
						undo,
						subject,
						fact,
					).pipe(Effect.provide(webCryptoLayer))
					let redo = yield* session.compensate(undoFact)
					let peerState = yield* restoreSnapshot(
						yield* remote.snapshot(lateOptions.document),
						subject + "-rejected-receipt-peer",
					)
					yield* remote.commit(
						yield* buildAction(
							peerState,
							lateOptions.document,
							"Peer references asset",
							staged => [staged.edit(lateOptions.document, peer)],
						),
					)
					yield* session.sync.pipe(Effect.result)
					check(
						session.rejected().length === 2 &&
							session.replica.fields("late-photo").type === "asset" &&
							session.replica.text(lateOptions.document) === peer,
						"a peer asset reference rejects the entire mixed undo and its redo",
					)
					yield* remote.commit(
						yield* buildAction(
							yield* restoreSnapshot(
								yield* remote.snapshot(lateOptions.document),
								peerState.actor,
							),
							lateOptions.document,
							"Peer removes extra reference",
							staged => [staged.edit(lateOptions.document, own)],
						),
					)
					yield* remote.commit(undo)
					yield* session.sync.pipe(Effect.result)
					check(
						session.rejected().length === 1 &&
							session.rejected()[0]?.action.id === redo.id &&
							session.replica.text(lateOptions.document) === "AB" &&
							session.replica.fields("late-photo").type === "deleted",
						"a later authoritative acceptance wins over rejection while its unaccepted dependent stays quarantined",
					)
					yield* session.save
					yield* remote.commit(redo)
					pauseWithdrawal = false
					yield* session.sync
					check(
						!session.rejected().length &&
							session.replica.text(lateOptions.document) === own &&
							session.replica.fields("late-photo").name === "Photo",
						"a dependent's own authoritative receipt also wins without silently resurrecting other proposals",
					)
				}),
			).pipe(Effect.provide(browserDocumentSessionLayer(lateOptions))),
		)
		let failure: unknown
		let networkOptions = {
			document: "rejected-network",
			subject,
			transport: {
				...remote,
				commit: (action: Parameters<typeof remote.commit>[0]) =>
					Effect.suspend(() =>
						failure ? Effect.fail(failure) : remote.commit(action),
					),
			},
		}
		yield* Effect.scoped(
			DocumentSession.use(session =>
				Effect.gen(function* () {
					let action = yield* session.change("Pending network note", staged => [
						staged.set(networkOptions.document, "presentationNote", "Pending"),
					])
					let bytes = JSON.stringify(action)
					for (let error of [
						new Error("Offline"),
						new StoreUnavailable({ message: "Server failure" }),
						new PermissionDenied({ message: "Access revoked" }),
						new DocumentConflict({ message: "Other conflict" }),
					]) {
						failure = error
						let result = yield* session.sync.pipe(Effect.result)
						check(
							result._tag === "Failure" &&
								!session.rejected().length &&
								JSON.stringify(session.pending()[0]) === bytes,
							"non-definite transport failure preserves pending bytes: " +
								error.message,
						)
					}
					failure = undefined
					yield* session.sync
					check(
						!session.pending().length &&
							(yield* remote.action(networkOptions.document, action.id)).id ===
								action.id,
						"recovering connectivity retries the same proposal identity",
					)
				}),
			).pipe(Effect.provide(browserDocumentSessionLayer(networkOptions))),
		)
		yield* BrowserJournal.use(storage =>
			Effect.gen(function* () {
				let cached = yield* storage.cache
				if (!cached) return yield* Effect.die("Missing v2 migration cache")
				let value = Schema.decodeUnknownSync(
					Schema.Record(Schema.String, Schema.Unknown),
				)(cached.value)
				let previous: Record<string, unknown> = {
					...value,
					format: "document-local-state-v2",
				}
				delete previous.rejected
				yield* storage.saveCache(cached.position, previous)
			}),
		).pipe(Effect.provide(indexedDbJournalLayer(database(networkOptions))))
		yield* Effect.scoped(
			DocumentSession.use(session =>
				Effect.gen(function* () {
					check(
						!session.pending().length &&
							session.replica.fields(networkOptions.document)
								.presentationNote === "Pending",
						"a valid v2 cache restores accepted document state directly",
					)
					yield* session.save
				}),
			).pipe(Effect.provide(browserDocumentSessionLayer(networkOptions))),
		)
		let migrated = yield* BrowserJournal.use(storage => storage.cache).pipe(
			Effect.provide(indexedDbJournalLayer(database(networkOptions))),
		)
		check(
			Schema.is(
				Schema.Struct({ format: Schema.Literal("document-local-state-v3") }),
			)(migrated?.value),
			"a valid v2 cache is rewritten as v3 at its covered journal position",
		)

		let deletingNow = false
		let deleting = {
			document: "rejected-deletion",
			subject,
			transport: {
				...remote,
				commit: (action: Parameters<typeof remote.commit>[0]) =>
					remote.commit(action).pipe(
						Effect.tapError(() =>
							Effect.sync(() => {
								deletingNow = true
							}),
						),
					),
			},
		}
		yield* Effect.scoped(
			DocumentSession.use(session =>
				Effect.gen(function* () {
					let original = yield* session.change("Delete and present", staged => [
						staged.edit(deleting.document, "AB"),
						staged.set(deleting.document, "mode", "slideshow"),
					])
					yield* session.sync
					let undo = yield* session.compensate(
						yield* remote.action(deleting.document, original.id),
					)
					let displayed = session.replica.visible(deleting.document)
					check(
						displayed.map(atom => atom.value).join("") === "AXB",
						"an optimistic undo temporarily restores the character needed by the deletion race",
					)
					let transaction = IDBDatabase.prototype.transaction
					let edit: ReturnType<typeof session.edit> | undefined
					yield* Effect.addFinalizer(() =>
						Effect.sync(() => {
							IDBDatabase.prototype.transaction = transaction
						}),
					)
					IDBDatabase.prototype.transaction = function (names, mode, options) {
						if (
							!edit &&
							deletingNow &&
							mode === "readwrite" &&
							(typeof names === "string"
								? names === "entries"
								: Array.from(names).includes("entries")) &&
							this.name === database(deleting)
						)
							edit = session.edit("AB", displayed)
						return transaction.call(this, names, mode, options)
					}
					yield* remote.commit(
						yield* buildAction(
							yield* restoreSnapshot(
								yield* remote.snapshot(deleting.document),
								subject + "-rejected-deletion-peer",
							),
							deleting.document,
							"Peer mode",
							staged => [staged.set(deleting.document, "mode", "teleprompter")],
						),
					)
					yield* session.sync
					IDBDatabase.prototype.transaction = transaction
					check(
						edit?.operation?.remove.length === 1 &&
							session.replica.text(deleting.document) === "AB" &&
							session.rejected()[0]?.action.id === undo.id,
						"deleting a character restored only by a rejected undo survives the saved-rejection replay",
					)
					yield* session.replay
					yield* session.save
					yield* session.sync
					check(
						edit?.operation &&
							(yield* remote.action(deleting.document, edit.operation.id))
								.changes[0]?.id === edit.operation.id &&
							!session.pending().length &&
							session.replica.text(deleting.document) === "AB",
						"the deletion race preserves its exact operation identity through durability and synchronization",
					)
				}),
			).pipe(Effect.provide(browserDocumentSessionLayer(deleting))),
		)

		let inserting = {
			document: "rejected-insertion",
			subject,
			transport: remote,
		}
		yield* Effect.scoped(
			DocumentSession.use(session =>
				Effect.gen(function* () {
					let root = yield* session.change("Grant", staged => [
						staged.set(inserting.document, "access:guest", "reader"),
					])
					let mixed = yield* session.change("Promote and type", staged => [
						staged.set(inserting.document, "access:guest", "writer"),
						staged.edit(inserting.document, "AB!"),
					])
					let healthy = yield* session.change("Independent note", staged => [
						staged.set(inserting.document, "note", "kept"),
					])
					let bytes = JSON.stringify(session.pending())
					yield* remote.commit(
						yield* buildAction(
							yield* restoreSnapshot(
								yield* remote.snapshot(inserting.document),
								subject + "-rejected-insertion-peer",
							),
							inserting.document,
							"Peer grant",
							staged => [
								staged.set(inserting.document, "access:guest", "writer"),
							],
						),
					)
					let result = yield* session.sync.pipe(Effect.result)
					check(
						result._tag === "Failure" &&
							Schema.is(
								Schema.Struct({ _tag: Schema.Literal("AccessConflict") }),
							)(result.failure),
						"a rejection requiring inserted-text recovery preserves its original typed failure",
					)
					check(
						!session.rejected().length &&
							JSON.stringify(session.pending()) === bytes &&
							session
								.pending()
								.map(action => action.id)
								.join() === [root.id, mixed.id, healthy.id].join(),
						"an inserted-text rejection closure preserves every exact pending action for explicit recovery",
					)
					yield* session.replay
					check(
						JSON.stringify(session.pending()) === bytes &&
							session.replica.text(inserting.document) === "AB!",
						"refused automatic rejection leaves the journal replayable without discarding typed content",
					)
				}),
			).pipe(Effect.provide(browserDocumentSessionLayer(inserting))),
		)

		let cached = yield* BrowserJournal.use(storage => storage.cache).pipe(
			Effect.provide(indexedDbJournalLayer(database(options))),
		)
		check(
			Schema.is(
				Schema.Struct({
					format: Schema.Literal("document-local-state-v3"),
					rejected: Schema.Array(
						Schema.Struct({
							withdrawn: Schema.Literal(true),
							failure: Schema.Struct({
								_tag: Schema.Literal("UndoUnavailable"),
								reason: Schema.Literal("Stale"),
							}),
						}),
					),
				}),
			)(cached?.value),
			"the accepted-state cache separately persists rejected proposals in v3",
		)
	})
}
function database(options: { subject: string; document: string }) {
	return (
		"alkalye-document-v1:" + JSON.stringify([options.subject, options.document])
	)
}
