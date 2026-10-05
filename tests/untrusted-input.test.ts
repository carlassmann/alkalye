import { expect, test } from "bun:test"
import { Replica } from "../src/shared/crdt"
import { parseOperation, parseRole, parseRoom } from "../src/shared/model"

test("untrusted identifiers and workspace roles reject markup and unknown authority", () => {
	let replica = new Replica("writer")
	let before = replica.checkpoint()
	expect(() => replica.set('doc"><img src=x>', "title", "Title")).toThrow()
	expect(replica.checkpoint()).toEqual(before)
	let operation = replica.create("document", "set")
	expect(() =>
		parseOperation({
			...operation,
			target: 'doc"><img src=x>',
			field: "title",
			value: "Title",
		}),
	).toThrow()
	expect(() =>
		parseRoom({
			id: "<option selected>",
			key: "",
			read: "",
			write: "",
			admin: "",
			name: "",
			local: true,
		}),
	).toThrow()
	expect(() => parseRole("owner")).toThrow()
	expect(parseRole("manager")).toBe("manager")
})

test("templates escape text and attributes while allowing explicit markup", async () => {
	let { html, rawMarkup } = await import("../src/shared/html")
	let text = '\"><img src=x onerror=alert(1)>'
	expect(
		String(html`<button data-doc="${text}">${text}</button>`),
	).not.toContain("<img")
	expect(
		String(html`<div>${rawMarkup(html`<strong>${text}</strong>`)}</div>`),
	).toContain("<strong>&quot;&gt;&lt;img")
})
