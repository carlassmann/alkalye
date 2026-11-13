import { Buffer } from "node:buffer"
import { createHash, createPublicKey, verify } from "node:crypto"
import { z } from "zod"

export { deviceAccountFor }

let tokenSchema = z
	.object({
		iss: z.literal("urn:jazz:local-first"),
		sub: z.string().uuid(),
		aud: z.string().uuid(),
		jazz_pub_key: z.string(),
		iat: z.number().int(),
		exp: z.number().int(),
	})
	.strict()

// Alpha.61 accountFor/withAttribution only authenticate external users, not device proofs.
function deviceAccountFor(request: Request, publicUrl: string) {
	let token = request.headers.get("authorization")?.replace(/^Bearer /, "")
	if (!token) throw new Error("Device account required")
	let [header, payload, signature, extra] = token.split(".")
	if (!header || !payload || !signature || extra)
		throw new Error("Invalid device proof")
	let algorithm = z
		.object({ alg: z.literal("EdDSA"), typ: z.literal("JWT") })
		.strict()
		.parse(JSON.parse(Buffer.from(header, "base64url").toString()))
	if (algorithm.alg !== "EdDSA") throw new Error("Invalid algorithm")
	let claims = tokenSchema.parse(
		JSON.parse(Buffer.from(payload, "base64url").toString()),
	)
	let now = Math.floor(Date.now() / 1000)
	if (
		claims.aud !==
			uuidV5("6ba7b810-9dad-11d1-80b4-00c04fd430c8", Buffer.from(publicUrl)) ||
		claims.iat > now + 5 ||
		claims.exp <= now ||
		claims.exp - claims.iat > 60
	)
		throw new Error("Expired or foreign device proof")
	let key = Buffer.from(claims.jazz_pub_key, "base64url")
	if (key.length !== 32) throw new Error("Invalid device key")
	let publicKey = createPublicKey({
		key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), key]),
		format: "der",
		type: "spki",
	})
	if (
		!verify(
			null,
			Buffer.from(header + "." + payload),
			publicKey,
			Buffer.from(signature, "base64url"),
		)
	)
		throw new Error("Invalid device signature")
	if (
		claims.sub !== uuidV5(Buffer.from("jazz-auth-key-v1").toString("hex"), key)
	)
		throw new Error("Invalid device subject")
	return uuidV5(
		claims.aud,
		Buffer.from("jazz-account-founder-v1\0" + claims.sub),
	)
}
function uuidV5(namespace: string, name: Buffer) {
	let bytes = createHash("sha1")
		.update(Buffer.from(namespace.replaceAll("-", ""), "hex"))
		.update(name)
		.digest()
		.subarray(0, 16)
	bytes[6] = (bytes[6] & 15) | 80
	bytes[8] = (bytes[8] & 63) | 128
	let hex = bytes.toString("hex")
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
