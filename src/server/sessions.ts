import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/sql/SqlClient"
import * as Migrator from "effect/sql/Migrator"
import * as SqlSchema from "effect/sql/SqlSchema"
import { sqliteLayer } from "../platform/sqlite"
import { Signatures } from "../platform/signatures"
import { webCryptoLayer } from "../platform/web-crypto"
import { encode } from "../shared/base64"
import {
	authenticationMessage,
	AuthenticationRequired,
	AccountChanged,
	AuthenticationUnavailable,
	ChallengeSchema,
	SessionSchema,
} from "../shared/authentication"
import type {
	AuthenticationProof,
	AuthenticationPurpose,
} from "../shared/authentication"

export class Sessions extends Context.Service<
	Sessions,
	Effect.Success<ReturnType<typeof makeSessions>>
>()("Sessions") {
	static layer(filename: string) {
		return Layer.effect(Sessions, makeSessions()).pipe(
			Layer.provide(
				Layer.mergeAll(sqliteLayer(filename), Signatures.layer, webCryptoLayer),
			),
		)
	}
}
let challengeLifetime = 60_000
let idleLifetime = 7 * 24 * 60 * 60_000
let sessionLifetime = 30 * 24 * 60 * 60_000
let challengeLimit = 2048
function makeSessions() {
	return Effect.gen(function* () {
		let sql = yield* SqlClient.SqlClient
		let random = yield* Crypto.Crypto
		let signatures = yield* Signatures
		yield* Migrator.make({})({
			loader: Migrator.fromRecord({
				"001_account_sessions": initialSchema,
				"002_session_context": sessionContext,
			}),
		})
		let challenge = SqlSchema.findOneOption({
			Request: Schema.String,
			Result: ChallengeSchema,
			execute: id =>
				sql`SELECT * FROM authentication_challenges WHERE id=${id}`,
		})
		let tokenRow = SqlSchema.findOneOption({
			Request: Schema.Struct({ token: Schema.String, now: Schema.Natural }),
			Result: SessionSchema,
			execute: ({ token, now }) =>
				sql`SELECT subject,expires FROM authentication_sessions WHERE token=${token} AND expires>${now} AND idle>${now}`,
		})
		let count = SqlSchema.findOneOption({
			Request: Schema.Void,
			Result: Schema.Struct({ count: Schema.Natural }),
			execute: () =>
				sql`SELECT count(*) AS count FROM authentication_challenges`,
		})
		let consume = SqlSchema.findOneOption({
			Request: Schema.Struct({
				id: Schema.String,
				publicKey: Schema.String,
				origin: Schema.String,
				purpose: Schema.Literals(["cookie", "bearer"]),
				now: Schema.Natural,
			}),
			Result: Schema.Struct({ id: Schema.String }),
			execute: ({ id, publicKey, origin, purpose, now }) =>
				sql`DELETE FROM authentication_challenges WHERE id=${id} AND publicKey=${publicKey} AND origin=${origin} AND purpose=${purpose} AND expires>${now} RETURNING id`,
		})
		let authenticateRow = SqlSchema.findOneOption({
			Request: Schema.Struct({
				token: Schema.String,
				now: Schema.Natural,
				idle: Schema.Natural,
				purpose: Schema.Literals(["cookie", "bearer"]),
			}),
			Result: SessionSchema,
			execute: ({ token, now, idle, purpose }) =>
				sql`UPDATE authentication_sessions SET idle=min(expires,${idle}) WHERE token=${token} AND purpose=${purpose} AND expires>${now} AND idle>${now} RETURNING subject,expires`,
		})
		return {
			challenge: Effect.fn("Sessions.challenge")(createChallenge),
			login: Effect.fn("Sessions.login")(login),
			authenticate: Effect.fn("Sessions.authenticate")(authenticate),
			current: Effect.fn("Sessions.current")(current),
			revoke: Effect.fn("Sessions.revoke")(revoke),
			logout: Effect.fn("Sessions.logout")(logout),
			cleanup,
		}

		function createChallenge(
			publicKey: string,
			origin: string,
			purpose: AuthenticationPurpose,
		) {
			return sql.withTransaction(
				Effect.gen(function* () {
					let now = yield* Clock.currentTimeMillis
					yield* cleanupAt(now)
					let size = yield* count(undefined)
					if (Option.isSome(size) && size.value.count >= challengeLimit)
						return yield* Effect.fail(
							new AuthenticationUnavailable({
								message: "Try signing in again shortly",
							}),
						)
					let id = yield* random.randomUUIDv4
					let nonce = encode(yield* random.randomBytes(32))
					let expires = now + challengeLifetime
					yield* sql`INSERT INTO authentication_challenges(id,publicKey,origin,purpose,nonce,expires) VALUES (${id},${publicKey},${origin},${purpose},${nonce},${expires})`
					return { id, publicKey, origin, purpose, nonce, expires }
				}),
			)
		}
		function login(
			proof: AuthenticationProof,
			origin: string,
			purpose: AuthenticationPurpose,
			browser?: {
				currentCookie?: Redacted.Redacted<string>
				replace?: boolean
			},
		) {
			return Effect.gen(function* () {
				let issued = yield* challenge(proof.id)
				let now = yield* Clock.currentTimeMillis
				if (
					Option.isNone(issued) ||
					issued.value.publicKey !== proof.publicKey ||
					issued.value.origin !== origin ||
					issued.value.purpose !== purpose ||
					issued.value.expires <= now
				)
					return yield* unauthorized()
				let valid = yield* signatures
					.verify(
						proof.publicKey,
						authenticationMessage(issued.value),
						proof.signature,
					)
					.pipe(Effect.catch(() => Effect.succeed(false)))
				if (!valid) return yield* unauthorized()
				let token = Redacted.make(
					"alk_s_" + encode(yield* random.randomBytes(32)),
				)
				let digest = yield* hashToken(token)
				let subject = yield* signatures.subject(proof.publicKey)
				let currentCookie =
					purpose === "cookie" && browser?.currentCookie
						? yield* hashToken(browser.currentCookie)
						: undefined
				return yield* sql.withTransaction(
					Effect.gen(function* () {
						let now = yield* Clock.currentTimeMillis
						if (currentCookie) {
							let current = yield* SqlSchema.findOneOption({
								Request: Schema.Struct({
									token: Schema.String,
									now: Schema.Natural,
								}),
								Result: SessionSchema,
								execute: ({ token, now }) =>
									sql`SELECT subject,expires FROM authentication_sessions WHERE token=${token} AND purpose='cookie' AND expires>${now} AND idle>${now}`,
							})({ token: currentCookie, now })
							if (Option.isSome(current) && current.value.subject !== subject) {
								if (!browser?.replace)
									return yield* Effect.fail(
										new AccountChanged({
											message:
												"Another account is signed in; choose to switch accounts",
										}),
									)
								yield* sql`DELETE FROM authentication_sessions WHERE token=${currentCookie}`
							}
						}
						let taken = yield* consume({
							id: proof.id,
							publicKey: proof.publicKey,
							origin,
							purpose,
							now,
						})
						if (Option.isNone(taken)) return yield* unauthorized()
						let expires = now + sessionLifetime
						yield* sql`INSERT INTO authentication_sessions(token,subject,purpose,idle,expires) VALUES (${digest},${subject},${purpose},${now + idleLifetime},${expires})`
						return { subject, token, expires }
					}),
				)
			})
		}
		function authenticate(
			token: Redacted.Redacted<string>,
			purpose: AuthenticationPurpose,
		) {
			return Effect.gen(function* () {
				if (!Redacted.value(token)) return yield* unauthorized()
				let digest = yield* hashToken(token)
				let now = yield* Clock.currentTimeMillis
				let session = yield* authenticateRow({
					token: digest,
					now,
					idle: now + idleLifetime,
					purpose,
				})
				if (Option.isNone(session)) return yield* unauthorized()
				return { ...session.value, session: digest }
			})
		}
		function current(digest: string) {
			return Effect.gen(function* () {
				let now = yield* Clock.currentTimeMillis
				let session = yield* tokenRow({ token: digest, now })
				if (Option.isNone(session)) return yield* unauthorized()
				return session.value
			})
		}
		function revoke(digest: string) {
			return sql`DELETE FROM authentication_sessions WHERE token=${digest}`.pipe(
				Effect.asVoid,
			)
		}
		function logout(token: Redacted.Redacted<string>) {
			return hashToken(token).pipe(
				Effect.flatMap(
					digest =>
						sql`DELETE FROM authentication_sessions WHERE token=${digest}`,
				),
				Effect.asVoid,
			)
		}
		function hashToken(token: Redacted.Redacted<string>) {
			return random
				.digest(
					"SHA-256",
					new TextEncoder().encode(
						"alkalye-session-v1:" + Redacted.value(token),
					),
				)
				.pipe(Effect.map(encode))
		}
		function cleanupAt(now: number) {
			return Effect.gen(function* () {
				yield* sql`DELETE FROM authentication_challenges WHERE expires<=${now}`
				yield* sql`DELETE FROM authentication_sessions WHERE expires<=${now} OR idle<=${now}`
			})
		}
		function cleanup() {
			return Clock.currentTimeMillis.pipe(
				Effect.flatMap(now => sql.withTransaction(cleanupAt(now))),
			)
		}
	})
}
function unauthorized() {
	return Effect.fail(
		new AuthenticationRequired({ message: "Sign in to continue" }),
	)
}

let initialSchema = Effect.gen(function* () {
	let sql = yield* SqlClient.SqlClient
	yield* sql`CREATE TABLE IF NOT EXISTS authentication_challenges (id TEXT PRIMARY KEY,publicKey TEXT NOT NULL,origin TEXT NOT NULL,purpose TEXT NOT NULL,nonce TEXT NOT NULL,expires INTEGER NOT NULL)`
	yield* sql`CREATE INDEX IF NOT EXISTS challenge_expiry ON authentication_challenges(expires)`
	yield* sql`CREATE TABLE IF NOT EXISTS authentication_sessions (token TEXT PRIMARY KEY,subject TEXT NOT NULL,purpose TEXT NOT NULL,idle INTEGER NOT NULL,expires INTEGER NOT NULL)`
	yield* sql`CREATE INDEX IF NOT EXISTS session_expiry ON authentication_sessions(expires)`
})
let sessionContext = Effect.gen(function* () {
	let sql = yield* SqlClient.SqlClient
	let columns = SqlSchema.findAll({
		Request: Schema.String,
		Result: Schema.Struct({ name: Schema.String }),
		execute: table => sql`PRAGMA table_info(${sql(table)})`,
	})
	let challenges = new Set(
		(yield* columns("authentication_challenges")).map(column => column.name),
	)
	if (!challenges.has("purpose")) {
		yield* sql`ALTER TABLE authentication_challenges ADD COLUMN purpose TEXT NOT NULL DEFAULT 'bearer'`
		yield* sql`DELETE FROM authentication_challenges`
	}
	let sessions = new Set(
		(yield* columns("authentication_sessions")).map(column => column.name),
	)
	if (!sessions.has("purpose"))
		yield* sql`ALTER TABLE authentication_sessions ADD COLUMN purpose TEXT NOT NULL DEFAULT 'bearer'`
	if (!sessions.has("idle"))
		yield* sql`ALTER TABLE authentication_sessions ADD COLUMN idle INTEGER NOT NULL DEFAULT 0`
	if (!sessions.has("purpose") || !sessions.has("idle"))
		yield* sql`DELETE FROM authentication_sessions`
})
