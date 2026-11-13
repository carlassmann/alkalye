import { describe, it, expect } from "vitest"
import JSZip from "jszip"
import {
	importMarkdownFiles,
	importFolderFiles,
	type FileWithPath,
} from "./import"

function createFile(name: string, content: string): File {
	let file = new File([content], name, { type: "text/markdown" })
	// Add text() method for Node environment compatibility
	;(file as File & { text: () => Promise<string> }).text = () =>
		Promise.resolve(content)
	return file
}

function createImageFile(name: string): File {
	// Create a minimal PNG (1x1 transparent pixel)
	let png = new Uint8Array([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
		0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
		0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
		0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
		0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
	])
	let file = new File([png], name, { type: "image/png" })
	// Add text() method for Node environment compatibility
	;(file as File & { text: () => Promise<string> }).text = () =>
		Promise.resolve("")
	return file
}

function createCommentsSidecar(name: string): File {
	return createFile(
		name,
		JSON.stringify({
			version: 1,
			comments: [
				{
					id: "comment-1",
					quote: "commented text",
					contextBefore: "before ",
					contextAfter: " after",
					from: 7,
					to: 21,
					resolved: false,
					createdAt: "2026-06-27T10:00:00.000Z",
					updatedAt: "2026-06-27T10:00:00.000Z",
					replies: [
						{
							body: "Looks good",
							authorName: "Carl",
							createdAt: "2026-06-27T10:00:00.000Z",
							updatedAt: null,
						},
					],
				},
			],
		}),
	)
}

describe("importMarkdownFiles - simple files", () => {
	it("imports single markdown file", async () => {
		let file = createFile("test.md", "# Hello\n\nWorld")
		let results = await importMarkdownFiles([file])

		expect(results).toHaveLength(1)
		expect(results[0].name).toBe("test")
		expect(results[0].content).toBe("# Hello\n\nWorld")
		expect(results[0].assets).toHaveLength(0)
		expect(results[0].path).toBeNull()
	})

	it("imports multiple markdown files", async () => {
		let files = [
			createFile("one.md", "# One"),
			createFile("two.md", "# Two"),
			createFile("three.txt", "# Three"),
		]
		let results = await importMarkdownFiles(files)

		expect(results).toHaveLength(3)
		expect(results.map(r => r.name)).toEqual(["one", "two", "three"])
	})

	it("strips file extensions from name", async () => {
		let files = [
			createFile("doc.md", "content"),
			createFile("doc.markdown", "content"),
			createFile("doc.txt", "content"),
		]
		let results = await importMarkdownFiles(files)

		expect(results.map(r => r.name)).toEqual(["doc", "doc", "doc"])
	})

	it("attaches matching comment sidecars", async () => {
		let results = await importMarkdownFiles([
			createFile("doc.md", "before commented text after"),
			createCommentsSidecar("doc.comments.json"),
		])

		expect(results).toHaveLength(1)
		expect(results[0].comments?.[0].quote).toBe("commented text")
		expect(results[0].comments?.[0].replies[0].authorName).toBe("Carl")
	})
})

describe("importFolderFiles - folder structure", () => {
	it("imports simple markdown file from folder", async () => {
		let files: FileWithPath[] = [
			{ file: createFile("doc.md", "# Hello"), path: "doc.md" },
		]
		let results = await importFolderFiles(files)

		expect(results).toHaveLength(1)
		expect(results[0].name).toBe("doc")
		expect(results[0].path).toBeNull()
	})

	it("imports file with path", async () => {
		let files: FileWithPath[] = [
			{ file: createFile("doc.md", "# Hello"), path: "some/path/doc.md" },
		]
		let results = await importFolderFiles(files)

		expect(results).toHaveLength(1)
		expect(results[0].path).toBe("some/path")
	})

	it("detects doc-with-assets folder structure", async () => {
		let files: FileWithPath[] = [
			{
				file: createFile("My Doc.md", "# Title\n\n![img](assets/image.png)"),
				path: "My Doc/My Doc.md",
			},
			{
				file: createImageFile("image.png"),
				path: "My Doc/assets/image.png",
			},
		]
		let results = await importFolderFiles(files)

		expect(results).toHaveLength(1)
		expect(results[0].name).toBe("My Doc")
		expect(results[0].path).toBeNull() // folder stripped
		expect(results[0].assets.length).toBeGreaterThan(0)
	})

	it("detects nested doc-with-assets folder structure", async () => {
		let files: FileWithPath[] = [
			{
				file: createFile("My Doc.md", "# Title"),
				path: "some/path/My Doc/My Doc.md",
			},
			{
				file: createImageFile("image.png"),
				path: "some/path/My Doc/assets/image.png",
			},
		]
		let results = await importFolderFiles(files)

		expect(results).toHaveLength(1)
		expect(results[0].name).toBe("My Doc")
		expect(results[0].path).toBe("some/path")
	})

	it("preserves path when folder name does not match doc name", async () => {
		let files: FileWithPath[] = [
			{ file: createFile("doc.md", "# Hello"), path: "folder/doc.md" },
		]
		let results = await importFolderFiles(files)

		expect(results).toHaveLength(1)
		expect(results[0].name).toBe("doc")
		expect(results[0].path).toBe("folder")
	})

	it("handles case-insensitive folder name matching", async () => {
		let files: FileWithPath[] = [
			{
				file: createFile("my doc.md", "# Title"),
				path: "My Doc/my doc.md",
			},
		]
		let results = await importFolderFiles(files)

		expect(results).toHaveLength(1)
		expect(results[0].path).toBeNull() // folder stripped despite case difference
	})

	it("imports multiple docs from backup-like structure", async () => {
		let files: FileWithPath[] = [
			// Doc without assets at root
			{ file: createFile("Simple.md", "# Simple"), path: "Simple.md" },
			// Doc with assets at root
			{
				file: createFile("With Assets.md", "![img](assets/a.png)"),
				path: "With Assets/With Assets.md",
			},
			{
				file: createImageFile("a.png"),
				path: "With Assets/assets/a.png",
			},
			// Doc without assets in path (not in any doc's folder tree)
			{
				file: createFile("Nested.md", "# Nested"),
				path: "other/path/Nested.md",
			},
			// Doc with assets in path
			{
				file: createFile("Nested Assets.md", "![img](assets/b.png)"),
				path: "some/path/Nested Assets/Nested Assets.md",
			},
			{
				file: createImageFile("b.png"),
				path: "some/path/Nested Assets/assets/b.png",
			},
		]
		let results = await importFolderFiles(files)

		expect(results).toHaveLength(4)

		let simple = results.find(r => r.name === "Simple")
		expect(simple?.path).toBeNull()
		expect(simple?.assets).toHaveLength(0)

		let withAssets = results.find(r => r.name === "With Assets")
		expect(withAssets?.path).toBeNull()
		expect(withAssets?.assets.length).toBeGreaterThan(0)

		let nested = results.find(r => r.name === "Nested")
		expect(nested?.path).toBe("other/path")
		expect(nested?.assets).toHaveLength(0)

		let nestedAssets = results.find(r => r.name === "Nested Assets")
		expect(nestedAssets?.path).toBe("some/path")
		expect(nestedAssets?.assets.length).toBeGreaterThan(0)
	})

	it("attaches folder comment sidecars", async () => {
		let files: FileWithPath[] = [
			{
				file: createFile("Doc.md", "before commented text after"),
				path: "Project/Doc/Doc.md",
			},
			{
				file: createCommentsSidecar("Doc.comments.json"),
				path: "Project/Doc/Doc.comments.json",
			},
		]
		let results = await importFolderFiles(files)

		expect(results).toHaveLength(1)
		expect(results[0].comments?.[0].quote).toBe("commented text")
	})
})

describe("importMarkdownFiles - zip comments", () => {
	it("attaches zipped comment sidecars", async () => {
		let zip = new JSZip()
		zip.file("Doc/Doc.md", "before commented text after")
		zip.file("Doc/Doc.comments.json", await createCommentsSidecar("").text())
		let blob = await zip.generateAsync({ type: "blob" })
		let file = new File([blob], "export.zip", { type: "application/zip" })
		let results = await importMarkdownFiles([file])

		expect(results).toHaveLength(1)
		expect(results[0].comments?.[0].quote).toBe("commented text")
	})
})

describe("asset reference handling", () => {
	it("matches assets with relative path ./assets/", async () => {
		let files: FileWithPath[] = [
			{
				file: createFile("doc.md", "![alt](./assets/image.png)"),
				path: "doc/doc.md",
			},
			{ file: createImageFile("image.png"), path: "doc/assets/image.png" },
		]
		let results = await importFolderFiles(files)

		expect(results[0].assets).toHaveLength(1)
		expect(results[0].assets[0].refName).toBe("./assets/image.png")
	})

	it("matches assets with plain relative path assets/", async () => {
		let files: FileWithPath[] = [
			{
				file: createFile("doc.md", "![alt](assets/image.png)"),
				path: "doc/doc.md",
			},
			{ file: createImageFile("image.png"), path: "doc/assets/image.png" },
		]
		let results = await importFolderFiles(files)

		expect(results[0].assets).toHaveLength(1)
		expect(results[0].assets[0].refName).toBe("assets/image.png")
	})

	it("ignores http/https URLs", async () => {
		let file = createFile(
			"doc.md",
			"![alt](https://example.com/image.png)\n![alt2](http://example.com/img.jpg)",
		)
		let results = await importMarkdownFiles([file])

		expect(results[0].assets).toHaveLength(0)
	})

	it("ignores asset: protocol (already imported)", async () => {
		let file = createFile("doc.md", "![alt](asset:co_abc123)")
		let results = await importMarkdownFiles([file])

		expect(results[0].assets).toHaveLength(0)
	})
})

describe("edge cases", () => {
	it("skips hidden files (starting with .)", async () => {
		let files: FileWithPath[] = [
			{ file: createFile(".hidden.md", "# Hidden"), path: ".hidden.md" },
			{ file: createFile("visible.md", "# Visible"), path: "visible.md" },
		]
		let results = await importFolderFiles(files)

		expect(results).toHaveLength(1)
		expect(results[0].name).toBe("visible")
	})

	it("handles empty markdown file", async () => {
		let file = createFile("empty.md", "")
		let results = await importMarkdownFiles([file])

		expect(results).toHaveLength(1)
		expect(results[0].content).toBe("")
	})

	it("handles deeply nested paths", async () => {
		let files: FileWithPath[] = [
			{
				file: createFile("doc.md", "# Deep"),
				path: "a/b/c/d/e/doc.md",
			},
		]
		let results = await importFolderFiles(files)

		expect(results[0].path).toBe("a/b/c/d/e")
	})

	it("handles deeply nested doc-with-assets", async () => {
		let files: FileWithPath[] = [
			{
				file: createFile("doc.md", "# Deep"),
				path: "a/b/c/d/e/doc/doc.md",
			},
		]
		let results = await importFolderFiles(files)

		expect(results[0].path).toBe("a/b/c/d/e") // doc folder stripped
	})
})

import { resolveWikilinksForImport } from "./import"

describe("resolveWikilinksForImport", () => {
	let docs = [
		{ title: "Doc A", path: null, newId: "co_new_a" },
		{ title: "Doc B", path: "notes", newId: "co_new_b" },
		{ title: "Doc C", path: "notes/sub", newId: "co_new_c" },
		{ title: "Doc D", path: "other", newId: "co_new_d" },
	]

	it("resolves title-only wikilinks", () => {
		let content = "Link to [[Doc A]] and [[Doc B]]"
		let result = resolveWikilinksForImport(content, null, docs)
		expect(result).toBe("Link to [[co_new_a]] and [[co_new_b]]")
	})

	it("resolves absolute path wikilinks (starting with /)", () => {
		let content = "Link to [[/notes/Doc B]] and [[/notes/sub/Doc C]]"
		let result = resolveWikilinksForImport(content, null, docs)
		expect(result).toBe("Link to [[co_new_b]] and [[co_new_c]]")
	})

	it("resolves relative path wikilinks from folder", () => {
		// From notes folder:
		// - ../Doc A -> root/Doc A
		// - Doc B -> notes/Doc B (same folder, title-only)
		// - sub/Doc C -> notes/sub/Doc C
		// - ../other/Doc D -> other/Doc D
		let content = "[[../Doc A]] [[Doc B]] [[sub/Doc C]] [[../other/Doc D]]"
		let result = resolveWikilinksForImport(content, "notes", docs)
		expect(result).toBe("[[co_new_a]] [[co_new_b]] [[co_new_c]] [[co_new_d]]")
	})

	it("resolves absolute paths from any location", () => {
		// Absolute paths work regardless of current doc location
		let content = "[[/Doc A]] [[/notes/Doc B]] [[/other/Doc D]]"
		let result = resolveWikilinksForImport(content, "notes/sub", docs)
		expect(result).toBe("[[co_new_a]] [[co_new_b]] [[co_new_d]]")
	})

	it("resolves absolute path wikilinks", () => {
		let content = "Link to [[notes/Doc B]] and [[notes/sub/Doc C]]"
		let result = resolveWikilinksForImport(content, null, docs)
		expect(result).toBe("Link to [[co_new_b]] and [[co_new_c]]")
	})

	it("resolves relative path wikilinks from folder", () => {
		// From notes folder:
		// - ../Doc A -> root/Doc A
		// - Doc B -> notes/Doc B (same folder)
		// - sub/Doc C -> notes/sub/Doc C
		// - ../other/Doc D -> other/Doc D
		let content = "[[../Doc A]] [[Doc B]] [[sub/Doc C]] [[../other/Doc D]]"
		let result = resolveWikilinksForImport(content, "notes", docs)
		expect(result).toBe("[[co_new_a]] [[co_new_b]] [[co_new_c]] [[co_new_d]]")
	})

	it("resolves deeply nested relative paths", () => {
		// From notes/sub, link to root
		let content = "[[../../Doc A]]"
		let result = resolveWikilinksForImport(content, "notes/sub", docs)
		expect(result).toBe("[[co_new_a]]")
	})

	it("keeps unresolved wikilinks as-is", () => {
		let content = "Link to [[Unknown Doc]]"
		let result = resolveWikilinksForImport(content, null, docs)
		expect(result).toBe("Link to [[Unknown Doc]]")
	})

	it("falls back to title match when path does not resolve", () => {
		// [[wrong/path/Doc A]] - path doesn't match, but title does
		let content = "[[wrong/path/Doc A]]"
		let result = resolveWikilinksForImport(content, null, docs)
		expect(result).toBe("[[co_new_a]]")
	})

	it("handles case-insensitive title matching", () => {
		let content = "[[doc a]] and [[DOC B]]"
		let result = resolveWikilinksForImport(content, null, docs)
		expect(result).toBe("[[co_new_a]] and [[co_new_b]]")
	})

	it("handles content with no wikilinks", () => {
		let content = "No links here"
		let result = resolveWikilinksForImport(content, null, docs)
		expect(result).toBe("No links here")
	})

	it("handles multiple wikilinks to same doc", () => {
		let content = "First [[Doc A]] and again [[Doc A]]"
		let result = resolveWikilinksForImport(content, null, docs)
		expect(result).toBe("First [[co_new_a]] and again [[co_new_a]]")
	})
})

describe("wikilink roundtrip", () => {
	it("preserves links through export and import cycle", () => {
		// Simulate export: [[co_orig_a]] -> [[Doc A]] or [[/notes/Doc B]]
		// Simulate import: resolve back to new IDs
		let importedDocs = [
			{ title: "Doc A", path: null, newId: "co_new_a" },
			{ title: "Doc B", path: "notes", newId: "co_new_b" },
		]

		// Content as it would appear after export (absolute paths for nested)
		let exportedContent = "Link to [[Doc A]] and [[/notes/Doc B]]"

		// After import resolution
		let result = resolveWikilinksForImport(exportedContent, null, importedDocs)
		expect(result).toBe("Link to [[co_new_a]] and [[co_new_b]]")
	})

	it("handles broken links from partial export", () => {
		// When exporting only some docs, links to non-exported docs become title-only
		// On import, if that doc doesn't exist, link stays as-is
		let importedDocs = [{ title: "Doc A", path: null, newId: "co_new_a" }]

		let exportedContent = "[[Doc A]] and [[Missing Doc]]"
		let result = resolveWikilinksForImport(exportedContent, null, importedDocs)

		expect(result).toBe("[[co_new_a]] and [[Missing Doc]]")
	})

	it("handles relative paths correctly across folder structures", () => {
		let importedDocs = [
			{ title: "Index", path: null, newId: "co_idx" },
			{ title: "Note 1", path: "notes", newId: "co_n1" },
			{ title: "Note 2", path: "notes", newId: "co_n2" },
			{ title: "Archive", path: "archive", newId: "co_arc" },
		]

		// Content from Note 1 (path: notes) after export
		// Uses relative for one level up, absolute for deeper
		let exportedContent =
			"See [[../Index]], [[Note 2]], and [[../archive/Archive]]"
		let result = resolveWikilinksForImport(
			exportedContent,
			"notes",
			importedDocs,
		)

		expect(result).toBe("See [[co_idx]], [[co_n2]], and [[co_arc]]")
	})

	it("handles absolute paths in roundtrip", () => {
		let importedDocs = [
			{ title: "Deep", path: "a/b/c", newId: "co_deep" },
			{ title: "Other", path: "x/y", newId: "co_other" },
		]

		// From a/b/c linking to x/y - would be exported as absolute
		let exportedContent = "Link to [[/x/y/Other]]"
		let result = resolveWikilinksForImport(
			exportedContent,
			"a/b/c",
			importedDocs,
		)

		expect(result).toBe("Link to [[co_other]]")
	})
})
