import { describe, expect, test } from "bun:test"
import { run } from "../src/platform/effects"
import { Replica } from "../src/shared/crdt"
import { hash, open, randomSecret, seal } from "./legacy-crypto"
import { copyDocumentOperations, newDocument } from "../src/shared/documents"
import {
	compileTheme,
	frontmatter,
	markdown,
	slides,
} from "../src/shared/markdown"
import { changeMetadata } from "../src/shared/document-metadata"
import { compactOperation, parseOperation } from "../src/shared/model"

function fork(source: Replica, actor: string) {
	let replica = new Replica(actor)
	replica.apply([...source.operations.values()])
	return replica
}
describe("Concurrent offline text", () => {
	test("concurrent edits survive duplicate and reverse replay", () => {
		let original = new Replica("original")
		original.edit("doc", "Hello world 👋")
		let a = fork(original, "a"),
			b = fork(original, "b")
		a.edit("doc", "Hello brave world 👋")
		b.edit("doc", "Hello world 👋!")
		a.apply([...b.operations.values()].reverse())
		b.apply([...a.operations.values()].reverse())
		a.apply([...b.operations.values()])
		expect(a.text("doc")).toBe(b.text("doc"))
		expect(a.text("doc")).toBe("Hello brave world 👋!")
	})
	test("inserts at one position are deterministic and preserve runs", () => {
		let base = new Replica("base")
		base.edit("doc", "AB")
		let a = fork(base, "a"),
			b = fork(base, "b")
		a.edit("doc", "AoneB")
		b.edit("doc", "AtwoB")
		a.apply([...b.operations.values()])
		b.apply([...a.operations.values()])
		expect(a.text("doc")).toBe("AtwooneB")
		expect(b.text("doc")).toBe(a.text("doc"))
	})
	test("deletion before insertion and history reconstruct correctly", () => {
		let a = new Replica("a")
		let insert = a.edit("doc", "abc")
		a.edit("doc", "ac")
		let b = new Replica("b")
		b.apply([...a.operations.values()].reverse())
		expect(b.text("doc")).toBe("ac")
		expect(b.text("doc", insert?.clock)).toBe("abc")
	})
	test("large documents do not overflow stack", () => {
		let a = new Replica("a")
		a.edit("doc", "x".repeat(100_000))
		expect(a.text("doc").length).toBe(100_000)
	})
})
test("authenticated encryption binds ciphertext to room and identity", async () => {
	let key = randomSecret(),
		packet = await run(seal(key, "operation", { text: "private" }, "room"))
	expect(await run(open(key, packet, "room"))).toEqual({ text: "private" })
	await expect(run(open(key, packet, "other"))).rejects.toThrow()
	await expect(run(open(randomSecret(), packet, "room"))).rejects.toThrow()
})
test("markdown escapes HTML and unsafe links, parses tables and tasks", () => {
	let html = markdown(
		"# Hello\n\n<script>alert(1)</script>\n\n[x](javascript:alert)\n\n- [x] Done\n\n| A | B |\n| --- | --- |\n| C | D |",
	)
	expect(html).not.toContain("<script>")
	expect(html).not.toContain('href="javascript:')
	expect(html).toContain("<table>")
	expect(html).toContain("checked")
})
test("slides hide notes and keep fenced slide breaks", () => {
	let result = slides(
		"---\nmode: present\n---\n# Title\n\nSpeaker note\n  On slide\n---\n# Two\n```ts\n---\n```",
	)
	expect(result).toHaveLength(2)
	expect(result[0]?.content).not.toContain("Speaker note")
	expect(result[0]?.notes).toContain("Speaker note")
	expect(result[1]?.content).toContain("---")
})
test("theme template validation", () => {
	expect(() =>
		compileTheme("```html document\n<article>No slot</article>\n```"),
	).toThrow()
	expect(compileTheme("```css theme\nh1 { color:red }\n```").css).toContain(
		"color:red",
	)
})
test("hash is stable", async () => {
	expect(await run(hash("hello"))).toBe(await run(hash("hello")))
})

test("ZIP round trip and corruption detection", async () => {
	let { zip, unzip } = await import("../src/shared/zip")
	let entries = [
		{ name: "Notes/über.md", data: new TextEncoder().encode("# Hello") },
		{ name: "assets/image.png", data: new Uint8Array([0, 1, 2, 255]) },
	]
	expect(await unzip(zip(entries))).toEqual(entries)
	let corrupt = zip(entries)
	corrupt[44] = 0
	await expect(unzip(corrupt)).rejects.toThrow()
})
test("authoring toggles the current word and selected lines", async () => {
	let { formatSelection, sortTasks } = await import("../src/shared/authoring")
	expect(formatSelection("one two", { start: 5, end: 5 }, "bold").source).toBe(
		"one **two**",
	)
	expect(
		formatSelection("one **two**", { start: 6, end: 9 }, "bold").source,
	).toBe("one two")
	expect(
		formatSelection("One\nTwo", { start: 0, end: 7 }, "bullet").source,
	).toBe("- One\n- Two")
	expect(
		sortTasks("- [x] Done\n  - [x] Child done\n  - [ ] Child todo\n- [ ] Todo"),
	).toBe("- [ ] Todo\n- [x] Done\n  - [ ] Child todo\n  - [x] Child done")
})

test("selective undo preserves another writer's insertion", () => {
	let base = new Replica("base")
	base.edit("doc", "Hello world")
	let a = fork(base, "a"),
		b = fork(base, "b"),
		edit = a.edit("doc", "Hello brave world")
	b.edit("doc", "Hello world!")
	a.apply([...b.operations.values()])
	if (!edit) throw new Error("Edit missing")
	a.inverse(edit)
	expect(a.text("doc")).toBe("Hello world!")
})
test("undo deletion restores content and can be redone", () => {
	let a = new Replica("a")
	a.edit("doc", "abc")
	let edit = a.edit("doc", "ac")
	if (!edit) throw new Error("Edit missing")
	let inverse = a.inverse(edit)
	expect(a.text("doc")).toBe("abc")
	a.inverse(inverse)
	expect(a.text("doc")).toBe("ac")
})

test("wire runs preserve Unicode edits and deletion identities", () => {
	let source = new Replica("writer")
	source.edit("doc", "Hello 👋 🧑‍💻\n".repeat(1000))
	source.edit("doc", "Hello 👋\n")
	let replay = new Replica("reader")
	let encoded = [...source.operations.values()].map(compactOperation)
	replay.apply(encoded.map(parseOperation).reverse())
	expect(replay.text("doc")).toBe(source.text("doc"))
	expect(JSON.stringify(encoded).length).toBeLessThan(20_000)
	for (let operation of source.operations.values())
		expect(parseOperation(compactOperation(operation))).toEqual(operation)
})
test("decoded operations reject forged clocks and atom identities", () => {
	let source = new Replica("writer"),
		operation = source.edit("doc", "Hello")
	if (!operation) throw new Error("Expected edit")
	expect(() => parseOperation({ ...operation, clock: 9 })).toThrow("identity")
	expect(() =>
		parseOperation({
			...operation,
			insert: [{ id: "other:00000000", after: "", value: "x" }],
		}),
	).toThrow("identity")
})
test("shuffled multi-actor delivery and duplicates converge", () => {
	let seed = 42317
	function random(limit: number) {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
		return seed % limit
	}
	let actors = [new Replica("a"), new Replica("b"), new Replica("c")]
	for (let step = 0; step < 120; step++) {
		let actor = actors[random(actors.length)]
		if (!actor) throw new Error("Missing actor")
		let text = actor.text("doc"),
			position = random(text.length + 1)
		actor.edit(
			"doc",
			text.slice(0, position) + String(step % 10) + text.slice(position),
		)
		let peer = actors[random(actors.length)]
		if (peer && random(3) === 0) peer.apply([...actor.operations.values()])
	}
	let all = actors.flatMap(actor => [...actor.operations.values()])
	for (let actor of actors) {
		let shuffled = [...all]
		for (let index = shuffled.length - 1; index > 0; index--) {
			let other = random(index + 1),
				a = shuffled[index],
				b = shuffled[other]
			if (a && b) {
				shuffled[index] = b
				shuffled[other] = a
			}
		}
		actor.apply(shuffled)
	}
	expect(new Set(actors.map(actor => actor.text("doc"))).size).toBe(1)
})

test("theme compilation reports unfinished fences and carries embedded fonts", () => {
	expect(() => compileTheme("```css theme\nh1 {color:red}")).toThrow("line 1")
	let theme = compileTheme(
		'```css theme\n@font-face {src:url("asset:fonts/test.woff2")}\n```\n\n```base64 asset fonts/test.woff2 font/woff2\nYWJj\n```',
	)
	expect(theme.css).toContain("data:font/woff2;base64,YWJj")
	expect(() =>
		compileTheme(
			'```css theme\nbody {background:url("asset:missing.png")}\n```',
		),
	).toThrow("Missing theme asset")
})
test("composition edits against their starting atoms preserve remote changes", () => {
	let original = new Replica("a")
	original.edit("doc", "Hello world")
	let base = original.visible("doc")
	let remote = fork(original, "b")
	remote.edit("doc", "Remote Hello world")
	original.apply([...remote.operations.values()])
	original.edit("doc", "Hello你好 world", base)
	expect(original.text("doc")).toBe("Remote Hello你好 world")
})

test("moving a document preserves its history without copying unrelated documents", () => {
	let source = new Replica("device-source"),
		destination = new Replica("device-destination")
	source.apply(
		newDocument(source, "doc", "Document", "First").filter(
			operation => operation !== null,
		),
	)
	let clock = source.clock
	source.edit("doc", "Second")
	source.apply(
		newDocument(source, "private", "Private", "Secret").filter(
			operation => operation !== null,
		),
	)
	destination.apply(
		copyDocumentOperations(source, destination, "doc").filter(
			operation => operation !== null,
		),
	)
	expect(destination.text("doc")).toBe("Second")
	expect(frontmatter(destination.text("doc", clock)).body).toBe("First")
	expect(frontmatter(destination.text("doc", clock)).data.title).toBe(
		"Document",
	)
	expect(destination.fields("private").type).toBeUndefined()
	destination.edit("doc", "Third")
	source.apply(
		copyDocumentOperations(destination, source, "doc").filter(
			operation => operation !== null,
		),
	)
	expect(source.text("doc")).toBe("Third")
})

test("undo restores deleted atoms after earlier insertions and concurrent changes", () => {
	let replica = new Replica("author")
	replica.edit("doc", "ac")
	replica.edit("doc", "abc")
	let peer = fork(replica, "peer")
	let deletion = replica.edit("doc", "ab")
	peer.edit("doc", "abc!")
	replica.apply([...peer.operations.values()])
	if (!deletion) throw new Error("Deletion missing")
	replica.inverse(deletion)
	expect(replica.text("doc")).toBe("abc!")
	let removeRun = replica.edit("doc", "a!")
	if (!removeRun) throw new Error("Deletion missing")
	let restored = replica.inverse(removeRun)
	expect(replica.text("doc")).toBe("abc!")
	replica.inverse(restored)
	expect(replica.text("doc")).toBe("a!")
})

test("typing groups undo and redo together without removing a peer's insertion", async () => {
	let { EditHistory } = await import("../src/shared/history")
	let replica = new Replica("writer"),
		history = new EditHistory()
	replica.edit("doc", "Base")
	for (let text of ["Base a", "Base ab", "Base abc"]) {
		let operation = replica.edit("doc", text)
		if (operation) history.record("doc", operation)
	}
	let peer = fork(replica, "peer")
	peer.edit("doc", "Base abc!")
	replica.apply([...peer.operations.values()])
	expect(history.revert("doc", replica)).toHaveLength(3)
	expect(replica.text("doc")).toBe("Base!")
	expect(history.revert("doc", replica, true)).toHaveLength(3)
	expect(replica.text("doc")).toBe("Base abc!")
})

test("undo follows restored atom identities through backspace and redo", async () => {
	let { EditHistory } = await import("../src/shared/history")
	let replica = new Replica("writer"),
		history = new EditHistory()
	for (let content of ["ab", "a"]) {
		let operation = replica.edit("doc", content)
		if (operation) history.record("doc", operation)
	}
	history.revert("doc", replica)
	expect(replica.text("doc")).toBe("")
	history.revert("doc", replica, true)
	expect(replica.text("doc")).toBe("a")
	let insert = replica.edit("other", "x")
	let deletion = replica.edit("other", "")
	if (!insert || !deletion) throw new Error("Missing operation")
	replica.inverse(deletion)
	replica.inverse(insert)
	expect(replica.text("other")).toBe("")
})

test("asset deletion removes matching media without changing other links", async () => {
	let { removeAsset } = await import("../src/shared/authoring")
	expect(
		removeAsset(
			'![Picture](asset:image-1)\n![Other](asset:image-2)\n![Again](asset:image-1 "Caption")',
			"image-1",
		),
	).toBe("\n![Other](asset:image-2)\n")
	expect(
		removeAsset(
			"![Diagram\\[final\\].png](asset:image-1)\n![Path\\\\image](asset:image-1)",
			"image-1",
		),
	).toBe("\n")
	expect(
		removeAsset("![Diagram\\[final\\].png](asset:image-12)", "image-1"),
	).toBe("![Diagram\\[final\\].png](asset:image-12)")
})

test("time machine restores metadata, assets and comments as new edits", async () => {
	let { newComment, restoreDocument } = await import("../src/shared/documents")
	let replica = new Replica("writer")
	newDocument(replica, "doc", "Original", "![Original](asset:asset)")
	replica.set("asset", "type", "asset")
	replica.set("asset", "document", "doc")
	replica.set("asset", "data", "original-bytes")
	newComment(replica, "comment", "doc", "Original", "First comment", "Writer")
	let snapshot = [...replica.operations.keys()].at(-1)
	if (!snapshot) throw new Error("Missing snapshot")
	changeMetadata(replica, "doc", { title: "Changed" })
	replica.edit("doc", "Changed text")
	replica.set("asset", "type", "deleted")
	replica.set("comment", "resolved", "true")
	newComment(replica, "later", "doc", "Changed", "Later comment", "Writer")
	restoreDocument(replica, "doc", snapshot)
	expect(frontmatter(replica.text("doc")).body).toBe("![Original](asset:asset)")
	expect(replica.metadata("doc").title).toBe("Original")
	expect(replica.fields("asset").type).toBe("asset")
	expect(replica.fields("asset").data).toBe("original-bytes")
	expect(replica.fields("comment").resolved).toBe("false")
	expect(replica.fields("later").type).toBe("deleted")
	expect(frontmatter(replica.text("doc", snapshot)).data.title).toBe("Original")
})

test("interface markup translates labels without changing action identifiers", async () => {
	let { localizeMarkup } = await import("../src/client/language")
	expect(
		localizeMarkup(
			'<button data-action="edit" aria-label="Write"><span>Write</span></button>',
			"de",
		),
	).toBe(
		'<button data-action="edit" aria-label="Schreiben"><span>Schreiben</span></button>',
	)
	expect(
		localizeMarkup(
			'<input name="language" value="en" placeholder="Find documents…">',
			"de",
		),
	).toContain('name="language" value="en"')
})

test("preferences merge independent fields from disconnected devices", async () => {
	let { accountPreferences, preferenceFields, preferencesFromFields } =
		await import("../src/shared/preferences")
	let original = new Replica("original"),
		defaults = accountPreferences({})
	for (let [field, value] of Object.entries(preferenceFields(defaults)))
		original.set("profile", field, value)
	let a = fork(original, "a"),
		b = fork(original, "b")
	a.set("profile", "preference:fontSize", "24")
	b.set("profile", "preference:editor.spellcheck", "false")
	a.apply([...b.operations.values()])
	let merged = preferencesFromFields(a.fields("profile"), defaults)
	expect(merged.fontSize).toBe(24)
	expect(merged.editor.spellcheck).toBe(false)
	expect(merged.editor.lineHeight).toBe(1.8)
})

test("comment anchors track concurrent inserts and detect deleted passages", async () => {
	let { newComment, commentRange } = await import("../src/shared/documents")
	let original = new Replica("original"),
		remote = new Replica("remote")
	original.edit("note", "one one")
	original.apply(
		newComment(original, "comment", "note", "one", "Second word", "Writer", 4),
	)
	remote.apply([...original.operations.values()])
	remote.edit("note", "new one one")
	original.apply([...remote.operations.values()])
	expect(commentRange(original, "note", original.fields("comment"))).toEqual({
		start: 8,
		end: 11,
	})
	original.edit("note", "new one ")
	expect(
		commentRange(original, "note", original.fields("comment")),
	).toBeUndefined()
	original.set("note", "commentsDisabled", "true")
	expect(() =>
		newComment(original, "another", "note", "one", "Body", "Writer"),
	).toThrow("disabled")
})

test("purging a document preserves shared themes and another document's assets", async () => {
	let { ownedDocumentTargets } = await import("../src/shared/documents")
	let replica = new Replica("writer")
	replica.set("note", "theme", "shared-theme")
	replica.set("own-asset", "document", "note")
	replica.set("other-asset", "document", "other")
	replica.edit("note", "![One](asset:own-asset) ![Two](asset:other-asset)")
	expect(ownedDocumentTargets(replica, "note")).toEqual(["note", "own-asset"])
})

test("theme ZIP conversion embeds relative fonts and template images", async () => {
	let { themeFromArchive } = await import("../src/shared/theme-archive")
	let encoder = new TextEncoder()
	let source = themeFromArchive([
		{
			name: "theme/theme.css",
			data: encoder.encode(
				'@font-face{font-family: Reading;src:url("./fonts/a.woff2")}',
			),
		},
		{ name: "theme/fonts/a.woff2", data: new Uint8Array([1, 2, 3]) },
		{ name: "theme/cover.png", data: new Uint8Array([4, 5, 6]) },
		{
			name: "theme/template.html",
			data: encoder.encode(
				'<header><img src="cover.png"></header><article data-content></article>',
			),
		},
	])
	let compiled = compileTheme(source ?? "")
	expect(compiled.css).toContain("data:font/woff2;base64,AQID")
	expect(compiled.document).toContain("data:image/png;base64,BAUG")
})

test("line commands preserve selection and respect first and last lines", async () => {
	let { editLines } = await import("../src/shared/lines")
	expect(editLines("one\ntwo\nthree", { start: 5, end: 6 }, "move-up")).toEqual(
		{ source: "two\none\nthree", selection: { start: 1, end: 2 } },
	)
	expect(editLines("one\ntwo", { start: 0, end: 0 }, "move-up").source).toBe(
		"one\ntwo",
	)
	expect(editLines("one\ntwo", { start: 4, end: 4 }, "delete").source).toBe(
		"one",
	)
	expect(
		editLines("one\ntwo", { start: 0, end: 3 }, "duplicate-down").source,
	).toBe("one\none\ntwo")
	expect(
		editLines("\tone\n  two", { start: 0, end: 10 }, "outdent").source,
	).toBe("one\ntwo")
})

test("version copies detach assets and boards and retain comment positions", async () => {
	let { duplicateDocument, newComment, commentRange, records, setFields } =
		await import("../src/shared/documents")
	let source = new Replica("original"),
		destination = new Replica("copy")
	newDocument(source, "note", "Original", "![Picture](asset:photo) quoted text")
	setFields(source, "photo", {
		type: "asset",
		document: "note",
		data: "blob:content",
	})
	setFields(source, "board", {
		type: "whiteboard",
		document: "note",
		"shape:one": "rectangle",
	})
	source.set("note", "whiteboard", "board")
	newComment(source, "comment", "note", "quoted", "Keep this", "Writer")
	let version = [...source.operations.values()].at(-1)?.id ?? ""
	source.edit("note", "Later document")
	let copy = duplicateDocument(
		source,
		destination,
		"note",
		"new-note",
		"Version copy",
		new Map([
			["note", "new-note"],
			["photo", "copy-photo"],
			["board", "copy-board"],
			["comment", "copy-comment"],
		]),
		version,
	)
	destination.apply(copy.operations.filter(operation => operation !== null))
	let asset = records(destination, "asset")[0]
	let board = records(destination, "whiteboard")[0]
	let comment = records(destination, "comment")[0]
	expect(asset?.fields.document).toBe("new-note")
	expect(asset?.fields.data).toBe("blob:content")
	expect(frontmatter(destination.text("new-note")).body).toBe(
		`![Picture](asset:${asset?.id}) quoted text`,
	)
	expect(destination.fields("new-note").whiteboard).toBe(board?.id)
	expect(board?.fields["shape:one"]).toBe("rectangle")
	let range = commentRange(destination, "new-note", comment?.fields ?? {})
	expect(destination.text("new-note").slice(range?.start, range?.end)).toBe(
		"quoted",
	)
	expect(source.text("note")).toBe("Later document")
})

test("document copies remap source theme bindings and retain comment anchors", async () => {
	let { duplicateDocument, newComment, commentRange, setFields } =
		await import("../src/shared/documents")
	let source = new Replica("original"),
		destination = new Replica("copy")
	newDocument(
		source,
		"note",
		"Original",
		"---\ntheme-id: theme-source\n---\nquoted",
	)
	setFields(source, "theme-source", { type: "theme" })
	source.edit("theme-source", "```css theme\n.content { color: blue }\n```")
	newComment(source, "comment", "note", "quoted", "Keep", "Writer")
	duplicateDocument(
		source,
		destination,
		"note",
		"new-note",
		"Copy",
		new Map([
			["note", "new-note"],
			["theme-source", "copy-theme"],
			["comment", "copy-comment"],
		]),
	)
	expect(frontmatter(destination.text("new-note")).data["theme-id"]).toBe(
		"copy-theme",
	)
	expect(destination.text("copy-theme")).toBe(source.text("theme-source"))
	let range = commentRange(
		destination,
		"new-note",
		destination.fields("copy-comment"),
	)
	expect(destination.text("new-note").slice(range?.start, range?.end)).toBe(
		"quoted",
	)
})

test("restoring deleted text restores its comment anchors", async () => {
	let { newComment, restoreDocument, commentRange } =
		await import("../src/shared/documents")
	let replica = new Replica("writer")
	newDocument(replica, "note", "Note", "Before quoted after")
	newComment(replica, "comment", "note", "quoted", "Body", "Writer")
	let version = [...replica.operations.values()].at(-1)?.id ?? ""
	replica.edit("note", "Before after")
	expect(
		commentRange(replica, "note", replica.fields("comment")),
	).toBeUndefined()
	restoreDocument(replica, "note", version)
	let range = commentRange(replica, "note", replica.fields("comment"))
	expect(replica.text("note").slice(range?.start, range?.end)).toBe("quoted")
	expect(range?.end && range.end - range.start).toBe(6)
})

test("folder moves include descendants and deletion retains documents", async () => {
	let { createFolder, folderPaths, moveFolder, deleteFolder } =
		await import("../src/shared/folders")
	let replica = new Replica("writer")
	createFolder(replica, "Projects/Notes", "folder")
	newDocument(replica, "one", "One", "---\npath: Projects/Notes\n---\nText")
	newDocument(replica, "two", "Two", "Other")
	expect(folderPaths(replica)).toEqual(["Projects", "Projects/Notes"])
	moveFolder(replica, "Projects", "Archive")
	expect(replica.documents("")[0]?.folder).toBe("Archive/Notes")
	expect(folderPaths(replica)).toEqual(["Archive", "Archive/Notes"])
	expect(() => moveFolder(replica, "Archive", "Archive/Nested")).toThrow(
		"contain itself",
	)
	deleteFolder(replica, "Archive")
	expect(folderPaths(replica)).toEqual([])
	expect(
		replica.documents("").map(doc => frontmatter(doc.content).body),
	).toEqual(["Text", "Other"])
	expect(frontmatter(replica.text("one")).data.path).toBeUndefined()
})

test("theme metadata selects appearance presets and carries colors and fonts", async () => {
	let { resolvePreset } = await import("../src/shared/themes")
	let theme = compileTheme(
		'```json theme metadata\n{"name":"Palette","presets":[{"name":"Day","appearance":"light","colors":{"background":"white","foreground":"black","accent":"blue","accents":["green"]},"fonts":{"title":"Georgia"}},{"name":"Night","appearance":"dark","colors":{"background":"black","foreground":"white","accent":"lime"}}]}\n```',
	)
	let preset = resolvePreset(theme.metadata.presets, "day", "dark")
	expect(theme.metadata.name).toBe("Palette")
	expect(preset?.appearance).toBe("light")
	expect(preset?.variables["--preset-accent-2"]).toBe("green")
	expect(preset?.variables["--preset-font-title"]).toBe("Georgia")
	expect(resolvePreset(theme.metadata.presets, "", "dark")?.name).toBe("Night")
	expect(() =>
		compileTheme(
			'```json theme metadata\n{"presets":[{"name":"Broken","appearance":"dark","colors":{}}]}\n```',
		),
	).toThrow("Invalid theme metadata")
})

test("portable frontmatter retains unrelated fields and round-trips quoted titles", async () => {
	let { withFrontmatter, frontmatter } = await import("../src/shared/markdown")
	let source =
		"---\nsize: L\npath: Old\ntags:\n  - old\n  - labels\n---\n\nBody"
	let result = withFrontmatter(source, {
		title: 'A "quoted" title',
		path: "New/Nested",
		tags: "fresh, useful",
	})
	expect(frontmatter(result).values).toEqual({
		size: "L",
		path: "New/Nested",
		tags: "fresh, useful",
		title: 'A "quoted" title',
	})
	expect(frontmatter(result).body).toBe("\nBody")
})

test("legacy theme archives honor declared paths, fonts, and presets", async () => {
	let { themeFromArchive } = await import("../src/shared/theme-archive")
	let encoder = new TextEncoder()
	let source = themeFromArchive([
		{
			name: "pack/theme.json",
			data: encoder.encode(
				JSON.stringify({
					name: "Legacy",
					css: "styles/main.css",
					template: "layout.html",
					presets: "palette.json",
					fonts: [{ name: "Reading", path: "fonts/body.woff2" }],
				}),
			),
		},
		{
			name: "pack/styles/main.css",
			data: encoder.encode(".content { color: var(--preset-foreground) }"),
		},
		{
			name: "pack/layout.html",
			data: encoder.encode("<article data-content></article>"),
		},
		{
			name: "pack/palette.json",
			data: encoder.encode(
				JSON.stringify([
					{
						name: "Day",
						appearance: "light",
						colors: {
							background: "white",
							foreground: "black",
							accent: "blue",
						},
					},
				]),
			),
		},
		{ name: "pack/fonts/body.woff2", data: new Uint8Array([1, 2, 3]) },
	])
	let compiled = compileTheme(source ?? "")
	expect(compiled.metadata.name).toBe("Legacy")
	expect(compiled.metadata.presets[0]?.name).toBe("Day")
	expect(compiled.css).toContain('font-family:"Reading"')
	expect(compiled.css).toContain("data:font/woff2;base64,AQID")
	expect(compiled.document).toBe("<article data-content></article>")
})

test("distant body edits retain comment anchors and a concurrent insertion between them", () => {
	let original = "---\ntitle: T\n---\nred\nAnchor text\nblue"
	let base = new Replica("base")
	base.edit("doc", original)
	let ids = base
		.visible("doc")
		.slice(original.indexOf("Anchor"), original.indexOf("blue"))
		.map(atom => atom.id)
	let a = fork(base, "a"),
		b = fork(base, "b")
	let edit = a.edit(
		"doc",
		original.replace("red", "green").replace("blue", "purple"),
	)
	if (!edit) throw new Error("Missing source edit")
	b.edit("doc", original.replace("Anchor text", "Anchor peer text"))
	a.apply([...b.operations.values()])
	b.apply([...a.operations.values()])
	expect(a.text("doc")).toBe(
		"---\ntitle: T\n---\ngreen\nAnchor peer text\npurple",
	)
	expect(a.text("doc")).toBe(b.text("doc"))
	expect(
		a
			.visible("doc")
			.filter(atom => ids.includes(atom.id))
			.map(atom => atom.id),
	).toEqual(ids)
	a.inverse(edit)
	expect(a.text("doc")).toBe("---\ntitle: T\n---\nred\nAnchor peer text\nblue")
})

test("body formatting removes block prefixes but keeps indentation and inline markup", async () => {
	let { formatSelection } = await import("../src/shared/authoring")
	let source = "###### **Title**\n  - [x] *Task*\n> Quote\n12. Ordered\nPlain"
	expect(
		formatSelection(source, { start: 0, end: source.length }, "body").source,
	).toBe("**Title**\n  *Task*\nQuote\nOrdered\nPlain")
})

test("image insertion selects the URL and preserves selected alt text", async () => {
	let { formatSelection } = await import("../src/shared/authoring")
	expect(formatSelection("caption", { start: 0, end: 7 }, "image")).toEqual({
		source: "![caption](url)",
		selection: { start: 11, end: 14 },
	})
	expect(formatSelection("", { start: 0, end: 0 }, "image")).toEqual({
		source: "![alt](url)",
		selection: { start: 7, end: 10 },
	})
})
