import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import * as Scope from "effect/Scope"
import { BrowserAccount } from "../src/client/browser-account"
import { BrowserStorage, Storage } from "../src/client/storage"
import { AccountChanged } from "../src/shared/authentication"
import { encode } from "../src/shared/base64"

type Check = (value: unknown, message: string) => void

export function bootstrapBrowserAccount(check: Check) {
	return Effect.gen(function* () {
		let accounts = yield* Effect.all([openAccount(), openAccount()], {
			concurrency: "unbounded",
		})
		let first = accounts[0].account
		let second = accounts[1].account
		check(
			first.subject === second.subject &&
				Redacted.value(first.recovery) === Redacted.value(second.recovery),
			"simultaneous browser account acquisitions atomically preserve one recovery key across IndexedDB connections",
		)
		check(
			first.state.current().status === "offline" &&
				second.state.current().status === "offline",
			"browser identity is available before any network authentication",
		)
		let sessions = yield* Effect.all([first.connect, second.connect], {
			concurrency: "unbounded",
		})
		check(
			sessions.every(session => session.subject === first.subject),
			"native browser account login serializes cookie issuance and agrees with server verification",
		)
		return first
	})
}

export function verifyBrowserAccountIsolation(
	account: Context.Service.Shape<typeof BrowserAccount>,
	check: Check,
) {
	return Effect.scoped(
		Effect.gen(function* () {
			let storage = yield* Effect.acquireRelease(Storage.open(), storage =>
				Effect.sync(() => storage.close()),
			)
			yield* Effect.addFinalizer(() =>
				storage
					.set("recovery", Redacted.value(account.recovery))
					.pipe(Effect.orDie),
			)
			yield* storage.set("recovery", encode(new Uint8Array(32).fill(71)))
			let another = (yield* openAccount()).account
			let before = performance
				.getEntriesByType("resource")
				.filter(entry =>
					entry.name.endsWith("/api/accounts/browser-session"),
				).length
			let refused = yield* another.connect.pipe(Effect.result)
			let after = performance
				.getEntriesByType("resource")
				.filter(entry =>
					entry.name.endsWith("/api/accounts/browser-session"),
				).length
			check(
				refused._tag === "Failure" &&
					refused.failure instanceof AccountChanged &&
					another.state.current().status === "accountChanged" &&
					before === after,
				"a different browser identity refuses automatic cookie replacement without submitting a login proof",
			)
		}),
	)
}

function openAccount() {
	return Effect.gen(function* () {
		let scope = yield* Scope.make()
		yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
		let context = yield* Layer.build(
			BrowserAccount.layer(location.origin).pipe(
				Layer.provideMerge(BrowserStorage.layer),
			),
		).pipe(Effect.provideService(Scope.Scope, scope))
		return {
			account: Context.get(context, BrowserAccount),
			storage: Context.get(context, BrowserStorage),
		}
	})
}

export function verifyPersistentBrowserLogout(
	account: Context.Service.Shape<typeof BrowserAccount>,
	check: Check,
) {
	return Effect.gen(function* () {
		let existing = (yield* openAccount()).account
		yield* account.logout
		let reopened = (yield* openAccount()).account
		let refused = yield* Effect.all([
			existing.connect.pipe(Effect.result),
			reopened.connect.pipe(Effect.result),
		])
		check(
			reopened.state.current().status === "signedOut" &&
				refused.every(result => result._tag === "Failure"),
			"logout persists across account reacquisition and prevents another existing context from signing back in",
		)
		let resumed = yield* account.switchAccount
		let following = yield* reopened.connect
		check(
			resumed.subject === account.subject &&
				following.subject === account.subject,
			"explicit sign-in clears the shared sign-out policy and permits another account context to reconnect",
		)
		yield* account.logout
	})
}
