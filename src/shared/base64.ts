import * as Result from "effect/Result"
import * as Base64Url from "effect/encoding/Base64Url"

export function encode(bytes: Uint8Array): string {
	return Base64Url.encode(bytes)
}
export function decode(text: string): Uint8Array<ArrayBuffer> {
	let normalized = text
		.replace(/[\t\n\f\r ]/g, "")
		.replaceAll("+", "-")
		.replaceAll("/", "_")
	// Persisted links accepted standard Base64 and ASCII whitespace; incomplete explicit padding never did.
	if (normalized.includes("=") && normalized.length % 4 !== 0)
		throw invalidBase64()
	return new Uint8Array(
		Result.getOrThrowWith(Base64Url.decode(normalized), invalidBase64),
	)
}
function invalidBase64() {
	return new DOMException("Invalid Base64 data", "InvalidCharacterError")
}
