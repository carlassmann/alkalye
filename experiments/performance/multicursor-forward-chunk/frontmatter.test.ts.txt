import { expect, test } from "bun:test"
import * as Yaml from "effect/encoding/Yaml"
import { Replica } from "../src/shared/crdt"
import {
	changeMetadata,
	replaceDocumentSource,
	documentMetadata,
} from "../src/shared/document-metadata"
import { frontmatter, withFrontmatter } from "../src/shared/markdown"
import { compactOperation, parseOperation } from "../src/shared/model"
import type { Atom } from "../src/shared/model"
import { parseCheckpoint } from "../src/shared/checkpoint"
import {
	commentRange,
	copyDocumentOperations,
	newComment,
} from "../src/shared/documents"

test("Effect YAML retains typed frontmatter, nested data and body offsets", () => {
	let source =
		'\uFEFF---\r\ntitle: "A: title"\r\ntags:\r\n- one\r\n- "two, three"\r\npinned: true\r\noptions:\r\n  color: red\r\nsummary: |\r\n  First\r\n  Second\r\n---\r\n# Body 👋\r\n'
	let result = frontmatter(source)
	expect(result.body).toBe("# Body 👋\r\n")
	expect(result.data.tags).toEqual(["one", "two, three"])
	expect(result.data.options).toEqual({ color: "red" })
	expect(result.data.summary).toBe("First\nSecond\n")
	expect(documentMetadata(source)).toMatchObject({
		title: "A: title",
		pinned: true,
		tags: ["one", "two, three"],
	})
})

test("empty headers and EOF fences retain the actual body", () => {
	expect(frontmatter("---\n---\nBody").body).toBe("Body")
	expect(frontmatter("---\r\n---").body).toBe("")
	expect(frontmatter("Body\n---\ntitle: Nope\n---\n").body).toStartWith("Body")
	expect(frontmatter("---\ntitle: [\n---\nBody").body).toBe("Body")
})

test("metadata patches preserve inline comments and anchor references", () => {
	let source =
		'---\ntitle: &name "Old # title" # Keep this\nmirror: *name\n---\nBody'
	let next = withFrontmatter(source, { title: "New # title" })
	expect(next).toContain('title: &name "New # title" # Keep this')
	expect(frontmatter(next).data.mirror).toBe("New # title")
	let removed = withFrontmatter(next, { title: undefined })
	expect(frontmatter(removed).data.mirror).toBeNull()
	expect(frontmatter(removed).body).toBe("Body")
	let replica = new Replica("writer")
	replica.edit("doc", source)
	replica.edit("doc", source.replace("mirror: *name", "mirror: [*name]"))
	expect(frontmatter(replica.text("doc")).data.mirror).toEqual(["Old # title"])
})

test("flow-map frontmatter patches retain unknown nested values", () => {
	let source =
		'---\n# Retain\n{"title":"Before","options":{"colors":["red","blue"]},"tags":["one, two"]} # Annotation\n---\nBody'
	let next = withFrontmatter(source, { title: "After", pinned: true })
	expect(frontmatter(next).data).toEqual({
		title: "After",
		pinned: true,
		options: { colors: ["red", "blue"] },
		tags: ["one, two"],
	})
	expect(next).toContain("# Retain")
	expect(next).toContain("# Annotation")
	expect(frontmatter(next).body).toBe("Body")
})

test("frontmatter patches preserve unrelated YAML, comments and CRLF", () => {
	let source =
		'\uFEFF---\r\n# Keep this\r\n"title": Old\r\ntags:\r\n- before\r\noptions:\r\n  color: blue\r\nsummary: |\r\n  Keep me\r\n---\r\nBody\r\n'
	let next = withFrontmatter(source, {
		title: 'New: "quoted"\nline',
		tags: ["one, two", "three"],
		pinned: true,
	})
	expect(next).toContain("# Keep this\r\n")
	expect(next).toContain(
		"options:\r\n  color: blue\r\nsummary: |\r\n  Keep me\r\n",
	)
	expect(frontmatter(next).body).toBe("Body\r\n")
	expect(frontmatter(next).data.title).toBe('New: "quoted"\nline')
	expect(frontmatter(next).data.tags).toEqual(["one, two", "three"])
	expect(withFrontmatter(next, { tags: undefined })).not.toContain("tags:")
	expect(withFrontmatter(next, { pinned: true })).toBe(next)
})

test("source fields override legacy registers, including empty and false values", () => {
	let metadata = documentMetadata(
		'---\ntitle: "Source"\npath: ""\ntags: []\npinned: false\narchived: false\ncomments: true\n---\n# Heading',
		{
			title: "Register",
			folder: "Old",
			tags: "old",
			pinned: "true",
			archived: "true",
			commentsDisabled: "true",
		},
	)
	expect(metadata).toEqual({
		title: "Source",
		path: "",
		tags: [],
		pinned: false,
		archived: false,
		commentsDisabled: false,
	})
	expect(
		documentMetadata("# Heading", {
			metadata: "frontmatter-v1",
			title: "Stale",
			archived: "true",
		}),
	).toMatchObject({ title: "Heading", archived: false })
})

test("malformed field types fail independently through Schema", () => {
	expect(
		documentMetadata(
			"---\ntitle: Good\npath: []\ntags: 2\npinned: maybe\n---\nBody",
		),
	).toEqual({
		title: "Good",
		path: "",
		tags: [],
		pinned: false,
		archived: false,
		commentsDisabled: false,
	})
})

test("first metadata edit materializes legacy fields, later deletion cannot resurrect them", () => {
	let replica = new Replica("writer")
	replica.edit("doc", "# Heading\nBody")
	replica.set("doc", "title", "Renamed")
	replica.set("doc", "folder", "Projects")
	replica.set("doc", "archived", "true")
	changeMetadata(replica, "doc", { pinned: true })
	expect(replica.metadata("doc")).toMatchObject({
		title: "Renamed",
		path: "Projects",
		archived: true,
		pinned: true,
	})
	replica.edit("doc", "# Heading\nBody")
	expect(replica.metadata("doc")).toMatchObject({
		title: "Heading",
		path: "",
		archived: false,
		pinned: false,
	})
})

for (let scenario of [
	{
		name: "identical booleans",
		base: "---\npinned: false\n---\nBody",
		a: { pinned: true },
		b: { pinned: true },
	},
	{
		name: "different titles",
		base: "---\ntitle: Draft\n---\nBody",
		a: { title: "Draft 2" },
		b: { title: "Draft v2" },
	},
	{
		name: "independent keys",
		base: "---\ntitle: Draft\npinned: false\n---\nBody",
		a: { title: "New" },
		b: { pinned: true },
	},
	{
		name: "concurrent first headers",
		base: "Body",
		a: { title: "New" },
		b: { pinned: true },
	},
])
	test(`frontmatter converges through wire and snapshot: ${scenario.name}`, () => {
		let base = new Replica("base")
		base.edit("doc", scenario.base)
		base.set("doc", "metadata", "frontmatter-v1")
		let a = fork(base, "a"),
			b = fork(base, "b")
		changeMetadata(a, "doc", scenario.a)
		changeMetadata(b, "doc", scenario.b)
		a.apply(
			[...b.operations.values()]
				.reverse()
				.map(operation => parseOperation(compactOperation(operation))),
		)
		b.apply([...a.operations.values()].reverse())
		expect(a.text("doc")).toBe(b.text("doc"))
		let source = a.text("doc")
		expect(source.match(/^---$/gm)).toHaveLength(2)
		expect(frontmatter(source).body).toBe("Body")
		expect(() => Yaml.parse(frontmatterBlockText(source))).not.toThrow()
		let restored = new Replica("restored")
		restored.restore(parseCheckpoint(a.checkpoint()))
		expect(restored.text("doc")).toBe(source)
		if (
			scenario.name === "independent keys" ||
			scenario.name === "concurrent first headers"
		)
			expect(a.metadata("doc")).toMatchObject({ title: "New", pinned: true })
		if (scenario.name === "different titles")
			expect(a.metadata("doc").title).toBe("Draft v2")
		if (scenario.name === "identical booleans")
			expect(a.metadata("doc").pinned).toBe(true)
		changeMetadata(a, "doc", { title: "Final", pinned: false })
		b.apply([...a.operations.values()])
		expect(b.metadata("doc")).toMatchObject({ title: "Final", pinned: false })
		b.edit("doc", "Body")
		a.apply([...b.operations.values()])
		expect(a.text("doc")).toBe("Body")
	})

test("metadata edits preserve concurrent body insertions and comment atom identities", () => {
	let base = new Replica("base")
	base.edit("doc", "---\ntitle: Before\n---\nHello world 👋")
	base.set("doc", "metadata", "frontmatter-v1")
	let a = fork(base, "a"),
		b = fork(base, "b")
	let bodyAtoms = a
		.visible("doc")
		.slice(-Array.from("Hello world 👋").length)
		.map(atom => atom.id)
	changeMetadata(a, "doc", { title: "After" })
	b.edit("doc", "---\ntitle: Before\n---\nHello brave world 👋")
	a.apply([...b.operations.values()])
	b.apply([...a.operations.values()])
	expect(a.text("doc")).toBe(b.text("doc"))
	expect(frontmatter(a.text("doc")).body).toBe("Hello brave world 👋")
	expect(a.metadata("doc").title).toBe("After")
	expect(
		bodyAtoms.every(id => a.visible("doc").some(atom => atom.id === id)),
	).toBe(true)
})

test("removing and recreating a header keeps a single valid source", () => {
	let replica = new Replica("writer")
	replica.edit("doc", "---\ntitle: Old\n---\nBody")
	replica.edit("doc", "Body")
	replica.edit("doc", "---\ntitle: New\n---\nBody")
	expect(replica.text("doc")).toBe("---\ntitle: New\n---\nBody")
})

test("header deletion concurrent with a metadata edit retains a complete header", () => {
	let base = new Replica("base")
	base.edit("doc", "---\ntitle: Old\n---\nBody")
	base.set("doc", "metadata", "frontmatter-v1")
	let a = fork(base, "a"),
		b = fork(base, "b")
	a.edit("doc", "Body")
	changeMetadata(b, "doc", { pinned: true })
	a.apply([...b.operations.values()])
	b.apply([...a.operations.values()])
	expect(a.text("doc")).toBe(b.text("doc"))
	expect(a.metadata("doc")).toMatchObject({ title: "Untitled", pinned: true })
	expect(frontmatter(a.text("doc")).body).toBe("Body")
})

test("slide separators and local duplicate keys remain literal source", () => {
	let source = "---\nmode: present\n---\n---\nTitle: intro\n---\nBody"
	let replica = new Replica("writer")
	replica.edit("doc", source)
	expect(replica.text("doc")).toBe(source)
	replica.edit("duplicate", "---\ntitle: First\ntitle: Second\n---\nBody")
	expect(replica.text("duplicate")).toBe(
		"---\ntitle: First\ntitle: Second\n---\nBody",
	)
})

test("undo after resolving metadata conflicts restores the previous winner", () => {
	let base = new Replica("base")
	base.edit("doc", "---\ntitle: Old\n---\nBody")
	base.set("doc", "metadata", "frontmatter-v1")
	let a = fork(base, "a"),
		b = fork(base, "b")
	changeMetadata(a, "doc", { title: "A" })
	changeMetadata(b, "doc", { title: "B" })
	a.apply([...b.operations.values()])
	let edit = changeMetadata(a, "doc", { title: "Final" }).at(-1)
	if (!edit) throw new Error("Missing metadata edit")
	a.inverse(edit)
	expect(a.metadata("doc").title).toBe("B")
	expect(frontmatter(a.text("doc")).body).toBe("Body")
})

test("undo header deletion preserves a concurrent metadata change", () => {
	let base = new Replica("base")
	base.edit("doc", "---\ntitle: Old\n---\nBody")
	base.set("doc", "metadata", "frontmatter-v1")
	let a = fork(base, "a"),
		b = fork(base, "b")
	let deletion = a.edit("doc", "Body")
	changeMetadata(b, "doc", { pinned: true })
	a.apply([...b.operations.values()])
	if (!deletion) throw new Error("Missing header deletion")
	a.inverse(deletion)
	expect(a.metadata("doc")).toMatchObject({ title: "Old", pinned: true })
	expect(frontmatter(a.text("doc")).body).toBe("Body")
	expect(a.text("doc").match(/^---$/gm)).toHaveLength(2)
})

test("concurrent body prepends cannot displace frontmatter", () => {
	for (let source of ["Body", "---\ntitle: Old\n---\nBody"]) {
		let base = new Replica("base")
		base.edit("doc", source)
		base.set("doc", "metadata", "frontmatter-v1")
		let a = fork(base, "a"),
			b = fork(base, "z")
		changeMetadata(a, "doc", { title: "New" })
		b.edit("doc", source.replace("Body", "Before Body"))
		a.apply([...b.operations.values()])
		b.apply([...a.operations.values()])
		expect(a.text("doc")).toBe(b.text("doc"))
		expect(a.metadata("doc").title).toBe("New")
		expect(frontmatter(a.text("doc")).body).toBe("Before Body")
	}
})

test("typing a duplicate key leaves it visible for correction", () => {
	let replica = new Replica("writer")
	replica.edit("doc", "---\ntitle: Old\n---\nBody")
	replica.edit("doc", "---\ntitle: Old\ntitle: New\n---\nBody")
	expect(replica.text("doc")).toBe("---\ntitle: Old\ntitle: New\n---\nBody")
})

test("header typing preserves source order, scalar continuations and broken fences", () => {
	for (let source of [
		"---\ntitle: First\npinned: false\ntags: [one]\n---\nBody",
		"---\nsummary: |\n  First\n\n  Last\ntitle: First\n---\nBody",
		"---\ntitle: First\n---",
	]) {
		let replica = new Replica("writer")
		replica.edit("doc", source)
		expect(replica.text("doc")).toBe(source)
		let next = source.replace("First", "Changed")
		replica.edit("doc", next)
		expect(replica.text("doc")).toBe(next)
		for (let broken of ["x" + next, next.replace("---", "--")]) {
			let editor = new Replica("other")
			editor.edit("doc", next)
			editor.edit("doc", broken)
			expect(editor.text("doc")).toBe(broken)
		}
	}
})

test("headers over list and separator prefixes remain complete during concurrent creation", () => {
	for (let body of ["- item", "---\nSlide text", "-- body"]) {
		let base = new Replica("base")
		base.edit("doc", body)
		base.set("doc", "metadata", "frontmatter-v1")
		let a = fork(base, "a"),
			b = fork(base, "b")
		changeMetadata(a, "doc", { title: "Title" })
		changeMetadata(b, "doc", { pinned: true })
		a.apply([...b.operations.values()])
		b.apply([...a.operations.values()])
		expect(a.text("doc")).toBe(b.text("doc"))
		expect(a.metadata("doc")).toMatchObject({ title: "Title", pinned: true })
		expect(frontmatter(a.text("doc")).body).toBe(body)
	}
})

test("body typing does not rewrite a header containing literal duplicate keys", () => {
	let base = new Replica("base")
	base.edit("doc", "---\ntitle: One\ntitle: Two\n---\nBody")
	let a = fork(base, "a"),
		b = fork(base, "b")
	a.edit("doc", a.text("doc") + " A")
	b.edit("doc", b.text("doc") + " B")
	a.apply([...b.operations.values()])
	b.apply([...a.operations.values()])
	expect(a.text("doc")).toBe(b.text("doc"))
	expect(a.text("doc").match(/^title:/gm)).toHaveLength(2)
	expect(a.text("doc")).toContain("A")
	expect(a.text("doc")).toContain("B")
})

test("selective undo and redo preserve a subsequent rename by the same actor", () => {
	let replica = new Replica("writer")
	replica.edit("doc", "---\ntitle: Initial\n---\nBody")
	replica.set("doc", "metadata", "frontmatter-v1")
	let typed = replica.edit("doc", "---\ntitle: Typed\n---\nBody")
	changeMetadata(replica, "doc", { title: "Renamed" })
	if (!typed) throw new Error("Missing edit")
	let inverse = replica.inverse(typed)
	expect(replica.metadata("doc").title).toBe("Renamed")
	replica.inverse(inverse)
	expect(replica.metadata("doc").title).toBe("Renamed")
})

test("undoing a slide deletion never turns body text into frontmatter", () => {
	let replica = new Replica("writer")
	let source = "---\ntitle: Slides\n---\n# One\n---\nSlide 2\n---\n# Three"
	replica.edit("doc", source)
	let edit = replica.edit("doc", source.replace("---\nSlide 2\n---\n", ""))
	if (!edit) throw new Error("Missing slide edit")
	replica.inverse(edit)
	expect(replica.text("doc")).toBe(source)
	expect(replica.metadata("doc").title).toBe("Slides")
})

test("composition over a header comment preserves unseen remote metadata", () => {
	let base = new Replica("base")
	let source = "---\n# Original\ntitle: Before\n---\nBody"
	base.edit("doc", source)
	base.set("doc", "metadata", "frontmatter-v1")
	let a = fork(base, "a"),
		b = fork(base, "b")
	let startingAtoms = a.visible("doc")
	changeMetadata(b, "doc", { title: "Remote" })
	a.apply([...b.operations.values()])
	a.edit("doc", source.replace("# Original", "# Composed"), startingAtoms)
	b.apply([...a.operations.values()])
	expect(a.text("doc")).toBe(b.text("doc"))
	expect(a.metadata("doc").title).toBe("Remote")
	expect(a.text("doc")).toContain("# Composed")
	expect(frontmatter(a.text("doc")).body).toBe("Body")
})

test("header comments retain unchanged quotes after atomic entry edits", () => {
	let replica = new Replica("writer")
	let source = "---\ntitle: Initial title\n---\nBody"
	replica.edit("doc", source)
	replica.set("doc", "metadata", "frontmatter-v1")
	newComment(
		replica,
		"comment",
		"doc",
		"title",
		"Clarify",
		"Writer",
		source.indexOf("title"),
	)
	changeMetadata(replica, "doc", { title: "Renamed title" })
	let range = commentRange(replica, "doc", replica.fields("comment"))
	expect(replica.text("doc").slice(range?.start, range?.end)).toBe("title")
})

test("copying legacy metadata into an existing canonical document materializes its source", () => {
	let source = new Replica("legacy"),
		destination = new Replica("current")
	source.set("doc", "type", "document")
	source.set("doc", "title", "Legacy")
	source.set("doc", "folder", "Projects")
	source.set("doc", "archived", "true")
	source.edit("doc", "Body")
	destination.set("doc", "type", "document")
	destination.set("doc", "metadata", "frontmatter-v1")
	destination.apply(
		copyDocumentOperations(source, destination, "doc").filter(
			operation => operation !== null,
		),
	)
	expect(destination.metadata("doc")).toMatchObject({
		title: "Legacy",
		path: "Projects",
		archived: true,
	})
	expect(frontmatter(destination.text("doc")).body).toBe("Body")
})

test("concurrent legacy migration cannot overwrite another writer's explicit metadata edit", () => {
	let base = new Replica("base")
	base.edit("doc", "Body")
	base.set("doc", "title", "Old")
	let a = fork(base, "a"),
		b = fork(base, "z")
	changeMetadata(a, "doc", { title: "Renamed" })
	changeMetadata(b, "doc", { pinned: true })
	a.apply([...b.operations.values()])
	b.apply([...a.operations.values()])
	expect(a.text("doc")).toBe(b.text("doc"))
	expect(a.metadata("doc")).toMatchObject({ title: "Renamed", pinned: true })
})

test("three writers converge through delayed delivery, duplicate replay and cached reopen", () => {
	for (let seed = 1; seed <= 50; seed++) {
		let random = seededRandom(seed)
		let base = new Replica("base")
		base.edit("doc", "Body 👋")
		base.set("doc", "metadata", "frontmatter-v1")
		let writers = [fork(base, "a"), fork(base, "b"), fork(base, "c")]
		for (let step = 0; step < 18; step++) {
			let writer = writers[Math.floor(random() * writers.length)]
			if (!writer) throw new Error("Missing writer")
			if (step % 4 === 0)
				writer.edit("doc", writer.text("doc") + ` ${writer.actor}${step}`)
			else if (step % 4 === 1)
				changeMetadata(writer, "doc", { title: `Title ${writer.actor}${step}` })
			else if (step % 4 === 2)
				changeMetadata(writer, "doc", {
					pinned: random() > 0.5,
					tags: [writer.actor, `tag, ${step}`],
				})
			else
				changeMetadata(writer, "doc", {
					path: `Folder/${step}`,
					commentsDisabled: random() > 0.5,
				})
			for (let peer of writers)
				if (peer !== writer && random() < 0.3)
					peer.apply([...writer.operations.values()].reverse())
		}
		let operations = [
			...new Map(writers.flatMap(writer => [...writer.operations])).values(),
		]
		for (let writer of writers) {
			writer.apply([...operations].reverse())
			writer.apply(operations)
		}
		let source = writers[0]?.text("doc") ?? ""
		expect(writers.every(writer => writer.text("doc") === source)).toBe(true)
		expect(source.match(/^---$/gm)).toHaveLength(2)
		expect(() => Yaml.parse(frontmatterBlockText(source))).not.toThrow()
		expect(frontmatter(source).body).toStartWith("Body 👋")
		for (let writer of writers) {
			let restored = new Replica("reopened")
			restored.restore(parseCheckpoint(writer.checkpoint()))
			expect(restored.text("doc")).toBe(source)
			expect(restored.metadata("doc")).toEqual(writer.metadata("doc"))
		}
	}
})

function seededRandom(seed: number) {
	return function () {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
		return seed / 4294967296
	}
}

function fork(base: Replica, actor: string) {
	let replica = new Replica(actor)
	replica.apply([...base.operations.values()])
	return replica
}
function frontmatterBlockText(source: string) {
	return (
		source.replace(/^\uFEFF?---\r?\n/, "").split(/\r?\n---(?:\r?\n|$)/)[0] ?? ""
	)
}

test("header deletion preserves body identities and concurrent prepends", () => {
	let base = new Replica("base")
	base.edit("doc", "---\ntitle: T\n---\nHello")
	let a = fork(base, "a"),
		b = fork(base, "b")
	let bodyIds = a
		.visible("doc")
		.slice(-5)
		.map(atom => atom.id)
	a.edit("doc", "Hello")
	b.edit("doc", "---\ntitle: T\n---\nSayHello")
	a.apply([...b.operations.values()])
	expect(a.text("doc")).toBe("SayHello")
	expect(
		a
			.visible("doc")
			.slice(-5)
			.map(atom => atom.id),
	).toEqual(bodyIds)
})

test("stale header deletion removes every frame observed by the editor", () => {
	let a = new Replica("a")
	a.edit("doc", "---\ntitle: T\n---\nBody")
	a.edit("doc", "---\ntitle: U\n---\nBody")
	let b = fork(a, "b"),
		view = a.visible("doc")
	b.edit("doc", b.text("doc") + "!")
	a.apply([...b.operations.values()])
	a.edit("doc", "Body", view)
	expect(a.text("doc")).toBe("Body!")
})

test("stale composition does not resurrect an unchanged key deleted by a peer", () => {
	let a = new Replica("a")
	a.edit("doc", "---\n# A\ntitle: T\npinned: true\n---\nBody")
	let b = fork(a, "b"),
		view = a.visible("doc")
	b.edit("doc", "---\n# A\ntitle: T\n---\nBody")
	a.apply([...b.operations.values()])
	a.edit("doc", "---\n# B\ntitle: T\npinned: true\n---\nBody", view)
	expect(a.metadata("doc").pinned).toBe(false)
	expect(a.text("doc")).toContain("# B")
})

test("undo restores header comments and its original EOF closing fence", () => {
	let replica = new Replica("a")
	let original = "---\n# A\ntitle: T\n---"
	replica.edit("doc", original)
	let edit = replica.edit("doc", "---\n# B\ntitle: T\n---")
	if (!edit) throw new Error("Missing edit")
	replica.inverse(edit)
	expect(replica.text("doc")).toBe(original)
})

test("plain ampersands and asterisks do not turn independent keys into one conflict", () => {
	for (let title of ["Q&A", "Plan*", '"Q & A"', '"*heading"']) {
		let base = new Replica("base")
		base.edit("doc", `---\ntitle: ${title}\n---\nBody`)
		let a = fork(base, "a"),
			b = fork(base, "z")
		a.edit("doc", "---\ntitle: New\n---\nBody")
		b.edit("doc", `---\ntitle: ${title}\npinned: true\n---\nBody`)
		a.apply([...b.operations.values()])
		expect(a.metadata("doc")).toMatchObject({ title: "New", pinned: true })
	}
})

test("migration at a higher unrelated room clock cannot replace explicit metadata", () => {
	let base = new Replica("base")
	base.edit("doc", "Body")
	base.set("doc", "title", "Old")
	base.set("doc", "archived", "true")
	let a = fork(base, "a"),
		b = fork(base, "z")
	for (let i = 0; i < 5; i++) b.set("other", "x", String(i))
	changeMetadata(a, "doc", { title: "Renamed", archived: false })
	changeMetadata(b, "doc", { pinned: true })
	let operations = [...new Map([...a.operations, ...b.operations]).values()]
	let merged = new Replica("merged")
	merged.apply(
		operations
			.map(operation => parseOperation(compactOperation(operation)))
			.reverse(),
	)
	expect(merged.metadata("doc")).toMatchObject({
		title: "Renamed",
		archived: false,
		pinned: true,
	})
	let reopened = new Replica("reopened")
	reopened.restore(parseCheckpoint(merged.checkpoint()))
	expect(reopened.text("doc")).toBe(merged.text("doc"))
})

test("body edits cannot erase a deletion that outranks a delayed legacy migration", () => {
	let base = new Replica("base")
	base.edit("doc", "Body")
	base.set("doc", "title", "Old")
	let a = fork(base, "a"),
		b = fork(base, "z")
	for (let i = 0; i < 5; i++) b.set("other", "x", String(i))
	changeMetadata(a, "doc", { title: "" })
	a.edit("doc", "Body edited")
	changeMetadata(b, "doc", { pinned: true })
	a.apply([...b.operations.values()])
	expect(a.metadata("doc")).toMatchObject({ title: "Untitled", pinned: true })
	expect(frontmatter(a.text("doc")).body).toBe("Body edited")
})

test("native YAML keys with spaces, Unicode and periods remain independent entries", () => {
	let source =
		"---\nproject.name: First\n日本語: Before\ncustom label: Original\ntitle: T\n---\nBody"
	let base = new Replica("base")
	base.edit("doc", source)
	let a = fork(base, "a"),
		b = fork(base, "z")
	a.edit("doc", source.replace("First", "Changed").replace("Before", "After"))
	b.edit("doc", source.replace("Original", "Updated"))
	a.apply([...b.operations.values()])
	expect(frontmatter(a.text("doc")).data).toEqual({
		"project.name": "Changed",
		日本語: "After",
		"custom label": "Updated",
		title: "T",
	})
})

test("first full-source write migrates legacy metadata before marking its source authoritative", () => {
	let replica = new Replica("writer")
	replica.edit("doc", "Body")
	replica.set("doc", "title", "Legacy")
	replica.set("doc", "folder", "Projects")
	replica.set("doc", "archived", "true")
	replaceDocumentSource(replica, "doc", "Body!")
	expect(replica.metadata("doc")).toMatchObject({
		title: "Legacy",
		path: "Projects",
		archived: true,
	})
	expect(frontmatter(replica.text("doc")).body).toBe("Body!")
	replaceDocumentSource(replica, "doc", "Body!!")
	expect(replica.metadata("doc")).toMatchObject({
		title: "Untitled",
		path: "",
		archived: false,
	})
})

test("header comments must preserve concurrent untouched keys", () => {
	let base = new Replica("base")
	base.edit("doc", "---\n# c\ntitle: T\n---\nBody")
	base.set("doc", "metadata", "frontmatter-v1")
	let a = fork(base, "b"),
		z = fork(base, "z")
	changeMetadata(a, "doc", { title: "Peer" })
	z.edit("doc", "---\n# d\ntitle: T\n---\nBody")
	a.apply([...z.operations.values()])
	expectSourceConvergence(a, z)
	expect(a.metadata("doc").title).toBe("Peer")
})

test("EOF formatting must preserve concurrent untouched keys", () => {
	let base = new Replica("base")
	base.edit("doc", "---\ntitle: T\n---")
	base.set("doc", "metadata", "frontmatter-v1")
	let a = fork(base, "b"),
		z = fork(base, "z")
	changeMetadata(a, "doc", { title: "Peer" })
	z.edit("doc", "---\ntitle: T\n---\n")
	a.apply([...z.operations.values()])
	expectSourceConvergence(a, z)
	expect(a.metadata("doc").title).toBe("Peer")
})

test("concurrent body separators cannot swallow a new header", () => {
	let base = new Replica("base")
	base.edit("doc", "Body")
	base.set("doc", "metadata", "frontmatter-v1")
	let a = fork(base, "a"),
		z = fork(base, "z")
	changeMetadata(a, "doc", { title: "X" })
	z.edit("doc", "---\nBody")
	a.apply([...z.operations.values()])
	expectSourceConvergence(a, z)
	expect(a.metadata("doc").title).toBe("X")
	expect(frontmatter(a.text("doc")).body).toBe("---\nBody")
})

test("concurrent source edits cannot leave dangling YAML aliases", () => {
	let base = new Replica("base")
	base.edit("doc", "---\ntitle: T\n---\nBody")
	base.set("doc", "metadata", "frontmatter-v1")
	let a = fork(base, "a"),
		z = fork(base, "z")
	a.edit("doc", "---\ntitle: &n T\nalias: *n\n---\nBody")
	let rename = changeMetadata(z, "doc", { title: "Z" }).at(-1)
	if (!rename) throw new Error("Missing metadata rename")
	a.apply([...z.operations.values()])
	expectSourceConvergence(a, z)
	expect(() => Yaml.parse(frontmatterBlockText(a.text("doc")))).not.toThrow()
	expect(a.metadata("doc").title).toBe("Z")
	let undo = z.inverse(rename)
	a.apply([...z.operations.values()])
	expectSourceConvergence(a, z)
	expect(a.metadata("doc").title).toBe("T")
	expect(() => Yaml.parse(frontmatterBlockText(a.text("doc")))).not.toThrow()
	z.inverse(undo)
	a.apply([...z.operations.values()])
	expectSourceConvergence(a, z)
	expect(() => Yaml.parse(frontmatterBlockText(a.text("doc")))).not.toThrow()
	expect(a.metadata("doc").title).toBe("Z")
})

function expectSourceConvergence(first: Replica, second: Replica) {
	second.apply([...first.operations.values()].reverse())
	expect(second.text("doc")).toBe(first.text("doc"))
	let replay = new Replica("replay")
	let operations = [...first.operations.values()].map(operation =>
		parseOperation(compactOperation(operation)),
	)
	replay.apply([...operations].reverse())
	replay.apply(operations)
	expect(replay.text("doc")).toBe(first.text("doc"))
	let reopened = new Replica("reopened")
	reopened.restore(parseCheckpoint(replay.checkpoint()))
	expect(reopened.text("doc")).toBe(first.text("doc"))
	expect(reopened.metadata("doc")).toEqual(first.metadata("doc"))
}

test("invalid source YAML retains independent concurrent fields and literal asterisks", () => {
	let base = new Replica("base")
	base.edit("doc", "---\ntitle: T\n---\nBody")
	let first = fork(base, "a"),
		second = fork(base, "z")
	first.edit(
		"doc",
		"---\ntitle: Updated\npinned: true\nsummary: '*'\n---\nBody",
	)
	second.edit("doc", "---\ntitle: [\n---\nBody")
	first.apply([...second.operations.values()])
	expectSourceConvergence(first, second)
	expect(first.text("doc")).toContain("title: [")
	expect(first.text("doc")).toContain("pinned: true")
	expect(first.text("doc")).toContain("summary: '*'")
})

test("concurrent deletion of an anchor cannot break an unseen alias", () => {
	let base = new Replica("base")
	base.edit("doc", "---\ntitle: &n T\nx: 1\n---\nBody")
	let first = fork(base, "a"),
		second = fork(base, "z")
	first.edit("doc", "---\ntitle: &n T\nx: 1\nalias: *n\n---\nBody")
	second.edit("doc", "---\nx: 1\n---\nBody")
	first.apply([...second.operations.values()])
	expectSourceConvergence(first, second)
	expect(() =>
		Yaml.parse(frontmatterBlockText(first.text("doc"))),
	).not.toThrow()
	expect(frontmatter(first.text("doc")).data).toEqual({ x: 1 })
	second.edit("doc", "---\nx: 1\nalias: *n\n---\nBody")
	expect(second.text("doc")).toContain("alias: *n")
})

test("concurrent replacement of an existing value by an alias survives anchor deletion as valid source", () => {
	let base = new Replica("base")
	base.edit("doc", "---\ntitle: &n T\nx: 1\nalias: 1\n---\nBody")
	let first = fork(base, "a"),
		second = fork(base, "z")
	first.edit("doc", "---\ntitle: &n T\nx: 1\nalias: *n\n---\nBody")
	second.edit("doc", "---\nx: 1\nalias: 1\n---\nBody")
	first.apply([...second.operations.values()])
	expectSourceConvergence(first, second)
	expect(() =>
		Yaml.parse(frontmatterBlockText(first.text("doc"))),
	).not.toThrow()
	expect(frontmatter(first.text("doc")).data).toEqual({ x: 1 })
})

test("removing an anchor after reading its alias preserves deliberately invalid source", () => {
	let replica = new Replica("writer")
	replica.edit("doc", "---\ntitle: &n T\nx: 1\nalias: *n\n---\nBody")
	let invalid = "---\nx: 1\nalias: *n\n---\nBody"
	replica.edit("doc", invalid)
	expect(replica.text("doc")).toBe(invalid)
	let restored = new Replica("reopened")
	restored.restore(parseCheckpoint(replica.checkpoint()))
	expect(restored.text("doc")).toBe(invalid)
})

test("an undone anchor cannot justify hiding newly typed invalid aliases", () => {
	for (let undo of ["cancel", "inverse"]) {
		let base = new Replica("base")
		base.edit("doc", "---\ntitle: T\nx: 1\n---\nBody")
		let anchored = base.edit("doc", "---\ntitle: &n T\nx: 1\n---\nBody")
		if (!anchored) throw new Error("Missing anchor edit")
		if (undo === "cancel") base.cancel("doc", anchored.id)
		else base.inverse(anchored)
		expect(base.text("doc")).not.toContain("&n")
		let first = fork(base, "a"),
			second = fork(base, "z")
		first.edit("doc", "---\ntitle: T\nx: 1\nalias: *n\n---\nBody")
		second.edit("doc", "---\nx: 1\n---\nBody")
		first.apply([...second.operations.values()])
		expectSourceConvergence(first, second)
		expect(first.text("doc")).toContain("alias: *n")
	}
})

test("typing after an EOF header preserves its newline and body across checkpoints", () => {
	let replica = new Replica("eof-writer")
	let source = "---\na: 1\n---"
	replica.edit("document", source)
	for (let appended of ["\n", "x"]) {
		source += appended
		replica.edit("document", source)
		expect(replica.text("document")).toBe(source)
		let restored = new Replica("reader")
		restored.restore(parseCheckpoint(replica.checkpoint()))
		expect(restored.text("document")).toBe(source)
	}
})

test("closing an offline root header cannot leave the incremental view different from its checkpoint", () => {
	let first = new Replica("a"),
		second = new Replica("z")
	let header = first.edit("document", "---\na: 1\n")
	let body = second.edit("document", "hello\n")
	if (!header || !body) throw Error("Missing initial edits")
	first.apply([body])
	second.apply([header])
	expect(first.text("document")).toBe("hello\n---\na: 1\n")
	let close = first.prepareEdit("document", first.text("document") + "---")
	if (!close) throw Error("Missing closing edit")
	first.apply([parseOperation(compactOperation(close))])
	second.apply([close])
	let restored = new Replica("reader")
	restored.restore(parseCheckpoint(first.checkpoint()))
	expect(first.text("document")).toBe(restored.text("document"))
	expect(second.text("document")).toBe(restored.text("document"))
})

test("editing a promoted offline header body preserves raw anchors for following metadata edits", () => {
	let first = new Replica("a"),
		second = new Replica("z")
	let header = first.edit("document", "---\ntitle: Before\n---\n")
	let body = second.edit("document", "hello\n")
	if (!header || !body) throw Error("Missing initial edits")
	first.apply([body])
	second.apply([header])
	let source = first.text("document")
	first.edit("document", source.replace("hello", "hEllo"))
	changeMetadata(first, "document", { title: "After" })
	let restored = new Replica("reader")
	restored.restore(parseCheckpoint(first.checkpoint()))
	expect(first.text("document")).toBe(restored.text("document"))
	expect(first.metadata("document").title).toBe("After")
	expect(restored.text("document")).toContain("hEllo")
})

test("body edits promote a header revealed by another writer deleting its prefix", () => {
	for (let editing of ["append", "middle"]) {
		let first = new Replica("a"),
			second = new Replica("b")
		let prefix = first.edit("document", "x")
		if (!prefix) throw Error("Missing prefix")
		second.apply([prefix])
		let source = "---\nk: 1\n---\nbody"
		let inserted = first.edit("document", "x" + source)
		let removed = second.edit("document", "")
		if (!inserted || !removed) throw Error("Missing concurrent edits")
		first.apply([removed])
		second.apply([inserted])
		expect(first.text("document")).toBe(source)
		let next =
			editing === "append" ? source + "!" : source.replace("body", "bOdy")
		let edited = first.edit("document", next)
		if (!edited) throw Error("Missing body edit")
		second.apply([parseOperation(compactOperation(edited))])
		expect(first.visible("document")[0]?.after).toBe("")
		expect(first.text("document")).toBe(next)
		expect(second.text("document")).toBe(next)
		let restored = new Replica("reader")
		restored.restore(parseCheckpoint(first.checkpoint()))
		expect(restored.text("document")).toBe(next)
		changeMetadata(first, "document", { title: "Promoted" })
		expect(first.metadata("document").title).toBe("Promoted")
	}
})

test("bulk reads preserve immutable replica views through incremental edits and concurrent metadata", () => {
	let first = new Replica("reader-contract")
	let source =
		"---\ntitle: Initial\n---\n" + "A body with 👋 text.\n".repeat(200)
	first.edit("document", source)
	let view = first.visible("document")
	let values = Array.from(view)
	for (let [start, end] of [
		[undefined, undefined],
		[1, undefined],
		[-2, undefined],
		[-0.5, undefined],
		[0.5, 2.9],
		[NaN, undefined],
		[Infinity, undefined],
		[-Infinity, Infinity],
		[1, -1],
		[undefined, 2],
	]) {
		let sliced = view.slice(start, end)
		expect(sliced).toEqual(values.slice(start, end))
		expect(Object.getPrototypeOf(sliced)).toBe(Array.prototype)
	}
	let copy = view.slice()
	copy.pop()
	expect(view.length).toBe(values.length)
	expect(view.slice()).not.toBe(copy)
	expect(view.slice.call(copy, 1)).toEqual(copy.slice(1))
	let context = { calls: 0, valid: true }
	function value(
		this: typeof context,
		atom: Atom,
		index: number,
		atoms: Atom[],
	) {
		this.valid &&= atoms === view && atom === values[index]
		this.calls++
		return atom.value
	}
	expect(view.map(value, context).join("")).toBe(source)
	expect(context.calls).toBe(view.length)
	expect(
		view.some(function (this: typeof context, atom, index, atoms) {
			this.valid &&=
				this === context && atoms === view && atom === values[index]
			return atom.value === "👋"
		}, context),
	).toBe(true)
	expect(context.valid).toBe(true)
	expect(Array.from(view.entries())).toEqual(Array.from(values.entries()))
	expect(Reflect.set(view, "0", values.at(-1))).toBe(false)
	expect(view[0]).toBe(values[0])
	let second = first.fork("concurrent-metadata")
	let edit = first.prepareEdit("document", source + "Appended")
	if (!edit) throw Error("Missing prepared body edit")
	first.apply([parseOperation(compactOperation(edit))])
	changeMetadata(second, "document", { title: "Concurrent" })
	first.apply([...second.operations.values()])
	second.apply([...first.operations.values()])
	let current = first.visible("document")
	expect(current.map(atom => atom.value).join("")).toBe(second.text("document"))
	expect(first.text("document")).toEndWith("Appended")
	expect(first.metadata("document").title).toBe("Concurrent")
	expect(view.map(atom => atom.value).join("")).toBe(source)
	expect(view.slice()).toEqual(values)
	let restored = new Replica("restored")
	restored.restore(parseCheckpoint(first.checkpoint()))
	expect(restored.text("document")).toBe(first.text("document"))
})
