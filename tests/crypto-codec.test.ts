import { expect, test } from "bun:test"
import { run } from "../src/platform/effects"
import {
	accountRoom,
	decode,
	encode,
	hash,
	importKey,
	open,
	parseInvite,
	seal,
} from "./legacy-crypto"

function legacyEncode(bytes: Uint8Array) {
	return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(""))
}
function legacyDecode(value: string) {
	return Uint8Array.from(
		atob(value.replaceAll("-", "+").replaceAll("_", "/")),
		character => character.charCodeAt(0),
	)
}
test("native Base64Url preserves every byte, padding remainder and stored alphabet", () => {
	for (let length = 0; length < 260; length++) {
		let bytes = Uint8Array.from({ length }, (_, index) => index % 256)
		let standard = legacyEncode(bytes)
		let url = standard
			.replaceAll("+", "-")
			.replaceAll("/", "_")
			.replaceAll("=", "")
		expect(encode(bytes)).toBe(url)
		for (let value of [
			standard,
			standard.replaceAll("=", ""),
			url,
			` \t${standard}\n\f\r `,
		])
			expect(decode(value)).toEqual(bytes)
	}
})
test("native decoding retains platform rejection of malformed stored encodings", () => {
	for (let value of [
		"A",
		"Zg=",
		"Zm8==",
		"Zg===",
		"=AAA",
		"AA=A",
		"====",
		"AA!A",
		"AA☃A",
		"\u00a0Zg",
		"Zg\u000b",
		"Zg\u0000",
	]) {
		expect(() => legacyDecode(value)).toThrow()
		expect(() => decode(value)).toThrow("Invalid Base64 data")
	}
})
test("native codec keeps known recovery hashes and Unicode invitation links compatible", async () => {
	expect(await run(hash("hello"))).toBe(
		"LPJNul-wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ",
	)
	let room = {
		...(await run(accountRoom("known recovery phrase"))),
		name: "Über notes 👋",
	}
	let oldLink = legacyEncode(new TextEncoder().encode(JSON.stringify(room)))
	expect(parseInvite(oldLink)).toEqual(room)
	expect(
		parseInvite(encode(new TextEncoder().encode(JSON.stringify(room)))),
	).toEqual(room)
})
test("native codec opens packets encoded with legacy standard Base64", async () => {
	let bytes = Uint8Array.from({ length: 32 }, (_, index) => index)
	let key = legacyEncode(bytes)
	let value = { text: "Unicode 内容 👋", count: 7 }
	let packet = await run(seal(key, "legacy-operation", value, "legacy-room"))
	let legacyPacket = {
		...packet,
		iv: legacyEncode(decode(packet.iv)),
		body: legacyEncode(decode(packet.body)),
	}
	expect(await run(open(key, legacyPacket, "legacy-room"))).toEqual(value)
	await expect(run(open(key, legacyPacket, "different-room"))).rejects.toThrow()
})

test("native decoding opens a frozen pre-adapter AES-GCM packet", async () => {
	let key = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="
	let packet = {
		id: "legacy-operation",
		iv: "AAECAwQFBgcICQoL",
		body: "PCCifr2R4CGvFPni0oYcCKMzAbEV1eZcyPh0Dj9FItFuZcCIjfsl5Y5/n95J5dK+g5pbJZB1nWQ=",
	}
	expect(await run(open(key, packet, "legacy-room"))).toEqual({
		text: "Unicode 内容 👋",
		count: 7,
	})
	expect(decode(key).buffer).toBeInstanceOf(ArrayBuffer)
})
test("malformed cryptographic fields retain typed sanitized failures", async () => {
	await expect(run(importKey("private-invalid-key!"))).rejects.toThrow(
		"Cryptography failed: import key",
	)
	let key = encode(new Uint8Array(32))
	await expect(
		run(open(key, { id: "invalid-operation", iv: "!", body: "" }, "room")),
	).rejects.toThrow("Cryptography failed: decrypt")
})
