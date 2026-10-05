import { expect, test } from "bun:test"
import {
	applyViewEdit,
	iconPrefix,
	project,
	sameProjection,
	toSource,
	toView,
} from "../src/shared/projection"
import type { Projection } from "../src/shared/projection"

let documents = [
	{ id: "doc-1", title: "Field guide", archived: false },
	{ id: "doc-2", title: "Trip log", archived: false },
]

test("inactive Markdown links and wiki-links collapse to their labels", () => {
	let source = [
		"# Notes",
		"Read [the docs](https://example.org/docs) today.",
		"See [[doc-1]] and [[doc-2|the log]]s, then [[missing]].",
		"Write to [me](mailto:me@example.org 'Mail') or [](https://example.org).",
	].join("\n")
	let projection = project(source, { active: { start: 0, end: 0 }, documents })
	expect(projection.text).toBe(
		[
			"# Notes",
			"Read the docs today.",
			"See Field guide and the logs, then Document Not Found.",
			"Write to me or Web Link.",
		].join("\n"),
	)
	expect(
		projection.links.map(link => [link.kind, link.target, link.broken]),
	).toEqual([
		["link", "https://example.org/docs", false],
		["wiki", "doc-1", false],
		["wiki", "doc-2", false],
		["wiki", "missing", true],
		["link", "mailto:me@example.org", false],
		["link", "https://example.org", false],
	])
	expect(project(source, { documents }).links).toHaveLength(6)
})

test("tokens touched by the selection stay raw", () => {
	let source =
		"[a](https://a.example)\n[b](https://b.example)\n[c](https://c.example)"
	let second = source.indexOf("[b]")
	expect(
		project(source, { active: { start: second + 1, end: second + 1 } }).text,
	).toBe("a\n[b](https://b.example)\nc")
	expect(
		project(source, { active: { start: 2, end: source.length - 2 } }).text,
	).toBe(source)
	expect(
		project(source, { active: { start: second - 1, end: second - 1 } }).text,
	).toBe("[a](https://a.example)\nb\nc")
})

test("balanced destinations, angle brackets and titles collapse whole", () => {
	let source =
		'x\n[Foo](https://en.wikipedia.org/wiki/Foo_(bar)) [spaced](<https://example.org/a b> "Title") [nested [label]](https://example.org) end'
	expect(project(source, { active: { start: 0, end: 0 } }).text).toBe(
		"x\nFoo spaced nested [label] end",
	)
})

test("code, frontmatter, unsafe and non-media asset links stay raw", () => {
	let source = [
		"---",
		"link: [x](https://example.org)",
		"---",
		"```md",
		"[fenced](https://example.org) [[doc-1]]",
		"```",
		"    [indented](https://example.org)",
		"`[inline](https://example.org)` ![image](https://example.org/a.png)",
		"[bad](javascript:alert(1)) [asset](asset:abc) \\[escaped](https://example.org)",
		"[[doc-1]]",
	].join("\n")
	let projection = project(source, { documents })
	expect(projection.text).toBe(
		(source.slice(0, source.lastIndexOf("\n") + 1) + "Field guide").replace(
			"![image](https://example.org/a.png)",
			"image",
		),
	)
	expect(projection.links).toHaveLength(2)
})

test("offsets round-trip through raw text and label characters", () => {
	let source = "a [label](https://example.org) b [[doc-1]] c"
	let projection = project(source, { documents })
	expect(projection.text).toBe("a label b Field guide c")
	for (let offset = 0; offset <= projection.text.length; offset++) {
		if (offset > 10 && offset < 21) continue
		let start = toSource(projection, offset, "start")
		expect(toView(projection, start)).toBe(offset)
	}
	let label = source.indexOf("label")
	expect(toSource(projection, 2)).toBe(2)
	expect(toSource(projection, 4)).toBe(label + 2)
	expect(toSource(projection, 7)).toBe(source.indexOf(" b"))
	expect(toView(projection, source.indexOf("https"))).toBe(7)
	let wiki = source.indexOf("[[")
	expect(toSource(projection, 13, "start")).toBe(wiki)
	expect(toSource(projection, 13, "end")).toBe(source.indexOf(" c"))
	expect(toView(projection, wiki + 4)).toBe(10)
})

test("native edits map back to the source", () => {
	let source = "Intro\n[label](https://example.org) and [[doc-1]]\ntail"
	let projection = project(source, { active: { start: 0, end: 0 }, documents })
	expect(projection.text).toBe("Intro\nlabel and Field guide\ntail")

	let typed = edit(projection, "Intro!\nlabel and Field guide\ntail", 6)
	expect(typed.source).toBe("Intro!\n" + source.slice(6))
	expect(toSource(typed, typed.text.indexOf("tail"))).toBe(
		typed.source.indexOf("tail"),
	)

	let relabelled = edit(projection, "Intro\nlaXbel and Field guide\ntail", 9)
	expect(relabelled.source).toBe(
		"Intro\n[laXbel](https://example.org) and [[doc-1]]\ntail",
	)
	expect(relabelled.links[0]?.view).toEqual({ start: 6, end: 12 })

	let removed = edit(projection, "Intro\nlabel and Field gude\ntail", 24)
	expect(removed.source).toBe("Intro\n[label](https://example.org) and \ntail")

	let joined = edit(projection, "Intrlabel and Field guide\ntail", 4)
	expect(joined.source).toBe("Intr" + source.slice(6))
	expect(toSource(joined, 6)).toBe(joined.source.indexOf("bel]"))

	let straddled = edit(projection, "Intro\nlabd Field guide\ntail", 9)
	expect(straddled.source).toBe("Intro\n[labd [[doc-1]]\ntail")
	expect(straddled.text).toBe(straddled.source)
})

test("repeated characters at a link boundary insert where the caret is", () => {
	let source = "x\n[aa](https://example.org)a"
	let projection = project(source, { active: { start: 0, end: 0 } })
	expect(projection.text).toBe("x\naaa")
	expect(edit(projection, "x\naaaa", 6).source).toBe(source + "a")
	expect(edit(projection, "x\naaaa", 2).source).toBe("x\na" + source.slice(2))
})

function edit(projection: Projection, next: string, caret: number) {
	return applyViewEdit(projection, next, caret)
}

test("moving outside a link collapses it on the same task line", () => {
	let source =
		"- [ ] [hello](https://hello.world.com) and [other](https://example.org)"
	expect(project(source, { active: { start: 3, end: 3 } }).text).toBe(
		"- [ ] hello and other",
	)
	let label = source.indexOf("hello") + 2
	expect(project(source, { active: { start: label, end: label } }).text).toBe(
		"- [ ] [hello](https://hello.world.com) and other",
	)
	let between = source.indexOf(" and ") + 1
	expect(
		project(source, { active: { start: between, end: between } }).text,
	).toBe("- [ ] hello and other")
})

test("Unicode labels preserve source offsets and edits after compact links", () => {
	let source = "👋 [日本語 🚀](https://example.org) and [[doc-1]]\nfin 🐈"
	let projection = project(source, { documents })
	let label = source.indexOf("日本語")
	let visible = projection.text.indexOf("日本語")
	for (let index = 1; index < "日本語 🚀".length; index++) {
		expect(toSource(projection, visible + index)).toBe(label + index)
		expect(toView(projection, label + index)).toBe(visible + index)
	}
	for (let suffix of ["!", "日本語", "🐈", "\n[more](https://more.example)"]) {
		let next = applyViewEdit(projection, projection.text + suffix)
		expect(next.source).toBe(source + suffix)
		expect(toSource(next, next.text.length)).toBe(next.source.length)
	}
})

test("a changed wiki destination invalidates an otherwise identical projection", () => {
	let source = "[[Field guide]]"
	let first = project(source, { documents })
	let second = project(source, {
		documents: [{ id: "new-id", title: "Field guide", archived: false }],
	})
	expect(first.text).toBe(second.text)
	expect(sameProjection(first, second)).toBe(false)
})

test("media collapses to labels while source selections reveal its syntax", () => {
	let source =
		'Intro\n![Photo](asset:photo) ![](./image.png) ![Board](asset:board) ![Video](https://example.org/movie.mp4 "Film")\ntail'
	let projection = project(source)
	expect(projection.text).toBe("Intro\nPhoto Media Board Video\ntail")
	expect(projection.links.map(link => [link.kind, link.target])).toEqual([
		["media", "asset:photo"],
		["media", "./image.png"],
		["media", "asset:board"],
		["media", "https://example.org/movie.mp4"],
	])
	let caret = source.indexOf("photo)")
	expect(
		project(source, { active: { start: caret, end: caret } }).text,
	).toContain("![Photo](asset:photo)")
	expect(project("![bad](javascript:alert(1))").text).toBe(
		"![bad](javascript:alert(1))",
	)
	expect(
		project("[![Photo](./image.png)](https://example.org)").links.map(
			link => link.kind,
		),
	).toEqual(["link"])
})

test("icon spacing preserves label offsets and source-only clipboard selections", () => {
	let source =
		"Intro\n![Photo](asset:photo) and [link](https://example.org)\ntail"
	let projection = project(source, { iconSpace: true })
	expect(projection.text).toBe(
		`Intro\n${iconPrefix}Photo and ${iconPrefix}link\ntail`,
	)
	let label = source.indexOf("Photo"),
		view = projection.text.indexOf("Photo")
	for (let offset = 0; offset < 5; offset++) {
		expect(toSource(projection, view + offset)).toBe(label + offset)
		expect(toView(projection, label + offset)).toBe(view + offset)
	}
	let start = toSource(projection, projection.text.indexOf(iconPrefix)),
		end = toSource(projection, projection.text.indexOf(" and"), "end")
	expect(source.slice(start, end)).toBe("![Photo](asset:photo)")
	let typed = applyViewEdit(
		projection,
		projection.text.replace("Photo", "Ph日本oto"),
		view + 4,
	)
	expect(typed.source).toContain("![Ph日本oto](asset:photo)")
	expect(sameProjection(projection, project(source))).toBe(false)
})

test("deleting synthetic icon space removes its complete token without corrupting Markdown", () => {
	for (let token of [
		"![Photo](asset:photo)",
		"[link](https://example.org)",
		"[[doc-1]]",
	]) {
		let source = `Intro\n${token} end`,
			projection = project(source, { documents, iconSpace: true })
		let prefix = projection.text.indexOf(iconPrefix)
		for (let index = 0; index < iconPrefix.length; index++) {
			let next =
				projection.text.slice(0, prefix + index) +
				projection.text.slice(prefix + index + 1)
			expect(applyViewEdit(projection, next, prefix + index).source).toBe(
				"Intro\n end",
			)
		}
	}
})

test("composition insertions inside synthetic icon space preserve the token", () => {
	let source = "Intro\n![Photo](asset:photo) end",
		projection = project(source, { iconSpace: true })
	let offset = projection.text.indexOf(iconPrefix) + 1
	let next =
		projection.text.slice(0, offset) + "日本" + projection.text.slice(offset)
	expect(applyViewEdit(projection, next, offset + 2).source).toBe(
		"Intro\n日本![Photo](asset:photo) end",
	)
})
