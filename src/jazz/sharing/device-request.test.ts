// @vitest-environment node
import { Buffer } from "node:buffer"
import { createHash, generateKeyPairSync, sign } from "node:crypto"
import { expect, test } from "vitest"
import { deviceAccountFor } from "./device-request"
let audience = "https://app.test/jazz"
let appId = "00000000-0000-4000-8000-000000000001"
function uuid(namespace: Buffer, name: Buffer) {
	let digest = createHash("sha1")
		.update(namespace)
		.update(name)
		.digest()
		.subarray(0, 16)
	digest[6] = (digest[6] & 15) | 80
	digest[8] = (digest[8] & 63) | 128
	return digest
		.toString("hex")
		.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5")
}
function request(overrides: object = {}) {
	let { publicKey, privateKey } = generateKeyPairSync("ed25519")
	let key = publicKey.export({ format: "der", type: "spki" }).subarray(-32)
	let now = Math.floor(Date.now() / 1000)
	let claims = {
		iss: "urn:jazz:local-first",
		sub: uuid(Buffer.from("jazz-auth-key-v1"), key),
		aud: uuid(
			Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex"),
			Buffer.from(audience),
		),
		jazz_pub_key: key.toString("base64url"),
		iat: now,
		exp: now + 60,
		...overrides,
	}
	let message =
		Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "JWT" })).toString(
			"base64url",
		) +
		"." +
		Buffer.from(JSON.stringify(claims)).toString("base64url")
	let token =
		message +
		"." +
		sign(null, Buffer.from(message), privateKey).toString("base64url")
	return new Request("https://app.test/api/sharing/redeem", {
		headers: { authorization: "Bearer " + token },
	})
}
test("device proof verifies signature, subject, audience and expiry", () => {
	expect(deviceAccountFor(request(), audience)).toMatch(/^[a-f0-9-]{36}$/)
	expect(() => deviceAccountFor(request({ sub: appId }), audience)).toThrow(
		"subject",
	)
	expect(() => deviceAccountFor(request({ exp: 1 }), audience)).toThrow(
		"Expired",
	)
	expect(() => deviceAccountFor(request(), "https://other.test/jazz")).toThrow(
		"foreign",
	)
	let forged = request()
	forged.headers.set(
		"authorization",
		forged.headers.get("authorization")?.slice(0, -10) + "AAAAAAAAAA",
	)
	expect(() => deviceAccountFor(forged, audience)).toThrow("signature")
})
