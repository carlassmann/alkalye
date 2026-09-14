import { vi } from "vitest"

// jsdom lacks matchMedia; components that call useTheme need a stub.
if (typeof window !== "undefined" && !window.matchMedia) {
	window.matchMedia = vi.fn().mockImplementation(query => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn(),
	}))
}

// On Node ≥21 the experimental localStorage built-in is undefined without
// --localstorage-file and shadows jsdom's implementation for bare `localStorage`
// references in modules evaluated at import time.
if (typeof localStorage === "undefined" || localStorage === undefined) {
	vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} })
}
