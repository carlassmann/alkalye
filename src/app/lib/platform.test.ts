import { describe, expect, test } from "vitest"
import { isApplePlatform } from "./platform"

describe("isApplePlatform", () => {
	test("recognizes macOS and iOS user agents", () => {
		expect(
			isApplePlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)"),
		).toBe(true)
		expect(isApplePlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)")).toBe(
			true,
		)
	})

	test("keeps non-Apple platforms on the standard share icon", () => {
		expect(isApplePlatform("Mozilla/5.0 (Linux; Android 15)")).toBe(false)
		expect(isApplePlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(
			false,
		)
	})
})
