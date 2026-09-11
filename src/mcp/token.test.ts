import { Buffer } from "node:buffer"
import { describe, expect, test } from "vitest"
import { z } from "zod"
import { createTokenCodec } from "./token"

let payloadSchema = z.object({ connectionId: z.string() })

describe("MCP token codec", () => {
	test("keeps the agent credential confidential and detects tampering", async () => {
		let codec = createTokenCodec(Buffer.alloc(32, 7).toString("base64url"))
		let token = await codec.seal("connection", {
			connectionId: "co_zprivate",
		})

		expect(token).not.toContain("co_zprivate")
		expect(await codec.open("connection", token, payloadSchema)).toEqual({
			connectionId: "co_zprivate",
		})

		let lastCharacter = token.at(-1)
		let tampered = `${token.slice(0, -1)}${lastCharacter === "A" ? "B" : "A"}`
		await expect(
			codec.open("connection", tampered, payloadSchema),
		).rejects.toThrow("invalid_token")
	})

	test("rejects expired and cross-purpose tokens", async () => {
		let codec = createTokenCodec(Buffer.alloc(32, 9).toString("base64url"))
		let token = await codec.seal(
			"authorization_code",
			{ connectionId: "co_zagent" },
			Date.now() - 1,
		)

		await expect(
			codec.open("authorization_code", token, payloadSchema),
		).rejects.toThrow("expired_token")
		await expect(
			codec.open("access_token", token, payloadSchema),
		).rejects.toThrow("invalid_token")
	})
})
