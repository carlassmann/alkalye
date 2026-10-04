import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { StorageError } from "../platform/errors"

export class Storage {
	constructor(private database: IDBDatabase) {}
	static open() {
		return Effect.gen(function* () {
			return yield* Effect.callback<Storage, StorageError>(resume => {
				let request = indexedDB.open("alkalye-native-v1", 5)
				let cancelled = false
				request.onupgradeneeded = () => {
					let database = request.result
					if (!database.objectStoreNames.contains("settings"))
						database.createObjectStore("settings")
				}
				request.onsuccess = () => {
					let database = request.result
					if (cancelled) {
						database.close()
						return
					}
					database.onversionchange = () => database.close()
					resume(Effect.succeed(new Storage(database)))
				}
				request.onerror = () =>
					resume(
						Effect.fail(
							new StorageError({ operation: "open", cause: request.error }),
						),
					)
				request.onblocked = () => {
					cancelled = true
					resume(
						Effect.fail(
							new StorageError({
								operation: "open",
								cause: new Error(
									"Close another Alkalye tab to finish the storage upgrade",
								),
							}),
						),
					)
				}
				return Effect.sync(() => {
					cancelled = true
				})
			})
		})
	}

	close() {
		this.database.close()
	}
	get(key: string) {
		return this.read<unknown>("settings", store => store.get(key))
	}
	getPrefix(prefix: string) {
		return this.read<unknown[]>("settings", store =>
			store.getAll(IDBKeyRange.bound(prefix, prefix + "\uffff")),
		)
	}
	delete(key: string) {
		return this.write("settings", transaction =>
			transaction.objectStore("settings").delete(key),
		)
	}
	modify(key: string, update: (value: unknown) => unknown) {
		return Effect.callback<boolean, StorageError>(resume => {
			let transaction: IDBTransaction | undefined
			let finished = false
			let changed = false
			function fail(cause: unknown) {
				if (finished) return
				finished = true
				transaction?.abort()
				resume(
					Effect.fail(new StorageError({ operation: "update " + key, cause })),
				)
			}
			try {
				transaction = this.database.transaction("settings", "readwrite", {
					durability: "strict",
				})
				let store = transaction.objectStore("settings")
				let request = store.get(key)
				request.onsuccess = () => {
					try {
						let next = update(request.result)
						if (next !== request.result) {
							changed = true
							if (next === undefined) store.delete(key)
							else store.put(next, key)
						}
					} catch (cause) {
						fail(cause)
					}
				}
				transaction.oncomplete = () => {
					finished = true
					resume(Effect.succeed(changed))
				}
				transaction.onabort = transaction.onerror = () => {
					if (finished) return
					finished = true
					resume(
						Effect.fail(
							new StorageError({
								operation: "update " + key,
								cause: transaction?.error,
							}),
						),
					)
				}
			} catch (cause) {
				fail(cause)
			}
			return Effect.sync(() => {
				if (!finished) transaction?.abort()
			})
		})
	}
	getOrCreate(key: string, candidate: unknown) {
		return Effect.callback<unknown, StorageError>(resume => {
			let transaction: IDBTransaction | undefined
			let finished = false
			let value: unknown
			function fail(cause: unknown) {
				if (finished) return
				finished = true
				transaction?.abort()
				resume(
					Effect.fail(
						new StorageError({ operation: "initialize " + key, cause }),
					),
				)
			}
			try {
				transaction = this.database.transaction("settings", "readwrite", {
					durability: "strict",
				})
				let store = transaction.objectStore("settings")
				let request = store.get(key)
				request.onsuccess = () => {
					try {
						value = request.result
						if (value === undefined) {
							value = candidate
							store.add(candidate, key)
						}
					} catch (cause) {
						fail(cause)
					}
				}
				transaction.oncomplete = () => {
					finished = true
					resume(Effect.succeed(value))
				}
				transaction.onabort = transaction.onerror = () => {
					if (finished) return
					finished = true
					resume(
						Effect.fail(
							new StorageError({
								operation: "initialize " + key,
								cause: transaction?.error,
							}),
						),
					)
				}
			} catch (cause) {
				fail(cause)
			}
			return Effect.sync(() => {
				if (!finished) transaction?.abort()
			})
		})
	}
	getMany(keys: string[]) {
		return Effect.callback<ReadonlyMap<string, unknown>, StorageError>(
			resume => {
				let values = new Map<string, unknown>()
				try {
					let transaction = this.database.transaction("settings")
					let store = transaction.objectStore("settings")
					for (let key of keys) {
						let request = store.get(key)
						request.onsuccess = () => {
							values.set(key, request.result)
						}
					}
					transaction.oncomplete = () => resume(Effect.succeed(values))
					transaction.onabort = transaction.onerror = () =>
						resume(
							Effect.fail(
								new StorageError({
									operation: "settings",
									cause: transaction.error,
								}),
							),
						)
					return Effect.sync(() => {
						transaction.oncomplete =
							transaction.onabort =
							transaction.onerror =
								null
					})
				} catch (cause) {
					resume(
						Effect.fail(new StorageError({ operation: "settings", cause })),
					)
				}
			},
		)
	}
	set(key: string, value: unknown) {
		return this.setMany([[key, value]])
	}
	setMany(values: [string, unknown][]) {
		return this.write("settings", transaction => {
			for (let [key, value] of values)
				transaction.objectStore("settings").put(value, key)
		})
	}
	private read<A>(
		name: string,
		read: (store: IDBObjectStore) => IDBRequest<A>,
	) {
		return Effect.callback<A, StorageError>(resume => {
			try {
				let request = read(this.database.transaction(name).objectStore(name))
				request.onsuccess = () => resume(Effect.succeed(request.result))
				request.onerror = () =>
					resume(
						Effect.fail(
							new StorageError({ operation: name, cause: request.error }),
						),
					)
				return Effect.sync(() => {
					request.onsuccess = request.onerror = null
				})
			} catch (cause) {
				resume(Effect.fail(new StorageError({ operation: name, cause })))
			}
		})
	}
	private write(
		names: string | string[],
		write: (transaction: IDBTransaction) => unknown,
	) {
		return Effect.callback<void, StorageError>(resume => {
			let transaction: IDBTransaction | undefined
			let finished = false
			try {
				transaction = this.database.transaction(names, "readwrite")
				transaction.oncomplete = () => {
					finished = true
					resume(Effect.void)
				}
				transaction.onabort = transaction.onerror = () => {
					finished = true
					resume(
						Effect.fail(
							new StorageError({
								operation: String(names),
								cause: transaction?.error,
							}),
						),
					)
				}
				write(transaction)
			} catch (cause) {
				transaction?.abort()
				finished = true
				resume(
					Effect.fail(new StorageError({ operation: String(names), cause })),
				)
			}
			return Effect.sync(() => {
				if (!finished) transaction?.abort()
			})
		})
	}
}

export class BrowserStorage extends Context.Service<BrowserStorage, Storage>()(
	"alkalye/BrowserStorage",
) {
	static layer = Layer.effect(
		BrowserStorage,
		Effect.acquireRelease(Storage.open(), storage =>
			Effect.sync(() => storage.close()),
		),
	)
}
