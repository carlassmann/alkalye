import { afterEach, describe, expect, it, vi } from "vitest"
import JSZip from "jszip"
import {
	canShareDocument,
	createDocumentExport,
	shareDocument,
	transformWikilinksForExport,
	stripBacklinksFrontmatter,
	getRelativePath,
} from "./export"

afterEach(() => vi.unstubAllGlobals())

describe("document sharing", () => {
	it("bundles assets with the shared document", async () => {
		let file = await createDocumentExport("![Logo](asset:logo)", "Notes", [
			{
				id: "logo",
				name: "logo",
				blob: new Blob(["image"], { type: "image/png" }),
			},
		])

		expect(file.name).toBe("Notes.zip")
		let archive = await JSZip.loadAsync(file)
		await expect(archive.file("Notes/Notes.md")?.async("string")).resolves.toBe(
			"![Logo](assets/logo.png)",
		)
	})

	it("shares markdown content as a safely named file", async () => {
		let share = vi.fn().mockResolvedValue(undefined)
		vi.stubGlobal("navigator", {
			share,
			canShare: vi.fn().mockReturnValue(true),
		})

		await expect(shareDocument("# Notes", "Notes: draft")).resolves.toBe(true)

		let shareData = share.mock.calls[0]?.[0]
		expect(shareData?.title).toBe("Notes_ draft")
		expect(shareData?.files[0]?.name).toBe("Notes_ draft.md")
		expect(shareData?.files[0]?.size).toBe(new Blob(["# Notes"]).size)
	})

	it("requires browser support for sharing files", () => {
		vi.stubGlobal("navigator", { share: vi.fn() })

		expect(canShareDocument()).toBe(false)
	})
})

describe("getRelativePath", () => {
	it("returns title only when both docs at root", () => {
		expect(getRelativePath(null, null, "My Doc")).toBe("My Doc")
	})

	it("returns absolute path when source at root, target in folder", () => {
		expect(getRelativePath(null, "notes", "My Doc")).toBe("/notes/My Doc")
		expect(getRelativePath(null, "notes/sub", "My Doc")).toBe(
			"/notes/sub/My Doc",
		)
	})

	it("returns ../title when source one level deep, target at root", () => {
		expect(getRelativePath("notes", null, "My Doc")).toBe("../My Doc")
	})

	it("returns absolute when source more than one level deep, target at root", () => {
		expect(getRelativePath("notes/sub", null, "My Doc")).toBe("/My Doc")
	})

	it("returns title only when both in same folder", () => {
		expect(getRelativePath("notes", "notes", "My Doc")).toBe("My Doc")
		expect(getRelativePath("a/b/c", "a/b/c", "My Doc")).toBe("My Doc")
	})

	it("returns relative path when one level up", () => {
		// Sibling folders (one level up)
		expect(getRelativePath("notes", "docs", "My Doc")).toBe("../docs/My Doc")
	})

	it("returns absolute path when more than one level up", () => {
		// Two levels up -> absolute
		expect(getRelativePath("notes/sub", "docs", "My Doc")).toBe("/docs/My Doc")

		// Complex path needing multiple ups -> absolute
		expect(getRelativePath("a/b/c", "a/x/y", "My Doc")).toBe("/a/x/y/My Doc")
	})

	it("returns relative path when descending into subfolder", () => {
		expect(getRelativePath("notes", "notes/sub", "My Doc")).toBe("sub/My Doc")
	})

	it("sanitizes unsafe characters in title", () => {
		expect(getRelativePath(null, null, "My: Doc?")).toBe("My_ Doc_")
	})
})

describe("transformWikilinksForExport", () => {
	let docs = [
		{ id: "co_a", title: "Doc A", path: null },
		{ id: "co_b", title: "Doc B", path: "notes" },
		{ id: "co_c", title: "Doc C", path: "notes/sub" },
		{ id: "co_d", title: "Doc D", path: "other" },
	]

	it("transforms wikilinks to paths", () => {
		let content = "Link to [[co_a]] and [[co_b]]"
		let result = transformWikilinksForExport(content, null, docs)
		// From root: Doc A is title-only, Doc B in notes uses absolute
		expect(result).toBe("Link to [[Doc A]] and [[/notes/Doc B]]")
	})

	it("uses relative paths when one level up, absolute otherwise", () => {
		// From notes folder, linking to:
		// - Doc A at root: ../Doc A (one level up)
		// - Doc B in same folder: Doc B
		// - Doc C in subfolder: sub/Doc C
		// - Doc D in sibling folder: ../other/Doc D (one level up)
		let content = "[[co_a]] [[co_b]] [[co_c]] [[co_d]]"
		let result = transformWikilinksForExport(content, "notes", docs)
		expect(result).toBe(
			"[[../Doc A]] [[Doc B]] [[sub/Doc C]] [[../other/Doc D]]",
		)
	})

	it("keeps unknown doc IDs as-is", () => {
		let content = "Link to [[co_unknown]]"
		let result = transformWikilinksForExport(content, null, docs)
		expect(result).toBe("Link to [[co_unknown]]")
	})

	it("handles content with no wikilinks", () => {
		let content = "No links here"
		let result = transformWikilinksForExport(content, null, docs)
		expect(result).toBe("No links here")
	})

	it("handles multiple wikilinks to same doc", () => {
		let content = "First [[co_a]] and again [[co_a]]"
		let result = transformWikilinksForExport(content, null, docs)
		expect(result).toBe("First [[Doc A]] and again [[Doc A]]")
	})

	it("preserves wikilink context (text around it)", () => {
		let content = "Check out [[co_a]] for details.\n\nAlso see [[co_b]]."
		let result = transformWikilinksForExport(content, null, docs)
		expect(result).toBe(
			"Check out [[Doc A]] for details.\n\nAlso see [[/notes/Doc B]].",
		)
	})
})

describe("stripBacklinksFrontmatter", () => {
	it("removes backlinks field from frontmatter", () => {
		let content = `---
title: My Doc
backlinks: co_a, co_b, co_c
tags: test
---

Content here`
		let result = stripBacklinksFrontmatter(content)
		expect(result).toBe(`---
title: My Doc
tags: test
---

Content here`)
	})

	it("removes frontmatter entirely if only backlinks remain", () => {
		let content = `---
backlinks: co_a, co_b
---

Content here`
		let result = stripBacklinksFrontmatter(content)
		expect(result).toBe("\nContent here")
	})

	it("returns content unchanged if no frontmatter", () => {
		let content = "# No frontmatter\n\nJust content"
		let result = stripBacklinksFrontmatter(content)
		expect(result).toBe(content)
	})

	it("returns content unchanged if no backlinks in frontmatter", () => {
		let content = `---
title: My Doc
---

Content here`
		let result = stripBacklinksFrontmatter(content)
		expect(result).toBe(content)
	})

	it("handles frontmatter with only whitespace after removing backlinks", () => {
		let content = `---
backlinks: co_a
---

Content`
		let result = stripBacklinksFrontmatter(content)
		expect(result).toBe("\nContent")
	})
})

describe("export wikilink roundtrip scenarios", () => {
	it("handles doc linking to non-exported doc (keeps ID)", () => {
		let docs = [{ id: "co_a", title: "Doc A", path: null }]
		let content = "Link to exported [[co_a]] and non-exported [[co_missing]]"
		let result = transformWikilinksForExport(content, null, docs)

		// co_a gets transformed, co_missing stays as-is
		expect(result).toBe(
			"Link to exported [[Doc A]] and non-exported [[co_missing]]",
		)
	})

	it("handles deeply nested folder structures with absolute paths", () => {
		let docs = [
			{ id: "co_deep", title: "Deep Doc", path: "a/b/c/d" },
			{ id: "co_other", title: "Other", path: "x/y" },
		]
		let content = "Link to [[co_other]]"
		let result = transformWikilinksForExport(content, "a/b/c/d", docs)

		// From a/b/c/d to x/y - more than one level up, use absolute
		expect(result).toBe("Link to [[/x/y/Other]]")
	})
})
