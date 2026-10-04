import * as Arr from "effect/Array"
import * as Base64Url from "effect/encoding/Base64Url"
import * as Effect from "effect/Effect"
import * as EventJournal from "effect/eventlog/EventJournal"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as PubSub from "effect/PubSub"
import * as Schema from "effect/Schema"
import * as Semaphore from "effect/Semaphore"
import { DocumentJournal } from "./document-journal"
export { DocumentJournal as BrowserJournal } from "./document-journal"

let storedEntry = Schema.Struct({
	id: Schema.String,
	data: EventJournal.Entry,
}).check(
	Schema.makeFilter(
		row => row.id === row.data.idString || "Journal entry identity mismatch",
	),
)
let storedEntries = Schema.Array(storedEntry)
let storedRemote = Schema.Struct({
	remote: Schema.String,
	entry: Schema.String,
	sequence: Schema.Natural.check(
		Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER - 1),
	),
})
let storedRemotes = Schema.Array(storedRemote)
let encodeEntry = Schema.encodeSync(EventJournal.Entry)
let equalEntry = Schema.toEquivalence(EventJournal.Entry)
let positionSchema = Schema.Natural.check(
	Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
)
let storedPosition = Schema.Struct({
	position: positionSchema.check(Schema.isGreaterThan(0)),
	entry: Schema.String,
})
let storedCache = Schema.Struct({
	position: positionSchema,
	value: Schema.Unknown,
})

export function indexedDbJournalLayer(database: string) {
	return Layer.effect(EventJournal.EventJournal)(
		DocumentJournal.use(storage => Effect.succeed(storage.journal)),
	).pipe(
		Layer.provideMerge(
			Layer.effect(DocumentJournal, makeJournalStorage(database)),
		),
	)
}

export function makeIndexedDbJournal(database: string) {
	return makeJournalStorage(database).pipe(
		Effect.map(storage => storage.journal),
	)
}
function makeJournalStorage(database: string) {
	return Effect.gen(function* () {
		if (!navigator.locks)
			return yield* Effect.fail(failure("open", "Web Locks are required"))
		let locks = navigator.locks
		let db = yield* Effect.acquireRelease(open(database), db =>
			Effect.sync(() => db.close()),
		)
		let changes = yield* Effect.acquireRelease(
			PubSub.unbounded<EventJournal.Entry>(),
			PubSub.shutdown,
		)
		let semaphore = yield* Semaphore.make(1)
		let withLock = browserLock(database, locks, semaphore)
		let entries = all(db, "entries").pipe(
			Effect.flatMap(Schema.decodeUnknownEffect(storedEntries)),
			Effect.map(rows =>
				rows.map(row => row.data).sort(EventJournal.Entry.Order),
			),
			Effect.mapError(cause => failure("entries", cause)),
		)
		let journal = EventJournal.EventJournal.of({
			entries,
			write: options =>
				Effect.uninterruptibleMask(restore => {
					let entry = new EventJournal.Entry({
						id: EventJournal.makeEntryIdUnsafe(),
						event: options.event,
						primaryKey: options.primaryKey,
						payload: options.payload,
					})
					return restore(options.effect(entry)).pipe(
						Effect.tap(
							transaction(
								db,
								["entries", "positions"],
								"readwrite",
								"write",
								tx => {
									append(tx, entry)
									return () => undefined
								},
							),
						),
						Effect.tap(PubSub.publish(changes, entry)),
					)
				}),
			writeFromRemote: options =>
				Effect.gen(function* () {
					yield* Schema.decodeUnknownEffect(storedRemotes)(
						options.entries.map(({ entry, remoteSequence }) => ({
							remote: Base64Url.encode(options.remoteId),
							entry: entry.idString,
							sequence: remoteSequence,
						})),
					).pipe(Effect.mapError(cause => failure("writeFromRemote", cause)))
					let snapshot = yield* incomingRows(
						db,
						options.remoteId,
						options.entries,
					)
					let existing = (yield* decodeRows(snapshot.entries)).map(
						row => row.data,
					)
					let known = new Map(existing.map(entry => [entry.idString, entry]))
					let incoming = new Map<string, EventJournal.RemoteEntry>()
					for (let received of options.entries) {
						let previous = incoming.get(received.entry.idString)
						let saved = previous?.entry ?? known.get(received.entry.idString)
						if (saved && !equalEntry(saved, received.entry))
							return yield* Effect.fail(
								failure("writeFromRemote", "Journal entry content changed"),
							)
						if (!previous || received.remoteSequence > previous.remoteSequence)
							incoming.set(received.entry.idString, received)
					}
					let received = [...incoming.values()]
					let fresh = received.filter(({ entry }) => !known.has(entry.idString))
					let duplicateEntries = received
						.filter(({ entry }) => known.has(entry.idString))
						.map(({ entry }) => entry)
					let receipts = yield* Schema.decodeUnknownEffect(storedRemotes)(
						snapshot.remotes,
					).pipe(Effect.mapError(cause => failure("writeFromRemote", cause)))
					let sequences = new Map(
						receipts.map(row => [row.entry, row.sequence]),
					)
					let compacted = options.compact
						? yield* options.compact(fresh)
						: fresh.map(({ entry }) => entry)
					for (let entry of compacted) {
						let conflicts = yield* conflictRows(db, entry)
						yield* options.effect({ entry, conflicts })
					}
					yield* transaction(
						db,
						["entries", "remotes", "positions"],
						"readwrite",
						"writeFromRemote",
						tx => {
							for (let { entry } of fresh) append(tx, entry)
							for (let { entry, remoteSequence } of received)
								tx.objectStore("remotes").put({
									remote: Base64Url.encode(options.remoteId),
									entry: entry.idString,
									sequence: Math.max(
										remoteSequence,
										sequences.get(entry.idString) ?? 0,
									),
								})
							return () => ({ duplicateEntries })
						},
					).pipe(Effect.uninterruptible)
					return { duplicateEntries }
				}),
			withRemoteUncommited: (remoteId, effect) =>
				Effect.gen(function* () {
					let saved = yield* pendingRows(db, remoteId)
					let pending = saved
						.map(row => row.data)
						.sort(EventJournal.Entry.Order)
					return Arr.isReadonlyArrayNonEmpty(pending)
						? Option.some(yield* effect(pending))
						: Option.none()
				}),
			nextRemoteSequence: remoteId =>
				transaction(db, ["remotes"], "readonly", "nextRemoteSequence", tx => {
					let row: unknown = null
					let key = Base64Url.encode(remoteId)
					let request = tx
						.objectStore("remotes")
						.index("sequence")
						.openCursor(
							IDBKeyRange.bound([key, 0], [key, Number.MAX_SAFE_INTEGER]),
							"prev",
						)
					request.onsuccess = () => {
						row = request.result?.value ?? null
					}
					return () => row
				}).pipe(
					Effect.flatMap(
						Schema.decodeUnknownEffect(Schema.NullOr(storedRemote)),
					),
					Effect.map(row => (row === null ? 0 : row.sequence + 1)),
					Effect.mapError(cause => failure("nextRemoteSequence", cause)),
				),
			changes: PubSub.subscribe(changes),
			destroy: transaction(
				db,
				["entries", "remotes", "positions", "cache"],
				"readwrite",
				"destroy",
				tx => {
					tx.objectStore("entries").clear()
					tx.objectStore("remotes").clear()
					tx.objectStore("positions").clear()
					tx.objectStore("cache").clear()
					return () => undefined
				},
			).pipe(Effect.uninterruptible, withLock),
			withLock: () => withLock,
		})
		return {
			journal,
			readAfter: (position: number, limit?: number, through?: number) =>
				Schema.decodeUnknownEffect(
					Schema.Struct({
						position: positionSchema,
						through: Schema.optional(positionSchema),
						limit: Schema.optional(
							Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
						),
					}),
				)({ position, limit, through }).pipe(
					Effect.flatMap(({ position, limit, through }) =>
						positionedRows(db, position, limit, through),
					),
					Effect.mapError(cause => failure("readAfter", cause)),
				),
			entry: (id: string) => readEntry(db, id),
			containsPosition: (position: number) =>
				transaction(db, ["positions"], "readonly", "position", tx => {
					let present = false
					let request = tx.objectStore("positions").get(position)
					request.onsuccess = () => {
						present = request.result !== undefined
					}
					return () => present
				}),
			cache: transaction(db, ["cache"], "readonly", "cache", tx => {
				let value: unknown
				let request = tx.objectStore("cache").get("projection")
				request.onsuccess = () => {
					value = request.result
				}
				return () => value
			}).pipe(
				Effect.flatMap(
					Schema.decodeUnknownEffect(Schema.UndefinedOr(storedCache)),
				),
				Effect.mapError(cause => failure("cache", cause)),
			),
			saveCache: (position: number, value: unknown) =>
				Schema.decodeUnknownEffect(positionSchema)(position).pipe(
					Effect.flatMap(position => saveCache(db, position, value)),
					Effect.mapError(cause => failure("cache", cause)),
				),
		}
	})
}
function readEntry(db: IDBDatabase, id: string) {
	return transaction(db, ["entries"], "readonly", "entry", tx => {
		let value: unknown
		let request = tx.objectStore("entries").get(id)
		request.onsuccess = () => {
			value = request.result
		}
		return () => value
	}).pipe(
		Effect.flatMap(Schema.decodeUnknownEffect(Schema.UndefinedOr(storedEntry))),
		Effect.map(row => row?.data),
		Effect.mapError(cause => failure("entry", cause)),
	)
}

function browserLock(
	database: string,
	locks: LockManager,
	semaphore: Semaphore.Semaphore,
) {
	return function withLock<A, E, R>(effect: Effect.Effect<A, E, R>) {
		return semaphore.withPermit(
			Effect.callback<A, E, R>((resume, signal) => {
				let release: (() => void) | undefined
				locks
					.request(database, { signal }, () => {
						if (signal.aborted) return
						return new Promise<void>(finish => {
							release = finish
							resume(effect.pipe(Effect.ensuring(Effect.sync(finish))))
						})
					})
					.catch(cause => resume(Effect.die(cause)))
				return Effect.sync(() => release?.())
			}),
		)
	}
}

function row(entry: EventJournal.Entry) {
	return { id: entry.idString, data: encodeEntry(entry) }
}
function append(tx: IDBTransaction, entry: EventJournal.Entry) {
	tx.objectStore("entries").add(row(entry))
	tx.objectStore("positions").add({ entry: entry.idString })
}
function saveCache(db: IDBDatabase, position: number, value: unknown) {
	return transaction(db, ["positions", "cache"], "readwrite", "cache", tx => {
		let alive = false
		let checkedPosition = false
		let checkedCache = false
		let previous = 0
		let saved = false
		let cache = tx.objectStore("cache")
		let receipt = tx.objectStore("positions").get(position)
		let current = cache.get("projection")
		function publish() {
			if (!checkedPosition || !checkedCache || !alive || previous > position)
				return
			cache.put({ position, value }, "projection")
			saved = true
		}
		receipt.onsuccess = () => {
			// Clearing the journal preserves its key generator, so old positions cannot return.
			alive = receipt.result !== undefined
			checkedPosition = true
			publish()
		}
		current.onsuccess = () => {
			let decoded = Schema.decodeUnknownOption(storedCache)(current.result)
			if (Option.isNone(decoded)) {
				checkedCache = true
				publish()
				return
			}
			let existing = tx.objectStore("positions").get(decoded.value.position)
			existing.onsuccess = () => {
				previous = existing.result === undefined ? 0 : decoded.value.position
				checkedCache = true
				publish()
			}
		}
		return () => saved
	})
}
function failure(method: string, cause: unknown) {
	return new EventJournal.EventJournalError({ method, cause })
}
function open(database: string) {
	return Effect.callback<IDBDatabase, EventJournal.EventJournalError>(
		resume => {
			let cancelled = false
			let request = indexedDB.open(database, 2)
			request.onupgradeneeded = event => {
				let db = request.result
				if (!db.objectStoreNames.contains("entries")) {
					let entries = db.createObjectStore("entries", {
						keyPath: "id",
					})
					entries.createIndex("conflicts", [
						"data.event",
						"data.primaryKey",
						"id",
					])
					let remotes = db.createObjectStore("remotes", {
						keyPath: ["remote", "entry"],
					})
					remotes.createIndex("remote", "remote")
					remotes.createIndex("sequence", ["remote", "sequence"])
				}
				if (event.oldVersion >= 2) return
				let positions = db.createObjectStore("positions", {
					keyPath: "position",
					autoIncrement: true,
				})
				positions.createIndex("entry", "entry", { unique: true })
				db.createObjectStore("cache")
				let cursor = request.transaction?.objectStore("entries").openKeyCursor()
				if (cursor)
					cursor.onsuccess = () => {
						if (!cursor.result) return
						positions.add({ entry: cursor.result.primaryKey })
						cursor.result.continue()
					}
			}
			request.onsuccess = () => {
				let db = request.result
				db.onversionchange = () => db.close()
				if (cancelled) db.close()
				else resume(Effect.succeed(db))
			}
			request.onerror = () =>
				resume(Effect.fail(failure("open", request.error)))
			request.onblocked = () => {
				cancelled = true
				resume(Effect.fail(failure("open", "Journal upgrade is blocked")))
			}
			return Effect.sync(() => {
				cancelled = true
			})
		},
	)
}
function all(db: IDBDatabase, store: "entries") {
	return transaction(db, [store], "readonly", "read", tx => {
		let values: unknown = []
		let target = tx.objectStore(store)
		let request = target.getAll()
		request.onsuccess = () => {
			values = request.result
		}
		return () => values
	})
}
function decodeRows(rows: unknown) {
	return Schema.decodeUnknownEffect(storedEntries)(rows).pipe(
		Effect.mapError(cause => failure("decode", cause)),
	)
}

function positionedRows(
	db: IDBDatabase,
	after: number,
	limit?: number,
	through?: number,
) {
	return transaction(
		db,
		["entries", "positions"],
		"readonly",
		"readAfter",
		tx => {
			let position = after
			let rows: unknown[] = []
			let positions = tx.objectStore("positions")
			if (after > 0) {
				let covered = positions.get(after)
				covered.onsuccess = () => {
					if (covered.result === undefined) tx.abort()
				}
			}
			let range =
				through === undefined
					? IDBKeyRange.lowerBound(after, true)
					: IDBKeyRange.bound(after, through, true, false)
			let request = positions.getAll(range, limit)
			request.onsuccess = () => {
				try {
					let pointers = Schema.decodeUnknownSync(Schema.Array(storedPosition))(
						request.result,
					)
					position = pointers.at(-1)?.position ?? after
					for (let pointer of pointers) {
						let entry = tx.objectStore("entries").get(pointer.entry)
						entry.onsuccess = () => {
							rows.push(entry.result)
						}
					}
				} catch {
					tx.abort()
				}
			}
			return () => ({ position, rows })
		},
	).pipe(
		Effect.flatMap(({ position, rows }) =>
			decodeRows(rows).pipe(
				Effect.map(rows => ({ position, entries: rows.map(row => row.data) })),
			),
		),
	)
}
function incomingRows(
	db: IDBDatabase,
	remoteId: EventJournal.RemoteId,
	incoming: ReadonlyArray<EventJournal.RemoteEntry>,
) {
	return transaction(db, ["entries", "remotes"], "readonly", "incoming", tx => {
		let entries: unknown[] = []
		let remotes: unknown[] = []
		let remote = Base64Url.encode(remoteId)
		for (let { entry } of incoming) {
			let saved = tx.objectStore("entries").get(entry.idString)
			let receipt = tx.objectStore("remotes").get([remote, entry.idString])
			saved.onsuccess = () => {
				if (saved.result !== undefined) entries.push(saved.result)
			}
			receipt.onsuccess = () => {
				if (receipt.result !== undefined) remotes.push(receipt.result)
			}
		}
		return () => ({ entries, remotes })
	})
}
function conflictRows(db: IDBDatabase, entry: EventJournal.Entry) {
	return transaction(db, ["entries"], "readonly", "conflicts", tx => {
		let rows: unknown = []
		let request = tx
			.objectStore("entries")
			.index("conflicts")
			.getAll(
				IDBKeyRange.bound(
					[entry.event, entry.primaryKey, entry.idString],
					[
						entry.event,
						entry.primaryKey,
						"ffffffff-ffff-ffff-ffff-ffffffffffff",
					],
					true,
				),
			)
		request.onsuccess = () => {
			rows = request.result
		}
		return () => rows
	}).pipe(
		Effect.flatMap(decodeRows),
		Effect.map(rows => rows.map(row => row.data)),
	)
}
function pendingRows(db: IDBDatabase, remoteId: EventJournal.RemoteId) {
	return transaction(db, ["entries", "remotes"], "readonly", "pending", tx => {
		let rows: unknown[] = []
		let entryKeys: IDBValidKey[] | undefined
		let remoteKeys: IDBValidKey[] | undefined
		let entries = tx.objectStore("entries")
		let entryRequest = entries.getAllKeys()
		let remoteRequest = tx
			.objectStore("remotes")
			.index("remote")
			.getAllKeys(Base64Url.encode(remoteId))
		function readPending() {
			if (!entryKeys || !remoteKeys) return
			try {
				let decodeKey = Schema.decodeUnknownSync(
					Schema.Tuple([Schema.String, Schema.String]),
				)
				let confirmed = new Set(remoteKeys.map(key => decodeKey(key)[1]))
				let decodeId = Schema.decodeUnknownSync(Schema.String)
				for (let key of entryKeys) {
					let id = decodeId(key)
					if (confirmed.has(id)) continue
					let request = entries.get(id)
					request.onsuccess = () => {
						rows.push(request.result)
					}
				}
			} catch {
				tx.abort()
			}
		}
		entryRequest.onsuccess = () => {
			entryKeys = entryRequest.result
			readPending()
		}
		remoteRequest.onsuccess = () => {
			remoteKeys = remoteRequest.result
			readPending()
		}
		return () => rows
	}).pipe(Effect.flatMap(decodeRows))
}
function transaction<A>(
	db: IDBDatabase,
	stores: string[],
	mode: IDBTransactionMode,
	method: string,
	start: (tx: IDBTransaction) => () => A,
) {
	return Effect.callback<A, EventJournal.EventJournalError>(resume => {
		let tx: IDBTransaction | undefined
		let finished = false
		try {
			tx = db.transaction(stores, mode, { durability: "strict" })
			let result = start(tx)
			tx.oncomplete = () => {
				finished = true
				resume(
					Effect.try({ try: result, catch: cause => failure(method, cause) }),
				)
			}
			tx.onabort = () => {
				finished = true
				resume(Effect.fail(failure(method, tx?.error ?? "Transaction aborted")))
			}
		} catch (cause) {
			finished = true
			abort(tx)
			resume(Effect.fail(failure(method, cause)))
		}
		return Effect.sync(() => {
			if (!finished) abort(tx)
		})
	})
}
function abort(tx: IDBTransaction | undefined) {
	try {
		tx?.abort()
	} catch {
		// A transaction can finish before cancellation reaches it.
	}
}
