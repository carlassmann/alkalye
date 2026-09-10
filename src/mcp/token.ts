import { Buffer } from "node:buffer"
import { z } from "zod"

export { createTokenCodec }
export type { TokenCodec }

let tokenEnvelopeSchema = z.object({
	version: z.literal(1),
	type: z.string(),
	expiresAt: z.number().optional(),
	payload: z.unknown(),
})

interface TokenCodec {
	seal(type: string, payload: unknown, expiresAt?: number): Promise<string>
	open<T>(type: string, token: string, schema: z.ZodType<T>): Promise<T>
}

function createTokenCodec(key: string): TokenCodec {
	let keyBytes = decodeKey(key)

	return {
		async seal(type, payload, expiresAt) {
			let iv = crypto.getRandomValues(new Uint8Array(12))
			let cryptoKey = await importKey(keyBytes)
			let plaintext = new TextEncoder().encode(
				JSON.stringify({ version: 1, type, expiresAt, payload }),
			)
			let encrypted = await crypto.subtle.encrypt(
				{ name: "AES-GCM", iv, additionalData: tokenPurpose(type) },
				cryptoKey,
				plaintext,
			)
			return `v1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(encrypted))}`
		},
		async open(type, token, schema) {
			let [version, encodedIv, encodedCiphertext, extra] = token.split(".")
			if (version !== "v1" || !encodedIv || !encodedCiphertext || extra) {
				throw new Error("invalid_token")
			}

			try {
				let cryptoKey = await importKey(keyBytes)
				let decrypted = await crypto.subtle.decrypt(
					{
						name: "AES-GCM",
						iv: fromBase64Url(encodedIv),
						additionalData: tokenPurpose(type),
					},
					cryptoKey,
					fromBase64Url(encodedCiphertext),
				)
				let parsed: unknown = JSON.parse(new TextDecoder().decode(decrypted))
				let envelope = tokenEnvelopeSchema.parse(parsed)
				if (envelope.type !== type) throw new Error("wrong_token_type")
				if (envelope.expiresAt && envelope.expiresAt <= Date.now()) {
					throw new Error("expired_token")
				}
				return schema.parse(envelope.payload)
			} catch (error) {
				if (
					error instanceof Error &&
					(error.message === "wrong_token_type" ||
						error.message === "expired_token")
				) {
					throw error
				}
				throw new Error("invalid_token")
			}
		},
	}
}

function decodeKey(value: string): Uint8Array<ArrayBuffer> {
	let bytes = fromBase64Url(value)
	if (bytes.byteLength !== 32) {
		throw new Error("ALKALYE_MCP_TOKEN_KEY must be 32 base64url-encoded bytes")
	}
	return bytes
}

function importKey(bytes: Uint8Array<ArrayBuffer>) {
	return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
		"encrypt",
		"decrypt",
	])
}

function tokenPurpose(type: string) {
	return new TextEncoder().encode(`alkalye:mcp:${type}:v1`)
}

function toBase64Url(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64url")
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
	let decoded = Buffer.from(value, "base64url")
	let bytes = new Uint8Array(decoded.byteLength)
	bytes.set(decoded)
	return bytes
}
