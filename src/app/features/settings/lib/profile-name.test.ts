import { describe, expect, test } from "vitest"
import { makeProfileNameSchema } from "./profile-name"

describe("profile name", () => {
	let schema = makeProfileNameSchema({
		required: "Name is required",
		tooLong: "Name is too long",
	})

	test("rejects whitespace-only names", () => {
		let result = schema.safeParse("   ")
		expect(result.success).toBe(false)
		if (result.success) return
		expect(result.error.issues.map(issue => issue.message)).toEqual([
			"Name is required",
		])
	})

	test("trims valid names before submission", () => {
		expect(schema.parse("  Writer  ")).toBe("Writer")
	})

	test("measures the trimmed name", () => {
		expect(schema.safeParse(`  ${"a".repeat(50)}  `).success).toBe(true)
		expect(schema.safeParse("a".repeat(51)).success).toBe(false)
	})
})
