import { describe, expect, test, vi } from "vitest"
import { isApplePlatform, isStandaloneDisplayMode } from "./platform"

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

describe("isStandaloneDisplayMode", () => {
	test("detects the standards-based standalone display mode", () => {
		vi.spyOn(window, "matchMedia").mockReturnValue({
			matches: true,
			media: "(display-mode: standalone)",
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn(),
		})

		expect(isStandaloneDisplayMode()).toBe(true)
	})

	test("returns false in an ordinary browser", () => {
		vi.spyOn(window, "matchMedia").mockReturnValue({
			matches: false,
			media: "(display-mode: standalone)",
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn(),
		})

		expect(isStandaloneDisplayMode()).toBe(false)
	})
})
