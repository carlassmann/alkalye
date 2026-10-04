import { Database } from "bun:sqlite"
import { afterAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import { TestClock } from "effect/testing"
import { Signatures } from "../src/platform/signatures"
import { Sessions } from "../src/server/sessions"
import { authenticationMessage } from "../src/shared/authentication"
import { encode } from "../src/shared/base64"

let directory = await mkdtemp(join(tmpdir(), "alkalye-sessions-"))
let identity = await Effect.runPromise(
	Signatures.use(signatures =>
		signatures.account(Redacted.make(encode(new Uint8Array(32).fill(19)))),
	).pipe(Effect.provide(Signatures.layer)),
)
afterAll(() => rm(directory, { recursive: true, force: true }))
function fixture<A, E>(
	name: string,
	task: Effect.Effect<A, E, Sessions | TestClock.TestClock>,
) {
	return Effect.runPromise(
		task.pipe(
			Effect.provide(Sessions.layer(join(directory, name + ".sqlite"))),
			Effect.provide(TestClock.layer()),
		),
	)
}
function login() {
	return Effect.gen(function* () {
		let sessions = yield* Sessions
		let challenge = yield* sessions.challenge(
			identity.publicKey,
			"https://alkalye.example",
			"bearer",
		)
		let signature = yield* identity.signAuthentication(challenge, {
			origin: challenge.origin,
			purpose: challenge.purpose,
		})
		return yield* sessions.login(
			{ id: challenge.id, publicKey: identity.publicKey, signature },
			challenge.origin,
			"bearer",
		)
	})
}
test("challenge expires exactly at the boundary even when its proof was already signed", () =>
	fixture(
		"challenge-expiry",
		Effect.gen(function* () {
			let sessions = yield* Sessions
			let challenge = yield* sessions.challenge(
				identity.publicKey,
				"https://alkalye.example",
				"bearer",
			)
			let signature = yield* identity.signAuthentication(challenge, {
				origin: challenge.origin,
				purpose: challenge.purpose,
			})
			yield* TestClock.adjust("60 seconds")
			let result = yield* sessions
				.login(
					{ id: challenge.id, publicKey: identity.publicKey, signature },
					challenge.origin,
					"bearer",
				)
				.pipe(Effect.result)
			expect(result._tag).toBe("Failure")
			if (result._tag === "Failure")
				expect(result.failure._tag).toBe("AuthenticationRequired")
		}),
	))
test("idle sessions expire and the same token cannot switch authentication purpose", () =>
	fixture(
		"idle-expiry",
		Effect.gen(function* () {
			let sessions = yield* Sessions
			let session = yield* login()
			expect(
				(yield* sessions
					.authenticate(session.token, "cookie")
					.pipe(Effect.result))._tag,
			).toBe("Failure")
			expect(
				(yield* sessions.authenticate(session.token, "bearer")).subject,
			).toBe(identity.subject)
			yield* TestClock.adjust("7 days")
			let result = yield* sessions
				.authenticate(session.token, "bearer")
				.pipe(Effect.result)
			expect(result._tag).toBe("Failure")
			if (result._tag === "Failure")
				expect(result.failure._tag).toBe("AuthenticationRequired")
		}),
	))
test("use extends idle expiry but never the absolute lifetime", () =>
	fixture(
		"absolute-expiry",
		Effect.gen(function* () {
			let sessions = yield* Sessions
			let session = yield* login()
			for (let index = 0; index < 4; index++) {
				yield* TestClock.adjust("6 days")
				expect(
					(yield* sessions.authenticate(session.token, "bearer")).expires,
				).toBe(session.expires)
			}
			yield* TestClock.adjust("6 days")
			expect(
				(yield* sessions
					.authenticate(session.token, "bearer")
					.pipe(Effect.result))._tag,
			).toBe("Failure")
		}),
	))
test("tokens survive a server restart, remain redacted and are stored only as hashes", async () => {
	let filename = join(directory, "restart.sqlite")
	let session = await Effect.runPromise(
		login().pipe(Effect.provide(Sessions.layer(filename))),
	)
	expect(JSON.stringify(session)).not.toContain(Redacted.value(session.token))
	let stored = new Database(filename, { readonly: true })
	try {
		let rows = stored
			.query("SELECT token,subject FROM authentication_sessions")
			.all()
		expect(rows).toHaveLength(1)
		expect(JSON.stringify(rows)).not.toContain(Redacted.value(session.token))
		expect(JSON.stringify(rows)).not.toContain(identity.publicKey)
	} finally {
		stored.close()
	}
	let restored = await Effect.runPromise(
		Sessions.use(sessions =>
			sessions.authenticate(session.token, "bearer"),
		).pipe(Effect.provide(Sessions.layer(filename))),
	)
	expect(restored.subject).toBe(identity.subject)
	await Effect.runPromise(
		Sessions.use(sessions => sessions.logout(session.token)).pipe(
			Effect.provide(Sessions.layer(filename)),
		),
	)
	let result = await Effect.runPromise(
		Sessions.use(sessions =>
			sessions.authenticate(session.token, "bearer"),
		).pipe(Effect.result, Effect.provide(Sessions.layer(filename))),
	)
	expect(result._tag).toBe("Failure")
})
test("expired entries are reclaimed before applying the challenge capacity", () =>
	fixture(
		"capacity",
		Effect.gen(function* () {
			let sessions = yield* Sessions
			let database = new Database(join(directory, "capacity.sqlite"))
			try {
				database.run(
					"WITH RECURSIVE entries(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM entries WHERE n<2048) INSERT INTO authentication_challenges SELECT printf('%d',n),?,?,?,? ,? FROM entries",
					[
						identity.publicKey,
						"https://alkalye.example",
						"bearer",
						"nonce",
						60_000,
					],
				)
				let blocked = yield* sessions
					.challenge(identity.publicKey, "https://alkalye.example", "bearer")
					.pipe(Effect.result)
				expect(blocked._tag).toBe("Failure")
				if (blocked._tag === "Failure")
					expect(blocked.failure._tag).toBe("AuthenticationUnavailable")
				yield* TestClock.adjust("60 seconds")
				let next = yield* sessions.challenge(
					identity.publicKey,
					"https://alkalye.example",
					"bearer",
				)
				expect(next.publicKey).toBe(identity.publicKey)
				expect(
					database
						.query("SELECT count(*) AS count FROM authentication_challenges")
						.get(),
				).toEqual({ count: 1 })
			} finally {
				database.close()
			}
		}),
	))
test("signing identity is deterministic, domain-bound and rejects incomplete recovery keys", async () => {
	await Effect.runPromise(
		Signatures.use(signatures =>
			Effect.gen(function* () {
				let restored = yield* signatures.account(
					Redacted.make(encode(new Uint8Array(32).fill(19))),
				)
				expect(restored.subject).toBe(identity.subject)
				expect(restored.publicKey).toBe(identity.publicKey)
				let challenge = {
					id: "3c485d6c-bdf7-4f46-96d6-6415d5b109aa",
					publicKey: identity.publicKey,
					origin: "https://alkalye.example",
					purpose: "bearer",
					nonce: "nonce",
					expires: 1000,
				}
				let signature = yield* restored.signAuthentication(
					{ ...challenge, purpose: "bearer" },
					{ origin: challenge.origin, purpose: "bearer" },
				)
				expect(
					yield* signatures.verify(
						restored.publicKey,
						authenticationMessage({ ...challenge, purpose: "bearer" }),
						signature,
					),
				).toBe(true)
				expect(
					yield* signatures.verify(
						restored.publicKey,
						"a document operation",
						signature,
					),
				).toBe(false)
				for (let expected of [
					{ origin: "https://evil.example", purpose: "bearer" },
					{ origin: challenge.origin, purpose: "cookie" },
				]) {
					let rejected = yield* restored
						.signAuthentication(
							{ ...challenge, purpose: "bearer" },
							{
								origin: expected.origin,
								purpose: expected.purpose === "cookie" ? "cookie" : "bearer",
							},
						)
						.pipe(Effect.result)
					expect(rejected._tag).toBe("Failure")
				}
				let incomplete = yield* signatures
					.account(Redacted.make(encode(new Uint8Array(16))))
					.pipe(Effect.result)
				expect(incomplete._tag).toBe("Failure")
			}),
		).pipe(Effect.provide(Signatures.layer)),
	)
})

test("native SQL migrations upgrade pre-purpose databases and invalidate unbound old sessions", async () => {
	let filename = join(directory, "upgrade.sqlite")
	let old = new Database(filename, { create: true })
	old.run(
		"CREATE TABLE authentication_challenges(id TEXT PRIMARY KEY,publicKey TEXT NOT NULL,origin TEXT NOT NULL,nonce TEXT NOT NULL,expires INTEGER NOT NULL)",
	)
	old.run(
		"CREATE TABLE authentication_sessions(token TEXT PRIMARY KEY,subject TEXT NOT NULL,expires INTEGER NOT NULL)",
	)
	old.run(
		"INSERT INTO authentication_challenges VALUES ('old','old','old','old',9999999999999)",
	)
	old.run(
		"INSERT INTO authentication_sessions VALUES ('old','old',9999999999999)",
	)
	old.close()
	let session = await Effect.runPromise(
		login().pipe(Effect.provide(Sessions.layer(filename))),
	)
	let stored = new Database(filename, { readonly: true })
	try {
		expect(
			stored
				.query(
					"SELECT migration_id FROM effect_sql_migrations ORDER BY migration_id",
				)
				.all(),
		).toEqual([{ migration_id: 1 }, { migration_id: 2 }])
		expect(
			stored.query("SELECT id FROM authentication_challenges").all(),
		).toEqual([])
		expect(
			stored.query("SELECT subject FROM authentication_sessions").all(),
		).toEqual([{ subject: identity.subject }])
	} finally {
		stored.close()
	}
	let restored = await Effect.runPromise(
		Sessions.use(sessions =>
			sessions.authenticate(session.token, "bearer"),
		).pipe(Effect.provide(Sessions.layer(filename))),
	)
	expect(restored.subject).toBe(identity.subject)
})
