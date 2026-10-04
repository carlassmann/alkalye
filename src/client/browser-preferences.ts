import * as Context from "effect/Context"
import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as HttpClientError from "effect/http/HttpClientError"
import { DocumentConflict, PermissionDenied } from "../shared/document-errors"
import {
	acknowledgePreference,
	preferenceIntents,
	preferenceRecovery,
	preferenceValue,
	readPreferenceState,
	rejectPreference,
} from "../shared/preference-state"
import type { PreferenceState } from "../shared/preference-state"
import { withBrowserLock } from "../platform/browser-lock"
import {
	PreferencePatchSchema,
	accountPreferences,
} from "../shared/preferences"
import type { AccountPreferences, PreferencePatch } from "../shared/preferences"
import { BrowserAccount } from "./browser-account"
import { DocumentLive } from "./document-live"
import { BrowserStorage } from "./storage"

export class BrowserPreferences extends Context.Service<
	BrowserPreferences,
	Effect.Success<ReturnType<typeof makePreferences>>
>()("alkalye/BrowserPreferences") {
	static layer = Layer.effect(BrowserPreferences, makePreferences())
}
export interface BrowserPreferencesState {
	readonly value: AccountPreferences
	readonly rejected: PreferenceState["rejected"]
	readonly pending: number
	readonly status: "saved" | "offline" | "syncing" | "failed"
	readonly message?: string
}
function makePreferences() {
	return Effect.gen(function* () {
		let account = yield* BrowserAccount
		let storage = yield* BrowserStorage
		let random = yield* Crypto.Crypto
		let live = yield* DocumentLive
		let key = "account-preferences:" + account.origin + ":" + account.subject
		let state = yield* SubscriptionRef.make<BrowserPreferencesState>({
			value: accountPreferences(undefined),
			pending: 0,
			rejected: [],
			status: "offline",
		})
		let channel = yield* Effect.acquireRelease(
			Effect.sync(() => new BroadcastChannel(key)),
			channel => Effect.sync(() => channel.close()),
		)
		let load = Effect.gen(function* () {
			let stored = yield* storage.get(key)
			let decoded = readPreferenceState(stored)
			let value = preferenceValue(decoded)
			yield* SubscriptionRef.update(state, previous =>
				Object.freeze({
					...previous,
					value: Object.freeze({
						...value,
						editor: Object.freeze(value.editor),
					}),
					pending: decoded.pending.length,
					rejected: Object.freeze(preferenceRecovery(decoded)),
				}),
			)
			return decoded
		})
		function fail(error: unknown) {
			return SubscriptionRef.update(state, previous =>
				Object.freeze({
					...previous,
					status: "failed",
					message: error instanceof Error ? error.message : String(error),
				}),
			)
		}
		let sync = withBrowserLock(
			key,
			Effect.gen(function* () {
				let saved = yield* load
				if (!navigator.onLine) {
					yield* SubscriptionRef.update(state, previous =>
						Object.freeze({
							...previous,
							status: "offline",
							message: undefined,
						}),
					)
					return
				}
				yield* SubscriptionRef.update(state, previous =>
					Object.freeze({ ...previous, status: "syncing", message: undefined }),
				)
				for (let intent of preferenceIntents(saved)) {
					let result = yield* account
						.request(account.api.preferences.save({ payload: intent }))
						.pipe(Effect.result)
					if (result._tag === "Failure") {
						if (!permanentFailure(result.failure))
							return yield* Effect.fail(result.failure)
						yield* storage.modify(key, stored =>
							rejectPreference(
								readPreferenceState(stored),
								intent,
								result.failure.message,
							),
						)
					} else
						yield* storage.modify(key, stored =>
							acknowledgePreference(readPreferenceState(stored), intent),
						)
					yield* load
				}
				let accepted = yield* account.request(account.api.preferences.get())
				yield* storage.modify(key, stored => ({
					...readPreferenceState(stored),
					accepted,
				}))
				yield* load
				yield* SubscriptionRef.update(state, previous =>
					Object.freeze({
						...previous,
						status: previous.rejected.length
							? "failed"
							: previous.pending
								? "offline"
								: "saved",
						message: undefined,
					}),
				)
				channel.postMessage("accepted")
			}),
			navigator.locks,
		).pipe(Effect.catch(fail))
		yield* load.pipe(Effect.catch(fail))
		yield* Stream.fromEventListener(channel, "message").pipe(
			Stream.runForEach(() => load.pipe(Effect.catch(fail))),
			Effect.forkScoped({ startImmediately: true }),
		)
		yield* Stream.make(undefined).pipe(
			Stream.merge(
				SubscriptionRef.changes(state).pipe(
					Stream.map(state => state.pending),
					Stream.changes,
					Stream.filter(pending => pending > 0),
				),
			),
			Stream.merge(Stream.fromEventListener(window, "online")),
			Stream.merge(Stream.fromEventListener(window, "focus")),
			Stream.merge(
				Stream.fromEventListener(channel, "message").pipe(
					Stream.filter(
						event => event instanceof MessageEvent && event.data === "pending",
					),
				),
			),
			Stream.merge(
				live.changes.pipe(
					Stream.filter(
						message =>
							message.type === "preferences" || message.type === "connected",
					),
				),
			),
			Stream.buffer({ capacity: 1, strategy: "sliding" }),
			Stream.runForEach(() => sync),
			Effect.forkScoped({ startImmediately: true }),
		)
		return Object.freeze({
			state: Object.freeze({
				current: () => SubscriptionRef.getUnsafe(state),
				changes: SubscriptionRef.changes(state),
			}),
			sync,
			save: (patch: PreferencePatch) =>
				Effect.gen(function* () {
					let valid = yield* Schema.decodeUnknownEffect(PreferencePatchSchema)(
						patch,
					)
					let request = yield* random.randomUUIDv4
					yield* storage.modify(key, stored => {
						let saved = readPreferenceState(stored)
						return {
							...saved,
							pending: [...saved.pending, { request, patch: valid }],
						}
					})
					yield* load
					yield* SubscriptionRef.update(state, previous =>
						Object.freeze({
							...previous,
							status: "offline",
							message: undefined,
						}),
					)
					channel.postMessage("pending")
				}).pipe(Effect.uninterruptible),
		})
	})
}

function permanentFailure(error: unknown) {
	if (error instanceof DocumentConflict || error instanceof PermissionDenied)
		return true
	let status = HttpClientError.isHttpClientError(error)
		? error.response?.status
		: undefined
	return status !== undefined && [400, 403, 404, 409, 410, 422].includes(status)
}
