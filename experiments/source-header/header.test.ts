import { expect, test } from "bun:test"
import * as Schema from "effect/Schema"
import {
	SourceHeader,
	HeaderChangeSchema,
	HeaderSnapshotSchema,
} from "./header"

function fork(initial: string) {
	let source = new SourceHeader()
	source.apply(source.change("0000000000000001:base", "", initial))
	return source
}
function roundtrip(source: SourceHeader) {
	let snapshot = Schema.decodeUnknownSync(HeaderSnapshotSchema)(
		JSON.parse(JSON.stringify(source.snapshot())),
	)
	let reopened = new SourceHeader()
	reopened.restore(snapshot)
	return reopened
}
test("comments and EOF changes do not resend unchanged peer entries", () => {
	for (let source of ["---\n# c\ntitle: T\n---\nBody", "---\ntitle: T\n---"]) {
		let a = fork(source),
			z = fork(source)
		let rename = a.change(
			"0000000000000002:b",
			source,
			source.replace("title: T", "title: Peer"),
		)
		let format = z.change(
			"0000000000000002:z",
			source,
			source.includes("# c") ? source.replace("# c", "# d") : source + "\n",
		)
		a.apply(rename)
		a.apply(format)
		z.apply(format)
		z.apply(rename)
		let body = source.endsWith("Body") ? "Body" : ""
		expect(a.source(body)).toBe(z.source(body))
		expect(a.source(body)).toContain("title: Peer")
		expect(roundtrip(a).source(body)).toBe(a.source(body))
	}
})
test("a slide separator in the body cannot become a header frame", () => {
	let source = fork("Body")
	source.apply(
		source.change("0000000000000002:a", "Body", "---\ntitle: X\n---\nBody"),
	)
	expect(source.source("---\nBody")).toBe("---\ntitle: X\n---\n---\nBody")
})
test("deletions outrank weak migrations regardless of the room clock", () => {
	let source = fork("---\ntitle: Old\n---\nBody")
	let explicit = source.change(
		"0000000000000002:a",
		source.source("Body"),
		"Body",
	)
	let legacy = source.change(
		"0000000000000009:z",
		"Body",
		"---\ntitle: Old\npinned: true\n---\nBody",
		true,
	)
	source.apply(explicit)
	source.apply(legacy)
	expect(source.source("Body")).toBe("Body")
	expect(roundtrip(source).source("Body")).toBe("Body")
})
test("500 metadata edits keep a bounded header snapshot", () => {
	let source = fork("---\ntitle: Initial\n---\nBody")
	for (let index = 0; index < 500; index++) {
		let previous = source.source("Body")
		let next = previous.replace(/^title:.*$/m, "title: Title " + index)
		let change = source.change(
			String(index + 2).padStart(16, "0") + ":a",
			previous,
			next,
		)
		source.apply(
			Schema.decodeUnknownSync(HeaderChangeSchema)(
				JSON.parse(JSON.stringify(change)),
			),
		)
	}
	expect(source.source("Body")).toContain("Title 499")
	expect(JSON.stringify(source.snapshot()).length).toBeLessThan(800)
})

test("quoted source keys cannot overwrite formatting registers", () => {
	let original = '---\n"@open": Custom\n"@close": Other\ntitle: T\n---\nBody'
	let source = fork(original)
	expect(source.source("Body")).toBe(original)
	source.apply(
		source.change(
			"0000000000000002:a",
			original,
			original.replace("Custom", "Updated"),
		),
	)
	expect(source.source("Body")).toContain('"@open": Updated')
})

test("an EOF preference cannot remove the boundary before a concurrent body", () => {
	let source = fork("---\ntitle: T\n---")
	expect(source.source("")).toBe("---\ntitle: T\n---")
	expect(source.source("Body")).toBe("---\ntitle: T\n---\nBody")
})

test("an unseen explicit key survives a concurrent header deletion", () => {
	let initial = "---\ntitle: T\n---\nBody"
	let source = fork(initial)
	let deleted = source.change("0000000000000002:z", initial, "Body")
	let pinned = source.change(
		"0000000000000002:a",
		initial,
		"---\ntitle: T\npinned: true\n---\nBody",
	)
	source.apply(deleted)
	source.apply(pinned)
	expect(source.source("Body")).toBe("---\npinned: true\n---\nBody")
})
