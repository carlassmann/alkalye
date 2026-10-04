import { expect, spyOn, test } from "bun:test"
import * as Crypto from "effect/Crypto"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import { TaskGroup } from "../src/platform/tasks"
import { TestClock } from "effect/testing"
import { Cipher } from "../src/platform/cipher"
import { webCryptoLayer } from "../src/platform/web-crypto"
import { decode, encode, open, seal, hash } from "./legacy-crypto"
let key = encode(new Uint8Array(32))

test("native Crypto supplies deterministic IVs and digests to Cipher", async () => {
	let deterministic = Crypto.make({
		randomBytes: size => new Uint8Array(size).fill(7),
		digest: () => Effect.succeed(new Uint8Array([1, 2, 3])),
	})
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				let cipher = yield* Cipher
				expect(yield* cipher.hash("ignored")).toBe("AQID")
				expect(decode(yield* cipher.secret())).toEqual(
					new Uint8Array(32).fill(7),
				)
				let packet = yield* cipher.seal(key, "id", { text: "hello" }, "room")
				expect(decode(packet.iv)).toEqual(new Uint8Array(12).fill(7))
				expect(yield* open(key, packet, "room")).toEqual({ text: "hello" })
			}),
		).pipe(
			Effect.provide(Cipher.layer),
			Effect.provideService(Crypto.Crypto, deterministic),
		),
	)
})
test("concurrent Cipher imports share a lookup and distinct scopes import independently", async () => {
	let imports = spyOn(crypto.subtle, "importKey")
	try {
		let work = Effect.gen(function* () {
			let cipher = yield* Cipher
			let packets = yield* Effect.forEach(
				Array.from({ length: 10 }, (_, i) => String(i)),
				id => cipher.seal(key, id, "content", "room"),
				{ concurrency: "unbounded" },
			)
			expect(packets).toHaveLength(10)
		})
		await Effect.runPromise(work.pipe(Effect.provide(Cipher.live)))
		expect(imports).toHaveBeenCalledTimes(1)
		await Effect.runPromise(work.pipe(Effect.provide(Cipher.live)))
		expect(imports).toHaveBeenCalledTimes(2)
	} finally {
		imports.mockRestore()
	}
})
test("failed Cipher key imports expire immediately and retain sanitized errors", async () => {
	let actual = crypto.subtle.importKey.bind(crypto.subtle)
	let calls = 0
	let imports = spyOn(crypto.subtle, "importKey").mockImplementation(() =>
		++calls === 1
			? Promise.reject(new Error("private import fault"))
			: actual("raw", decode(key), "AES-GCM", false, ["encrypt", "decrypt"]),
	)
	try {
		await Effect.runPromise(
			Effect.gen(function* () {
				let cipher = yield* Cipher
				let failed = yield* Effect.result(cipher.importKey(key))
				expect(failed._tag).toBe("Failure")
				if (failed._tag === "Failure")
					expect(failed.failure.message).toBe("Cryptography failed: import key")
				let imported = yield* cipher.importKey(key)
				expect(imported.type).toBe("secret")
			}).pipe(Effect.provide(Cipher.live)),
		)
		expect(calls).toBe(2)
	} finally {
		imports.mockRestore()
	}
})
test("interrupting an in-flight Cipher import leaves a retryable cache", async () => {
	let actual = crypto.subtle.importKey.bind(crypto.subtle)
	let entered = Effect.runSync(Deferred.make<void>())
	let calls = 0
	let imports = spyOn(crypto.subtle, "importKey").mockImplementation(() => {
		if (++calls === 1) {
			queueMicrotask(() => Effect.runSync(Deferred.succeed(entered, undefined)))
			return new Promise<CryptoKey>(() => {})
		}
		return actual("raw", decode(key), "AES-GCM", false, ["encrypt", "decrypt"])
	})
	try {
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					let cipher = yield* Cipher
					let waiting = yield* Effect.forkChild(cipher.importKey(key))
					yield* Deferred.await(entered)
					yield* Fiber.interrupt(waiting)
					expect((yield* cipher.importKey(key)).type).toBe("secret")
				}),
			).pipe(Effect.provide(Cipher.live)),
		)
		expect(calls).toBe(2)
	} finally {
		imports.mockRestore()
	}
})
test("Cipher key imports expire after fifteen minutes using native cache time", async () => {
	let imports = spyOn(crypto.subtle, "importKey")
	try {
		await Effect.runPromise(
			Effect.gen(function* () {
				let cipher = yield* Cipher
				yield* cipher.importKey(key)
				yield* cipher.importKey(key)
				expect(imports).toHaveBeenCalledTimes(1)
				yield* TestClock.adjust("15 minutes")
				yield* cipher.importKey(key)
				expect(imports).toHaveBeenCalledTimes(2)
			}).pipe(Effect.provide(Cipher.live), Effect.provide(TestClock.layer())),
		)
	} finally {
		imports.mockRestore()
	}
})
test("Web Crypto adapter supports secure byte requests beyond the platform chunk limit", async () => {
	let bytes = await Effect.runPromise(
		Effect.gen(function* () {
			let native = yield* Crypto.Crypto
			return yield* native.randomBytes(65537)
		}).pipe(Effect.provide(webCryptoLayer)),
	)
	expect(bytes).toHaveLength(65537)
	expect(bytes.some(value => value !== 0)).toBe(true)
})

test("Cipher cache evicts old imports beyond its 256-key bound", async () => {
	let imports = spyOn(crypto.subtle, "importKey")
	try {
		await Effect.runPromise(
			Effect.gen(function* () {
				let cipher = yield* Cipher
				let oldest = yield* cipher.importKey(key)
				for (let index = 1; index <= 256; index++) {
					let bytes = new Uint8Array(32)
					bytes[0] = index % 256
					bytes[1] = Math.floor(index / 256)
					yield* cipher.importKey(encode(bytes))
				}
				expect(imports).toHaveBeenCalledTimes(257)
				expect(yield* cipher.importKey(key)).not.toBe(oldest)
				expect(imports).toHaveBeenCalledTimes(258)
			}).pipe(Effect.provide(Cipher.live)),
		)
	} finally {
		imports.mockRestore()
	}
})

test("live Cipher interoperates with legacy hashes and ciphertext in both directions", async () => {
	let old = await Effect.runPromise(
		seal(key, "legacy", { text: "old" }, "room"),
	)
	await Effect.runPromise(
		Effect.gen(function* () {
			let cipher = yield* Cipher
			expect(yield* cipher.hash("hello")).toBe(yield* hash("hello"))
			expect(yield* cipher.open(key, old, "room")).toEqual({ text: "old" })
			let current = yield* cipher.seal(key, "current", { text: "new" }, "room")
			expect(yield* open(key, current, "room")).toEqual({ text: "new" })
		}).pipe(Effect.provide(Cipher.live)),
	)
})
test("malformed Cipher packets report typed decryption failures", async () => {
	let rawKey = await crypto.subtle.importKey(
		"raw",
		decode(key),
		"AES-GCM",
		false,
		["encrypt"],
	)
	let iv = new Uint8Array(12)
	let bytes = await crypto.subtle.encrypt(
		{
			name: "AES-GCM",
			iv,
			additionalData: new TextEncoder().encode("room:invalid-json"),
		},
		rawKey,
		new TextEncoder().encode("not JSON"),
	)
	await Effect.runPromise(
		Effect.gen(function* () {
			let cipher = yield* Cipher
			let valid = yield* cipher.seal(key, "valid", "body", "room")
			for (let packet of [
				{ ...valid, iv: "!" },
				{ ...valid, id: "wrong-aad" },
				{
					id: "invalid-json",
					iv: encode(iv),
					body: encode(new Uint8Array(bytes)),
				},
			]) {
				let result = yield* Effect.result(cipher.open(key, packet, "room"))
				expect(result._tag).toBe("Failure")
				if (result._tag === "Failure") {
					expect(result.failure._tag).toBe("CryptoError")
					expect(result.failure.message).toBe("Cryptography failed: decrypt")
				}
			}
		}).pipe(Effect.provide(Cipher.live)),
	)
})
test("interrupting one Cipher waiter preserves another waiter's shared import", async () => {
	let actual = crypto.subtle.importKey.bind(crypto.subtle)
	let entered = Effect.runSync(Deferred.make<void>())
	let release = Effect.runSync(Deferred.make<void>())
	let imports = spyOn(crypto.subtle, "importKey").mockImplementation(() => {
		queueMicrotask(() => Effect.runSync(Deferred.succeed(entered, undefined)))
		return Effect.runPromise(Deferred.await(release)).then(() =>
			actual("raw", decode(key), "AES-GCM", false, ["encrypt", "decrypt"]),
		)
	})
	try {
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					let cipher = yield* Cipher
					let first = yield* Effect.forkChild(cipher.importKey(key))
					yield* Deferred.await(entered)
					let second = yield* Effect.forkChild(cipher.importKey(key))
					yield* Effect.yieldNow
					yield* Fiber.interrupt(first)
					yield* Deferred.succeed(release, undefined)
					expect((yield* Fiber.join(second)).type).toBe("secret")
					expect(imports).toHaveBeenCalledTimes(1)
				}),
			).pipe(Effect.provide(Cipher.live)),
		)
	} finally {
		Effect.runSync(Deferred.succeed(release, undefined))
		imports.mockRestore()
	}
})

test("closing child work interrupts crypto without disposing the root Cipher cache", async () => {
	let imports = spyOn(crypto.subtle, "importKey")
	let entered = Effect.runSync(Deferred.make<void>())
	let interrupted = Effect.runSync(Deferred.make<void>())
	let source = Crypto.make({
		randomBytes: size => new Uint8Array(size).fill(7),
		digest: () => Effect.succeed(new Uint8Array()),
	})
	let calls = 0
	let controlled = {
		...source,
		randomBytes(size: number) {
			return Effect.suspend(() => {
				if (size === 12 && ++calls === 2)
					return Deferred.succeed(entered, undefined).pipe(
						Effect.andThen(Effect.never),
						Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
					)
				return source.randomBytes(size)
			})
		},
	}
	try {
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					let cipher = yield* Cipher
					let child = yield* TaskGroup.make
					yield* cipher.seal(key, "before", "cached", "room")
					let pending = child.fork(
						cipher.seal(key, "pending", "cancelled", "room"),
					)
					yield* Deferred.await(entered)
					yield* child.close()
					expect(yield* Deferred.isDone(interrupted)).toBe(true)
					expect((yield* Fiber.await(pending))._tag).toBe("Failure")
					let after = yield* cipher.seal(key, "after", "usable", "room")
					expect(yield* cipher.open(key, after, "room")).toBe("usable")
					expect(decode(yield* cipher.secret())).toHaveLength(32)
					expect(imports).toHaveBeenCalledTimes(1)
				}),
			).pipe(
				Effect.provide(Cipher.layer),
				Effect.provideService(Crypto.Crypto, controlled),
				Effect.provide(FetchHttpClient.layer),
			),
		)
	} finally {
		imports.mockRestore()
	}
})

test("native Cipher authenticates frozen standard-Base64 bytes and rejects changed room, key and ciphertext", async () => {
	let key = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="
	let packet = {
		id: "legacy-operation",
		iv: "AAECAwQFBgcICQoL",
		body: "PCCifr2R4CGvFPni0oYcCKMzAbEV1eZcyPh0Dj9FItFuZcCIjfsl5Y5/n95J5dK+g5pbJZB1nWQ=",
	}
	await Effect.runPromise(
		Effect.gen(function* () {
			let cipher = yield* Cipher
			expect(yield* cipher.hash("hello")).toBe(
				"LPJNul-wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ",
			)
			expect(yield* cipher.open(key, packet, "legacy-room")).toEqual({
				text: "Unicode 内容 👋",
				count: 7,
			})
			let bytes = decode(packet.body)
			bytes[0] = (bytes[0] ?? 0) ^ 1
			for (let operation of [
				cipher.open(key, packet, "wrong-room"),
				cipher.open(encode(new Uint8Array(32).fill(42)), packet, "legacy-room"),
				cipher.open(key, { ...packet, body: encode(bytes) }, "legacy-room"),
				cipher.open(key, { ...packet, iv: "!" }, "legacy-room"),
				cipher.importKey("private-invalid-key!"),
			]) {
				let result = yield* Effect.result(operation)
				expect(result._tag).toBe("Failure")
				if (result._tag === "Failure") {
					expect(result.failure._tag).toBe("CryptoError")
					expect(result.failure.message).not.toContain("private-invalid-key!")
				}
			}
		}).pipe(Effect.provide(Cipher.live)),
	)
})
