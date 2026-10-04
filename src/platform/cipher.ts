import * as Cache from "effect/Cache"
import * as Context from "effect/Context"
import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import { decode, encode } from "../shared/base64"
import type { Packet } from "../shared/model"
import { CryptoError } from "./errors"
import { webCryptoLayer } from "./web-crypto"

export class Cipher extends Context.Service<
	Cipher,
	Effect.Success<ReturnType<typeof makeCipher>>
>()("Cipher") {
	static layer = Layer.effect(Cipher, makeCipher())
	static live = Cipher.layer.pipe(Layer.provide(webCryptoLayer))
}
function makeCipher() {
	return Effect.gen(function* () {
		let random = yield* Crypto.Crypto
		let keys = yield* Cache.makeWith(
			(secret: string) =>
				cryptography("import key", () =>
					crypto.subtle.importKey("raw", decode(secret), "AES-GCM", false, [
						"encrypt",
						"decrypt",
					]),
				),
			{
				capacity: 256,
				timeToLive: exit => (Exit.isSuccess(exit) ? "15 minutes" : 0),
			},
		)
		yield* Effect.addFinalizer(() => Cache.invalidateAll(keys))
		return { digest, hash, secret, uuid, importKey, seal, open }
		function hash(value: string) {
			return digest(new TextEncoder().encode(value))
		}
		function digest(bytes: Uint8Array) {
			return random.digest("SHA-256", bytes).pipe(
				Effect.map(encode),
				Effect.mapError(cause => new CryptoError({ operation: "hash", cause })),
			)
		}
		function secret() {
			return random.randomBytes(32).pipe(
				Effect.map(encode),
				Effect.mapError(
					cause => new CryptoError({ operation: "random secret", cause }),
				),
			)
		}
		function uuid() {
			return random.randomUUIDv4.pipe(
				Effect.mapError(
					cause => new CryptoError({ operation: "random identity", cause }),
				),
			)
		}

		function importKey(secret: string) {
			return Cache.get(keys, secret)
		}
		function seal(key: string, id: string, value: unknown, room: string) {
			return Effect.gen(function* () {
				let imported = yield* importKey(key)
				let iv = yield* random
					.randomBytes(12)
					.pipe(
						Effect.mapError(
							cause => new CryptoError({ operation: "encrypt", cause }),
						),
					)
				let body = yield* cryptography("encrypt", () =>
					crypto.subtle.encrypt(
						{
							name: "AES-GCM",
							iv: new Uint8Array(iv),
							additionalData: new TextEncoder().encode(`${room}:${id}`),
						},
						imported,
						new TextEncoder().encode(JSON.stringify(value)),
					),
				)
				let packet: Packet = {
					id,
					iv: encode(iv),
					body: encode(new Uint8Array(body)),
				}
				return packet
			})
		}
		function open(key: string, packet: Packet, room: string) {
			return Effect.gen(function* () {
				let imported = yield* importKey(key)
				let body = yield* cryptography("decrypt", () =>
					crypto.subtle.decrypt(
						{
							name: "AES-GCM",
							iv: decode(packet.iv),
							additionalData: new TextEncoder().encode(`${room}:${packet.id}`),
						},
						imported,
						decode(packet.body),
					),
				)
				return yield* Effect.try({
					try: (): unknown => JSON.parse(new TextDecoder().decode(body)),
					catch: cause => new CryptoError({ operation: "decrypt", cause }),
				})
			})
		}
	})
}
function cryptography<A>(operation: string, work: () => PromiseLike<A>) {
	return Effect.tryPromise({
		try: work,
		catch: cause => new CryptoError({ operation, cause }),
	})
}
