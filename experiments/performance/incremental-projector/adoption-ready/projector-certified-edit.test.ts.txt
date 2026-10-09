import { expect, test } from "bun:test"
import { Projector, project, toSource, toView } from "../src/shared/projection"
import type { DocumentLink } from "../src/shared/model"

let documents: DocumentLink[] = [
	{ id: "board", title: "Whiteboard", archived: false },
	{ id: "note", title: "Renamed document", archived: false },
]

test("certified edits preserve canonical projections across Unicode and Markdown contexts", () => {
	for (let separator of ["\n", "\r\n"]) {
		for (let body of [
			"Plain checkpoint text",
			"  - List item",
			"    Literal body",
			"Emoji 😀é lone\ud800",
		]) {
			for (let prefix of [
				"# Heading",
				"---\ntitle: Demo\n---",
				"~~~js",
				"```\nLiteral fence body\n```",
				"[before](https://example.com)",
			]) {
				{
					let source = [
						prefix.replaceAll("\n", separator),
						body,
						"[after](https://example.org) [[board]] ![image](asset:photo)",
					].join(separator)
					let bodyStart = source.indexOf(body),
						bodyEnd = bodyStart + body.length
					let start = bodyStart + Math.min(7, body.length)
					let projector = new Projector()
					let previous = projector.project(source, {
						documents,
						active: { start, end: start },
						iconSpace: true,
					})
					for (let insert of ["x", "😀", "\r", ""]) {
						let end = Math.min(start + 1, bodyEnd)
						let next = source.slice(0, start) + insert + source.slice(end)
						let active = {
							start: start + insert.length,
							end: start + insert.length,
						}
						let certified = projector.replace(previous, start, end, insert, {
							documents,
							active,
							iconSpace: true,
						})
						expect(certified).toBeDefined()
						expect(certified).toEqual(
							project(next, { documents, active, iconSpace: true }),
						)
						if (!certified) throw new Error("Expected certified edit")
						expect(toSource(certified, toView(certified, active.start))).toBe(
							active.start,
						)
						expect(
							projector.project(next, { documents, active, iconSpace: true }),
						).toEqual(certified)
						bodyEnd += insert.length - (end - start)
						source = next
						previous = certified
					}
				}
			}
		}
	}
})

test("syntax changes fall back to canonical projection", () => {
	for (let replacement of [
		"[new](https://example.com)",
		"[[note]]",
		"![media](asset:photo)",
		"\n",
		"~~~",
		"---",
		"...",
	]) {
		{
			let source = "# Heading\nplain\n[after](https://example.com)"
			let start = source.indexOf("plain"),
				end = start + 5
			let projector = new Projector()
			let previous = projector.project(source, {
				documents,
				active: { start, end },
				iconSpace: true,
			})
			expect(
				projector.replace(previous, start, end, replacement, {
					documents,
					active: { start, end: start },
					iconSpace: true,
				}),
			).toBeUndefined()
			let next = source.slice(0, start) + replacement + source.slice(end)
			expect(
				projector.project(next, {
					documents,
					active: { start, end: start },
					iconSpace: true,
				}),
			).toEqual(
				project(next, {
					documents,
					active: { start, end: start },
					iconSpace: true,
				}),
			)
		}
	}
})

test("sequential linked-line edits preserve cache ownership, mapped tokens and option guards", () => {
	{
		let source = "# Heading\nplain\n[[note]]"
		let start = source.indexOf("plain"),
			end = start + 1
		let projector = new Projector()
		let token = source.indexOf("[[")
		let previous = projector.project(source, {
			documents,
			active: { start: token, end: token },
			iconSpace: true,
		})
		expect(
			projector.replace(previous, start, end, "x", {
				documents,
				active: { start, end: start },
				iconSpace: true,
			}),
		).toBeUndefined()
		previous = projector.project(source, {
			documents,
			active: { start, end: start },
			iconSpace: true,
		})
		expect(
			projector.replace(previous, start, end, "x", {
				documents,
				active: { start: token, end: token },
				iconSpace: true,
			}),
		).toBeUndefined()
		expect(
			projector.replace(previous, 1, 1, "x", { documents, iconSpace: true }),
		).toBeUndefined()
		expect(
			projector.replace(
				{ ...previous, source: source + "stale" },
				start,
				end,
				"x",
				{ documents, iconSpace: true },
			),
		).toBeUndefined()
		let renamed = documents.map(document => ({
			...document,
			title: document.title + " renamed",
		}))
		expect(
			projector.replace(previous, start, end, "x", {
				documents: renamed,
				iconSpace: true,
			}),
		).toBeUndefined()
		expect(
			projector.project(source, { documents: renamed, iconSpace: true }),
		).toEqual(project(source, { documents: renamed, iconSpace: true }))
	}

	{
		let source = "# Heading\nplain\n[after](https://example.com)"
		let start = source.indexOf("plain"),
			end = start + 1
		let projector = new Projector()
		let previous = projector.project(source, { iconSpace: true })
		previous.links.length = 0
		let certified = projector.replace(previous, start, end, "x", {
			iconSpace: true,
		})
		expect(certified).toEqual(
			project(source.slice(0, start) + "x" + source.slice(end), {
				iconSpace: true,
			}),
		)
		previous = projector.project(source, { iconSpace: true })
		previous.text += "tampered"
		expect(
			projector.replace(previous, start, end, "x", { iconSpace: true }),
		).toBeUndefined()
	}

	{
		let source =
			"# Heading\nA responsiveness fixture with **bold words**, ==highlight== and [a reference](https://example.com).\n[[note]] ![media](asset:photo)"
		let start = source.indexOf("highlight") + 3
		let projector = new Projector()
		let previous = projector.project(source, {
			documents,
			active: { start, end: start },
			iconSpace: true,
		})
		for (let insert of ["x", "😀", "", "\\"]) {
			let end = start + 1,
				next = source.slice(0, start) + insert + source.slice(end)
			let active = { start: start + insert.length, end: start + insert.length }
			let certified = projector.replace(previous, start, end, insert, {
				documents,
				active,
				iconSpace: true,
			})
			expect(certified).toBeDefined()
			expect(certified).toEqual(
				project(next, { documents, active, iconSpace: true }),
			)
			if (!certified) throw new Error("Expected unchanged linked paragraph")
			source = next
			previous = certified
		}
	}
})
