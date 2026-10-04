import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as PlatformError from "effect/PlatformError"

export let webCryptoLayer = Layer.succeed(
	Crypto.Crypto,
	Crypto.make({
		randomBytes(size) {
			let bytes = new Uint8Array(size)
			for (let offset = 0; offset < size; offset += 65536)
				crypto.getRandomValues(bytes.subarray(offset, offset + 65536))
			return bytes
		},
		digest(algorithm, data) {
			return Effect.tryPromise({
				try: () => crypto.subtle.digest(algorithm, new Uint8Array(data)),
				catch: cause =>
					PlatformError.systemError({
						_tag: "Unknown",
						module: "Crypto",
						method: "digest",
						cause,
					}),
			}).pipe(Effect.map(buffer => new Uint8Array(buffer)))
		},
	}),
)
