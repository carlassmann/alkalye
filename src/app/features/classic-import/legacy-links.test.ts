import { afterEach, expect, test, vi } from "vitest"
import { legacyLinkTarget, resolveLegacyLink } from "./legacy-links"
vi.mock("@/app/features/agents/lib/agent-api", () => ({
	deviceAuthorization: () => ({}),
}))
afterEach(() => vi.unstubAllGlobals())
test.each(["doc", "spaces", "themes"])(
	"fresh visitor resolves a readable Classic %s link without importing",
	async segment => {
		let path = `/app/${segment}/co_z123/preview`
		let id = "00000000-0000-4000-8000-000000000001"
		let fetcher = vi.fn().mockResolvedValue(Response.json({ id }))
		vi.stubGlobal("fetch", fetcher)
		expect(
			await resolveLegacyLink(path, "key", new AbortController().signal),
		).toBe(`/app/${segment}/${id}/preview`)
		expect(fetcher.mock.calls[0]?.[0]).toContain("action=lookup")
		expect(legacyLinkTarget(path)?.classicId).toBe("co_z123")
	},
)
test("unreadable and unmigrated links remain explicit missing states", async () => {
	vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ id: null })))
	expect(
		await resolveLegacyLink(
			"/app/doc/co_z123",
			"key",
			new AbortController().signal,
		),
	).toBeNull()
	expect(legacyLinkTarget("/app/doc/ordinary-uuid")).toBeNull()
})
