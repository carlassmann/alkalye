import { expect, test } from "bun:test"
import { SourceReplica } from "./replica"
import { setSourceField } from "./actions"
import { frontmatter } from "../../src/shared/markdown"
function fork(source: SourceReplica, actor: string) {
	let peer = new SourceReplica(actor)
	peer.restore(source.snapshot())
	return peer
}
function merge(a: SourceReplica, b: SourceReplica) {
	a.restore(b.snapshot())
	b.restore(a.snapshot())
	expect(a.text()).toBe(b.text())
}

test("source slot replacements collapse identical booleans without changing comments", () => {
	let base = new SourceReplica("base")
	base.edit("---\npinned: false # Retain\n---\nBody")
	let a = fork(base, "a"),
		b = fork(base, "b")
	setSourceField(a, "pinned", true)
	setSourceField(b, "pinned", true)
	merge(a, b)
	expect(frontmatter(a.text()).data.pinned).toBe(true)
	expect(a.text()).toContain("# Retain")
})
test("source slot ancestry resolves concurrent branches after a dependent edit", () => {
	let base = new SourceReplica("base")
	base.edit("---\ntitle: Base\n---\nBody")
	for (let highClock of [false, true]) {
		let a = fork(base, "a"),
			b = fork(base, "z")
		setSourceField(a, "title", "Alpha")
		let c = fork(a, "c")
		setSourceField(c, "title", "Charlie")
		if (highClock) for (let step = 0; step < 5; step++) b.edit(b.text() + " ")
		setSourceField(b, "title", "Bravo")
		merge(b, c)
		expect(frontmatter(b.text()).data.title).toBe(
			highClock ? "Bravo" : "Charlie",
		)
	}
})
test("independent metadata actions create one shared header over an untouched body", () => {
	let base = new SourceReplica("base")
	base.edit("Body")
	let a = fork(base, "a"),
		b = fork(base, "b")
	setSourceField(a, "title", "X")
	setSourceField(b, "pinned", true)
	merge(a, b)
	expect(frontmatter(a.text()).data).toEqual({ title: "X", pinned: true })
	expect(frontmatter(a.text()).body).toBe("Body")
	expect(a.text().match(/^---$/gm)).toHaveLength(2)
})
test("shared fences keep a concurrent body separator outside the header", () => {
	let base = new SourceReplica("base")
	base.edit("Body")
	let a = fork(base, "a"),
		b = fork(base, "z")
	setSourceField(a, "title", "X")
	b.edit("---\nBody")
	merge(a, b)
	expect(frontmatter(a.text()).data.title).toBe("X")
	expect(frontmatter(a.text()).body).toBe("---\nBody")
})
test("metadata slot updates preserve scalar anchors and alias references", () => {
	let source = new SourceReplica("a")
	source.edit('---\ntitle: &n "Old" # Retain\nalias: *n\n---\nBody')
	setSourceField(source, "title", "New")
	expect(frontmatter(source.text()).data).toMatchObject({
		title: "New",
		alias: "New",
	})
	expect(source.text()).toContain("# Retain")
})
