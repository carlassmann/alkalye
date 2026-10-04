import { expect, test } from "bun:test"
import { mergeText } from "../src/shared/text-merge"

let base = "# Title\n\nFirst line\nSecond line\nThird line\n\nClosing\n"

test("edits on different lines from the editor and the disk combine", () => {
	let local = base.replace("First line", "First line, edited here")
	let disk = base.replace("Closing", "Closing, edited elsewhere")
	expect(mergeText(base, local, disk)).toEqual({
		content:
			"# Title\n\nFirst line, edited here\nSecond line\nThird line\n\nClosing, edited elsewhere\n",
		conflict: false,
	})
	expect(mergeText(base, disk, local).content).toBe(
		mergeText(base, local, disk).content,
	)
})

test("unchanged sides take the other side and identical edits merge once", () => {
	let edited = base + "Appendix\n"
	expect(mergeText(base, base, edited)).toEqual({
		content: edited,
		conflict: false,
	})
	expect(mergeText(base, edited, base)).toEqual({
		content: edited,
		conflict: false,
	})
	expect(mergeText(base, edited, edited)).toEqual({
		content: edited,
		conflict: false,
	})
	let both = base.replace("Second line", "Same change")
	expect(
		mergeText(
			base,
			both.replace("Closing", "Local closing"),
			both.replace("# Title", "# Disk title"),
		),
	).toEqual({
		content:
			"# Disk title\n\nFirst line\nSame change\nThird line\n\nLocal closing\n",
		conflict: false,
	})
})

test("overlapping or adjacent edits conflict and keep the local text", () => {
	let local = base.replace("Second line", "Local second")
	for (let disk of [
		base.replace("Second line", "Disk second"),
		base.replace("Third line", "Disk third"),
		base.replace("Second line\n", ""),
	])
		expect(mergeText(base, local, disk)).toEqual({
			content: local,
			conflict: true,
		})
})

test("empty files, missing trailing newlines and insertions at the end merge", () => {
	expect(mergeText("", "local\n", "")).toEqual({
		content: "local\n",
		conflict: false,
	})
	expect(mergeText("a\nb", "a\nb\nlocal", "disk\na\nb")).toEqual({
		content: "disk\na\nb\nlocal",
		conflict: false,
	})
	expect(mergeText("a", "a local", "a disk").conflict).toBe(true)
})

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
