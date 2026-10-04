// Keep the previous cipher independent so compatibility tests cannot exercise the new implementation twice.
import * as Effect from "effect/Effect"
import type * as Context from "effect/Context"
import type { Cipher } from "../src/platform/cipher"
import { decode, encode } from "../src/shared/base64"
export { decode, encode } from "../src/shared/base64"
import { CryptoError } from "../src/platform/errors"
import type { Packet } from "../src/shared/model"
import { parseRoom } from "../src/shared/model"

export function randomSecret() {
	return encode(crypto.getRandomValues(new Uint8Array(32)))
}
export let hash = Effect.fn("Cipher.hash")(function* (value: string) {
	let digest = yield* cryptography("hash", () =>
		crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
	)
	return encode(new Uint8Array(digest))
})
let keys = new Map<string, CryptoKey>()
export let importKey = Effect.fn("Cipher.importKey")(function* (
	secret: string,
) {
	let cached = keys.get(secret)
	if (cached) return cached
	let key = yield* cryptography("import key", () =>
		crypto.subtle.importKey("raw", decode(secret), "AES-GCM", false, [
			"encrypt",
			"decrypt",
		]),
	)
	keys.set(secret, key)
	return key
})
export let seal = Effect.fn("Cipher.seal")(function* (
	key: string,
	id: string,
	value: unknown,
	room: string,
) {
	let imported = yield* importKey(key)
	let iv = crypto.getRandomValues(new Uint8Array(12))
	let body = yield* cryptography("encrypt", () =>
		crypto.subtle.encrypt(
			{
				name: "AES-GCM",
				iv,
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
export let open = Effect.fn("Cipher.open")(function* (
	key: string,
	packet: Packet,
	room: string,
) {
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
	let value: unknown = JSON.parse(new TextDecoder().decode(body))
	return value
})
export let accountRoom = Effect.fn("Cipher.accountRoom")(function* (
	secret: string,
	cipher: Pick<Context.Service.Shape<typeof Cipher>, "hash"> = { hash },
) {
	let { hash } = cipher
	let [id, key, read, write, admin] = yield* Effect.all(
		[
			hash(`account:${secret}`),
			hash(`encryption:${secret}`),
			hash(`read:${secret}`),
			hash(`write:${secret}`),
			hash(`admin:${secret}`),
		],
		{ concurrency: 5 },
	)
	return {
		id,
		key,
		read,
		write,
		admin,
		name: "Personal",
		personal: true,
		local: false,
	}
})
export function parseInvite(fragment: string) {
	return parseRoom({
		...JSON.parse(new TextDecoder().decode(decode(fragment))),
		local: false,
	})
}
function cryptography<A>(operation: string, work: () => PromiseLike<A>) {
	return Effect.tryPromise({
		try: work,
		catch: cause => new CryptoError({ operation, cause }),
	})
}
