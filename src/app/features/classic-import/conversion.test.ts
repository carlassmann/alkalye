// @vitest-environment node
import { expect, test } from "vitest"
import { entropyToMnemonic } from "@scure/bip39"
import { wordlist } from "@scure/bip39/wordlists/english.js"
import { RecoveryPhrase } from "jazz-tools/passphrase"
import { WasmCrypto } from "cojson/crypto/WasmCrypto"
import { cojsonInternals } from "cojson"
import { deviceSecretFromSeed, readClassicCredentials } from "./identity"
import {
	groupHistory,
	packBytes,
	unpackBytes,
	stableId,
	resolveClassicAnchor,
	rewriteReferences,
} from "./conversion"
import { verifyClassicProof } from "./verification"

test("Classic's exact localStorage seed format restores the same 24 words for anonymous accounts", () => {
	let seed = new Uint8Array(32).fill(17)
	let stored = readClassicCredentials({
		getItem: key =>
			key === "jazz-logged-in-secret"
				? JSON.stringify({
						accountID: "co_z123",
						accountSecret: "sealerSecret_zabc/signerSecret_zdef",
						secretSeed: Array.from(seed),
						provider: "anonymous",
					})
				: null,
	})
	expect(stored?.secretSeed).toEqual(Array.from(seed))
	expect(RecoveryPhrase.fromSecret(deviceSecretFromSeed(seed))).toBe(
		entropyToMnemonic(seed, wordlist),
	)
})
test("anchors preserve exact positions, recover unique context, and reject ambiguous quotes", () => {
	let anchor = { quote: "same", contextBefore: "", contextAfter: "" }
	expect(resolveClassicAnchor("same and same", anchor, 9, 13)).toEqual({
		start: 9,
		end: 13,
	})
	expect(resolveClassicAnchor("same and same", anchor)).toBeUndefined()
	expect(
		resolveClassicAnchor("changed same", {
			...anchor,
			contextBefore: "changed ",
		}),
	).toEqual({ start: 8, end: 12 })
	expect(resolveClassicAnchor("deleted", anchor)).toBeUndefined()
})
test("history groups an author's typing, preserves author changes, and bounds bytes and count", () => {
	let versions = Array.from({ length: 250 }, (_, index) => ({
		content: `version ${index}`,
		authorId: index < 3 ? "a" : `author-${index}`,
		createdAt: new Date(index * 1000),
	}))
	let grouped = groupHistory(versions)
	expect(grouped).toHaveLength(200)
	expect(grouped.at(-1)?.content).toBe("version 249")
	expect(groupHistory(versions.slice(0, 4))).toHaveLength(2)
	expect(groupHistory(versions, 200, 20)).toHaveLength(1)
})
test("stable ids and references are account-independent; checksum corruption is rejected", async () => {
	let first = await stableId("co_z123")
	expect(first).toBe(await stableId("co_z123"))
	expect(first).not.toBe(await stableId("co_z124"))
	expect(
		await rewriteReferences("![asset](asset:co_z123) [[co_z124|note]]"),
	).toBe(`![asset](asset:${first}) [[${await stableId("co_z124")}|note]]`)
	expect(await rewriteReferences("A literal co_z123 stays unchanged.")).toBe(
		"A literal co_z123 stays unchanged.",
	)
	expect(
		await rewriteReferences(
			"---\nbacklinks: [co_z123]\n---\n\nLiteral co_z123",
		),
	).toBe(`---\nbacklinks: [${first}]\n---\n\nLiteral co_z123`)
	let bytes = new Uint8Array([0, 255, 1, 3])
	let packed = await packBytes(bytes)
	expect(await unpackBytes(packed)).toEqual(bytes)
	await expect(
		unpackBytes({ ...packed, base64: btoa("tampered") }),
	).rejects.toThrow("checksum")
})
test("Classic proof binds the signed challenge to the account header hash and v2 account", async () => {
	let crypto = await WasmCrypto.create()
	let secret = crypto.agentSecretFromSecretSeed(new Uint8Array(32).fill(42))
	let classicId = cojsonInternals.idforHeader(
		cojsonInternals.accountHeaderForInitialAgentSecret(secret, crypto),
		crypto,
	)
	let message = { nonce: "unpredictable challenge", accountId: "v2 account A" }
	let proof = {
		classicId,
		challengeId: globalThis.crypto.randomUUID(),
		agentId: crypto.getAgentID(secret),
		signature: crypto.sign(crypto.getAgentSignerSecret(secret), message),
	}
	expect(verifyClassicProof(crypto, proof, message)).toBe(true)
	expect(
		verifyClassicProof(crypto, proof, {
			...message,
			accountId: "v2 account B",
		}),
	).toBe(false)
	expect(
		verifyClassicProof(crypto, proof, { ...message, nonce: "another nonce" }),
	).toBe(false)
	let attacker = crypto.newRandomAgentSecret()
	expect(
		verifyClassicProof(
			crypto,
			{
				...proof,
				agentId: crypto.getAgentID(attacker),
				signature: crypto.sign(crypto.getAgentSignerSecret(attacker), message),
			},
			message,
		),
	).toBe(false)
})
