import { describe, expect, test } from "vitest"
import { readJsonResponse } from "./agent-api"

describe("readJsonResponse", () => {
	test("returns undefined when an upstream failure has no response body", async () => {
		let response = new Response(null, { status: 500 })

		await expect(readJsonResponse(response)).resolves.toBeUndefined()
	})
})
