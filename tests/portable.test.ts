import { expect, test } from "bun:test"
import { assetPath, decodedPath, rewrite } from "../src/shared/portable"
import { themeFromArchive } from "../src/shared/theme-archive"

test("portable rewrites preserve selection boundaries across CRLF and media paths", () => {
	let source = "first\r\n![picture](asset:a)\r\nquoted quoted"
	let result = rewrite(source, [
		["\r\n", "\n"],
		["asset:a", "./assets/long%20name.png"],
	])
	let start = result.offset(source.lastIndexOf("quoted"))
	let end = result.offset(source.length)
	expect(result.text.slice(start, end)).toBe("quoted")
	expect(end).toBe(result.text.length)
	expect(rewrite("abc", [["abc", "$&"]]).text).toBe("$&")
	expect(rewrite("abc!", [["abc", "x"]]).offset(3)).toBe(1)
})

test("portable asset paths survive Markdown and URL parsing", () => {
	let path = assetPath("id", "photo (100%) #1.png")
	expect(path).not.toMatch(/[ ()#]/)
	expect(decodedPath(new URL(path, "https://archive.invalid/").pathname)).toBe(
		"/assets/id-photo (100%) #1.png",
	)
	expect(decodedPath("raw%name.png")).toBe("raw%name.png")
})

test("ordinary source documents and folders containing a theme stay document archives", () => {
	let encoder = new TextEncoder()
	expect(
		themeFromArchive([
			{ name: "source.md", data: encoder.encode("```css theme\nbody{}\n```") },
		]),
	).toBeUndefined()
	expect(
		themeFromArchive([
			{ name: "theme/theme.json", data: encoder.encode("{}") },
			{ name: "theme/theme.css", data: encoder.encode("body{}") },
			{ name: "notes.md", data: encoder.encode("# Notes") },
		]),
	).toBeUndefined()
})

test("the documented theme metadata example compiles", async () => {
	let { compileTheme } = await import("../src/shared/markdown")
	let guide = await Bun.file("public/docs/theming-guide.md").text()
	let example = guide.match(/```json theme metadata\n[\s\S]*?\n```/)?.[0]
	expect(example).toBeDefined()
	let theme = compileTheme(example ?? "")
	expect(theme.metadata.name).toBe("Reading")
	expect(theme.metadata.presets[0]?.name).toBe("Paper")
})

test("cancellation interrupts pending work and honors an already cancelled signal", async () => {
	let { untilCancelled } = await import("../src/client/cancellation")
	let controller = new AbortController()
	let pending = untilCancelled(new Promise<void>(() => {}), controller.signal)
	controller.abort()
	await expect(pending).rejects.toThrow("Cancelled")
	await expect(
		untilCancelled(Promise.resolve("value"), controller.signal),
	).rejects.toThrow("Cancelled")
	await expect(
		untilCancelled(Promise.resolve("value"), new AbortController().signal),
	).resolves.toBe("value")
})

test("legacy comment sidecars retain bodies, replies, resolution and orphaned selections", async () => {
	let { portableComments } = await import("../src/shared/portable")
	let comments = portableComments({
		version: 1,
		comments: [
			{
				quote: "deleted",
				from: null,
				to: null,
				resolved: true,
				replies: [
					{ body: "Opening message", authorName: "Carl" },
					{
						body: "Reply",
						authorName: "Someone",
						createdAt: "2026-01-01T00:00:00Z",
					},
				],
			},
		],
	})
	expect(comments[0]?.body).toBe("Opening message")
	expect(comments[0]?.author).toBe("Carl")
	expect(comments[0]?.resolved).toBe("true")
	expect(comments[0]?.orphaned).toBe(true)
	expect(JSON.parse(String(comments[0]?.["reply:1767225600000:0"])).body).toBe(
		"Reply",
	)
})

test("native exports use the original application's portable comments format", async () => {
	let { commentSidecar, portableComments } =
		await import("../src/shared/portable")
	let sidecar = commentSidecar("first quoted last", [
		{
			id: "comment",
			quote: "quoted",
			body: "Message",
			author: "Carl",
			resolved: "true",
			selectionStart: 6,
			selectionEnd: 12,
			"reply:1:actor": JSON.stringify({
				body: "Reply",
				author: "Someone",
				time: 1,
			}),
		},
	])
	expect(sidecar.version).toBe(1)
	expect(sidecar.comments[0]?.from).toBe(6)
	expect(sidecar.comments[0]?.quote).toBe("quoted")
	expect(sidecar.comments[0]?.replies).toHaveLength(2)
	let imported = portableComments(sidecar)[0]
	expect(imported?.body).toBe("Message")
	expect(imported?.selectionStart).toBe(6)
	expect(
		Object.keys(imported ?? {}).filter(key => key.startsWith("reply:")),
	).toHaveLength(1)
})

test("portable wiki paths and labels survive document relocation", async () => {
	let { archiveLinkPath, relativeLinkPath, wikiReplacements } =
		await import("../src/shared/portable-links")
	expect(archiveLinkPath("Projects/Note/Note.md")).toBe("Projects/Note")
	expect(relativeLinkPath("Projects/Notes", "../Other/Target")).toBe(
		"Projects/Other/Target",
	)
	expect(
		rewrite(
			"[[old|My label]]",
			wikiReplacements("[[old|My label]]", token =>
				token === "old" ? "new" : undefined,
			),
		).text,
	).toBe("[[new|My label]]")
	let { markdown } = await import("../src/shared/markdown")
	expect(markdown("[[id|My label]]")).toContain('data-wikilink="id"')
	expect(markdown("[[id|My label]]")).toContain('data-wikilabel="My label"')
})

test("portable comments recover changed legacy offsets from context without guessing repeated quotes", async () => {
	let { importedCommentAnchor } = await import("../src/shared/portable")
	let original = "![Image](long-old-reference)\nFirst word.\nSecond word."
	let pairs: [string, string][] = [["long-old-reference", "asset:new"]]
	let fields = {
		quote: "word",
		selectionStart: 400,
		contextBefore: "Second ",
		contextAfter: ".",
	}
	expect(importedCommentAnchor(original, pairs, fields)).toEqual({
		quote: "word",
		start: 39,
		orphaned: false,
	})
	expect(
		importedCommentAnchor(original, pairs, {
			quote: "word",
			selectionStart: 400,
		}).orphaned,
	).toBe(true)
	expect(
		importedCommentAnchor(original, pairs, {
			quote: "long-old-reference",
			selectionStart: 9,
		}),
	).toEqual({ quote: "asset:new", start: 9, orphaned: false })
	expect(
		importedCommentAnchor(original, pairs, { ...fields, orphaned: true })
			.orphaned,
	).toBe(true)
})
