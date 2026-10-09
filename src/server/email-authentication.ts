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
import { Cipher } from "../platform/cipher"
import { Signatures } from "../platform/signatures"
import { webCryptoLayer } from "../platform/web-crypto"
import { PacketSchema } from "../shared/model"
import {
	EmailAuthenticationRejected,
	RecoveryKeySchema,
} from "../shared/email-authentication"
import { RelaySecrets } from "./settings"
import { EmailDelivery } from "./email-delivery"

let lifetime = 5 * 60_000
let failureMessage = "Code is invalid or expired; request a new code"
let rowSchema = Schema.Struct({
	id: Schema.String,
	email: Schema.String,
	subject: Schema.NullOr(Schema.String),
	purpose: Schema.Literals(["link", "signIn"]),
	origin: Schema.String,
	binding: Schema.String,
	digest: Schema.String,
	recovery: Schema.NullOr(Schema.String),
	expires: Schema.Natural,
	attempts: Schema.Natural,
})
export class EmailAuthentication extends Context.Service<
	EmailAuthentication,
	Effect.Success<ReturnType<typeof makeEmailAuthentication>>
>()("alkalye/EmailAuthentication") {
	static get live() {
		return emailAuthenticationSqlLayer("email_sql_migrations")
	}
}
export function emailAuthenticationSqlLayer(
	table: string = "effect_sql_migrations",
) {
	return Layer.effect(EmailAuthentication, makeEmailAuthentication(table)).pipe(
		Layer.provide(Layer.merge(Signatures.layer, webCryptoLayer)),
	)
}
function makeEmailAuthentication(table: string) {
	return Effect.gen(function* () {
		let sql = yield* SqlClient.SqlClient
		let cipher = yield* Cipher
		let signatures = yield* Signatures
		let secrets = yield* RelaySecrets
		let randomness = yield* Crypto.Crypto
		let delivery = yield* EmailDelivery
		yield* Migrator.make({})({
			table,
			loader: Migrator.fromRecord({ "001_email_accounts": initialSchema }),
		})
		let byEmail = SqlSchema.findOneOption({
			Request: Schema.String,
			Result: Schema.Struct({
				subject: Schema.String,
				recovery: Schema.String,
			}),
			execute: email =>
				sql`SELECT subject,recovery FROM email_accounts WHERE email=${email}`,
		})
		let bySubject = SqlSchema.findOneOption({
			Request: Schema.String,
			Result: Schema.Struct({ email: Schema.String }),
			execute: subject =>
				sql`SELECT email FROM email_accounts WHERE subject=${subject}`,
		})
		let challenge = SqlSchema.findOneOption({
			Request: Schema.String,
			Result: rowSchema,
			execute: id => sql`SELECT * FROM email_challenges WHERE id=${id}`,
		})
		let count = SqlSchema.findOneOption({
			Request: Schema.Struct({ key: Schema.String, since: Schema.Finite }),
			Result: Schema.Struct({ count: Schema.Natural }),
			execute: ({ key, since }) =>
				sql`SELECT count(*) AS count FROM email_requests WHERE key=${key} AND time>${since}`,
		})
		return {
			enabled: delivery.enabled,
			unlink: (subject: string) =>
				sql.withTransaction(
					Effect.gen(function* () {
						yield* sql`DELETE FROM email_accounts WHERE subject=${subject}`
						yield* sql`DELETE FROM email_challenges WHERE subject=${subject}`
					}),
				),
			status: (subject: string) =>
				Effect.gen(function* () {
					let account = yield* bySubject(subject)
					return {
						enabled: delivery.enabled,
						email: Option.isSome(account) ? account.value.email : null,
					}
				}),
			requestSignIn: (
				email: string,
				origin: string,
				binding: Redacted.Redacted<string>,
			) => issue(email, origin, binding, "signIn"),
			requestLink: (
				email: string,
				origin: string,
				subject: string,
				recovery: Redacted.Redacted<string>,
				binding: Redacted.Redacted<string>,
			) =>
				Effect.gen(function* () {
					let key = yield* Schema.decodeUnknownEffect(RecoveryKeySchema)(
						Redacted.value(recovery),
					).pipe(Effect.mapError(() => rejected()))
					let identity = yield* signatures.account(Redacted.make(key))
					if (identity.subject !== subject)
						return yield* Effect.fail(rejected())
					return yield* issue(email, origin, binding, "link", {
						subject,
						recovery,
					})
				}),
			verifySignIn: (
				id: string,
				code: Redacted.Redacted<string>,
				origin: string,
				binding: Redacted.Redacted<string>,
			) =>
				verify(id, code, origin, binding, "signIn").pipe(
					Effect.flatMap(value => decrypt(value)),
				),
			verifyLink: (
				id: string,
				code: Redacted.Redacted<string>,
				origin: string,
				subject: string,
				binding: Redacted.Redacted<string>,
			) =>
				verify(id, code, origin, binding, "link", subject).pipe(
					Effect.map(value => ({ email: value.email })),
				),
		}
		function issue(
			address: string,
			origin: string,
			browserBinding: Redacted.Redacted<string>,
			purpose: "link" | "signIn",
			link?: { subject: string; recovery: Redacted.Redacted<string> },
		) {
			return Effect.gen(function* () {
				if (!delivery.enabled)
					return yield* Effect.fail(
						new EmailAuthenticationRejected({
							message: "Email sign-in is not configured on this server",
						}),
					)
				let email = address.trim().toLowerCase()
				if (!/^[\x21-\x7e]+$/.test(email) || email.length > 254)
					return yield* Effect.fail(rejected())
				let binding = yield* cipher.hash(
					"email-browser-v1:" + Redacted.value(browserBinding),
				)
				let id = yield* randomness.randomUUIDv4
				let code = yield* generateCode()
				let digest = yield* hashCode(id, code)
				let now = yield* Clock.currentTimeMillis
				let expires = now + lifetime
				let rateKey = yield* cipher.hash(
					"email-rate:" + secrets.masterKey + ":" + email,
				)
				let recovery = link
					? yield* encrypt(email, link.subject, link.recovery)
					: undefined
				yield* sql.withTransaction(
					Effect.gen(function* () {
						yield* sql`DELETE FROM email_requests WHERE time<=${now - 60 * 60_000}`
						yield* sql`DELETE FROM email_challenges WHERE expires<=${now}`
						let recent = yield* count({ key: rateKey, since: now - 60_000 })
						let hourly = yield* count({
							key: rateKey,
							since: now - 60 * 60_000,
						})
						let global = yield* count({
							key: "global",
							since: now - 60 * 60_000,
						})
						if (
							(Option.isSome(recent) && recent.value.count > 0) ||
							(Option.isSome(hourly) && hourly.value.count >= 5) ||
							(Option.isSome(global) && global.value.count >= 200)
						)
							return yield* Effect.fail(
								new EmailAuthenticationRejected({
									message: "Wait before requesting another code",
								}),
							)
						yield* sql`INSERT INTO email_requests(key,time) VALUES (${rateKey},${now}),(${"global"},${now})`
						let account = yield* byEmail(email)
						let subject =
							link?.subject ??
							(Option.isSome(account) ? account.value.subject : null)
						let storedRecovery =
							recovery ??
							(Option.isSome(account) ? account.value.recovery : null)
						yield* sql`INSERT INTO email_challenges(id,email,subject,purpose,origin,binding,digest,recovery,expires) VALUES (${id},${email},${subject},${purpose},${origin},${binding},${digest},${storedRecovery},${expires})`
					}),
				)
				// Delivery failure invalidates the code without releasing rate limits or exposing provider details.
				yield* delivery.send(email, code, id).pipe(
					Effect.onError(() =>
						sql`DELETE FROM email_challenges WHERE id=${id}`.pipe(Effect.orDie),
					),
					Effect.onInterrupt(() =>
						sql`DELETE FROM email_challenges WHERE id=${id}`.pipe(Effect.orDie),
					),
				)
				return { id, expires }
			})
		}
		function verify(
			id: string,
			code: Redacted.Redacted<string>,
			origin: string,
			browserBinding: Redacted.Redacted<string>,
			purpose: "link" | "signIn",
			subject?: string,
		) {
			return Effect.gen(function* () {
				let digest = yield* hashCode(id, code)
				let binding = yield* cipher.hash(
					"email-browser-v1:" + Redacted.value(browserBinding),
				)
				let result = yield* sql.withTransaction(
					Effect.gen(function* () {
						let now = yield* Clock.currentTimeMillis
						let candidate = yield* challenge(id)
						if (Option.isNone(candidate)) return undefined
						let row = candidate.value
						if (
							row.origin !== origin ||
							!constantTimeEquals(row.binding, binding) ||
							row.purpose !== purpose ||
							(purpose === "link" && row.subject !== subject)
						)
							return undefined
						if (row.expires <= now || row.attempts >= 5) {
							yield* sql`DELETE FROM email_challenges WHERE id=${id}`
							return undefined
						}
						// Returning failure as data commits the attempt; failing inside a transaction would roll it back.
						yield* sql`DELETE FROM email_failures WHERE time<=${now - 60 * 60_000}`
						let rateKey = yield* cipher.hash(
							"email-rate:" + secrets.masterKey + ":" + row.email,
						)
						let failures = yield* SqlSchema.findOneOption({
							Request: Schema.String,
							Result: Schema.Struct({ count: Schema.Natural }),
							execute: key =>
								sql`SELECT count(*) AS count FROM email_failures WHERE key=${key}`,
						})(rateKey)
						if (Option.isSome(failures) && failures.value.count >= 10)
							return undefined
						if (!constantTimeEquals(row.digest, digest)) {
							yield* sql`INSERT INTO email_failures(key,time) VALUES (${rateKey},${now})`
							yield* sql`UPDATE email_challenges SET attempts=attempts+1 WHERE id=${id}`
							return undefined
						}
						yield* sql`DELETE FROM email_challenges WHERE id=${id}`
						if (!row.recovery || !row.subject) return undefined
						if (purpose === "link") {
							let registered = yield* byEmail(row.email)
							if (
								Option.isSome(registered) &&
								registered.value.subject !== row.subject
							)
								return undefined
							yield* sql`DELETE FROM email_accounts WHERE subject=${row.subject}`
							yield* sql`INSERT INTO email_accounts(email,subject,recovery) VALUES (${row.email},${row.subject},${row.recovery})`
						} else {
							let current = yield* byEmail(row.email)
							if (
								Option.isNone(current) ||
								current.value.subject !== row.subject ||
								current.value.recovery !== row.recovery
							)
								return undefined
						}
						return {
							email: row.email,
							subject: row.subject,
							recovery: row.recovery,
						}
					}),
				)
				if (!result) return yield* Effect.fail(rejected())
				return result
			})
		}
		function encrypt(
			email: string,
			subject: string,
			recovery: Redacted.Redacted<string>,
		) {
			return cipher.hash(JSON.stringify([email, subject])).pipe(
				Effect.flatMap(id =>
					cipher.seal(
						secrets.masterKey,
						id,
						Redacted.value(recovery),
						"email-account-v1",
					),
				),
				Effect.map(packet => JSON.stringify(packet)),
			)
		}
		function decrypt(value: {
			email: string
			subject: string
			recovery: string
		}) {
			return Effect.gen(function* () {
				let packet = yield* Schema.decodeUnknownEffect(
					Schema.fromJsonString(PacketSchema),
				)(value.recovery)
				if (
					packet.id !==
					(yield* cipher.hash(JSON.stringify([value.email, value.subject])))
				)
					return yield* Effect.fail(rejected())
				let key = yield* cipher.open(
					secrets.masterKey,
					packet,
					"email-account-v1",
				)
				return {
					recovery: yield* Schema.decodeUnknownEffect(RecoveryKeySchema)(key),
				}
			})
		}
		function hashCode(id: string, code: Redacted.Redacted<string>) {
			return cipher.hash(
				"email-otp-v1:" +
					secrets.masterKey +
					":" +
					id +
					":" +
					Redacted.value(code),
			)
		}
		function generateCode() {
			return Effect.gen(function* () {
				// Rejection sampling avoids modulo bias for an eight-digit code.
				let value = 0xffffffff
				while (value >= 4_200_000_000) {
					let bytes = yield* randomness.randomBytes(4)
					value = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0)
				}
				return Redacted.make(String(value % 100_000_000).padStart(8, "0"))
			})
		}
	})
}
function rejected() {
	return new EmailAuthenticationRejected({ message: failureMessage })
}
function constantTimeEquals(left: string, right: string) {
	let different = left.length ^ right.length
	for (let index = 0; index < Math.max(left.length, right.length); index++)
		different |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
	return different === 0
}

let initialSchema = Effect.gen(function* () {
	let sql = yield* SqlClient.SqlClient
	yield* sql`CREATE TABLE IF NOT EXISTS email_accounts(email TEXT PRIMARY KEY,subject TEXT UNIQUE NOT NULL,recovery TEXT NOT NULL)`
	yield* sql`CREATE TABLE IF NOT EXISTS email_challenges(id TEXT PRIMARY KEY,email TEXT NOT NULL,subject TEXT,purpose TEXT NOT NULL,origin TEXT NOT NULL,binding TEXT NOT NULL,digest TEXT NOT NULL,recovery TEXT,expires INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0)`
	yield* sql`CREATE INDEX IF NOT EXISTS email_expiry ON email_challenges(expires)`
	yield* sql`CREATE TABLE IF NOT EXISTS email_requests(key TEXT NOT NULL,time INTEGER NOT NULL)`
	yield* sql`CREATE TABLE IF NOT EXISTS email_failures(key TEXT NOT NULL,time INTEGER NOT NULL)`
	yield* sql`CREATE INDEX IF NOT EXISTS email_failure_time ON email_failures(time)`
	yield* sql`CREATE INDEX IF NOT EXISTS email_request_time ON email_requests(time)`
})
