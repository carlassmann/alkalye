import { expect, test } from "bun:test"

test("Markdown keeps relative file paths but still refuses unknown schemes", async () => {
	let { markdown, safeUrl } = await import("../src/shared/markdown")
	expect(safeUrl("assets/photo one.png")).toBe("assets/photo one.png")
	expect(safeUrl("../shared/map.png")).toBe("../shared/map.png")
	for (let unsafe of [
		"javascript:alert(1)",
		" JavaScript:alert(1)",
		"java\tscript:alert(1)",
		"vbscript:x",
		"data:text/html,<script>",
	])
		expect(safeUrl(unsafe)).toBe("#")
	expect(markdown("![Map](assets/map.png)")).toContain('src="assets/map.png"')
})
