import * as Context from "effect/Context"
import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import { authenticationMessage } from "../shared/authentication"
import type { Challenge, AuthenticationPurpose } from "../shared/authentication"
import { isSigningPublicKey } from "../shared/signing-keys"
import { decode, encode } from "../shared/base64"
import { CryptoError } from "./errors"
import { webCryptoLayer } from "./web-crypto"

export class Signatures extends Context.Service<
	Signatures,
	Effect.Success<ReturnType<typeof makeSignatures>>
>()("Signatures") {
	static layer = Layer.effect(Signatures, makeSignatures()).pipe(
		Layer.provide(webCryptoLayer),
	)
}
function makeSignatures() {
	return Effect.gen(function* () {
		let cryptoService = yield* Crypto.Crypto
		return { account, verify, subject }
		function account(secret: Redacted.Redacted<string>) {
			return Effect.gen(function* () {
				let seed = yield* cryptography("derive signing key", async () => {
					let secretBytes = decode(Redacted.value(secret))
					if (secretBytes.length !== 32)
						throw new Error("Expected a 32-byte recovery key")
					let material = await crypto.subtle.importKey(
						"raw",
						secretBytes,
						"HKDF",
						false,
						["deriveBits"],
					)
					return new Uint8Array(
						await crypto.subtle.deriveBits(
							{
								name: "HKDF",
								hash: "SHA-256",
								salt: new Uint8Array(32),
								info: new TextEncoder().encode("alkalye/auth/ed25519/v1"),
							},
							material,
							256,
						),
					)
				})
				let privateKey = yield* cryptography("import signing key", () =>
					crypto.subtle.importKey(
						"pkcs8",
						new Uint8Array([...ed25519PrivateKeyPrefix, ...seed]),
						"Ed25519",
						true,
						["sign"],
					),
				)
				let exported = yield* cryptography("export public identity", () =>
					crypto.subtle.exportKey("jwk", privateKey),
				)
				if (!exported.x)
					return yield* Effect.fail(
						new CryptoError({
							operation: "public identity",
							cause: "Missing public key",
						}),
					)
				privateKey = yield* cryptography("protect signing key", () =>
					crypto.subtle.importKey("jwk", exported, "Ed25519", false, ["sign"]),
				)
				let publicKey = exported.x
				let id = yield* subject(publicKey)
				return {
					publicKey,
					subject: id,
					signAuthentication: (
						challenge: Challenge,
						expected: { origin: string; purpose: AuthenticationPurpose },
					) =>
						Effect.gen(function* () {
							if (
								challenge.origin !== expected.origin ||
								challenge.purpose !== expected.purpose ||
								challenge.publicKey !== publicKey
							)
								return yield* Effect.fail(
									new CryptoError({
										operation: "sign authentication",
										cause:
											"Challenge does not match the intended server and session",
									}),
								)
							return yield* cryptography("sign authentication", () =>
								crypto.subtle.sign(
									"Ed25519",
									privateKey,
									new TextEncoder().encode(authenticationMessage(challenge)),
								),
							).pipe(Effect.map(buffer => encode(new Uint8Array(buffer))))
						}),
				}
			})
		}
		function subject(publicKey: string) {
			return cryptoService
				.digest(
					"SHA-256",
					new Uint8Array([
						...new TextEncoder().encode("alkalye-identity-v1:"),
						...decode(publicKey),
					]),
				)
				.pipe(Effect.map(encode))
		}
		function verify(publicKey: string, message: string, signature: string) {
			return cryptography("verify", async () => {
				if (!isSigningPublicKey(publicKey)) return false
				let key = await crypto.subtle.importKey(
					"raw",
					decode(publicKey),
					"Ed25519",
					false,
					["verify"],
				)
				return crypto.subtle.verify(
					"Ed25519",
					key,
					decode(signature),
					new TextEncoder().encode(message),
				)
			})
		}
	})
}
// RFC 8410 wraps the 32-byte Ed25519 seed; Web Crypto derives the public point.
let ed25519PrivateKeyPrefix = [
	0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04,
	0x22, 0x04, 0x20,
]
function cryptography<A>(operation: string, work: () => Promise<A>) {
	return Effect.tryPromise({
		try: work,
		catch: cause => new CryptoError({ operation, cause }),
	})
}
