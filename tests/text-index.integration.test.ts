import { expect, test } from "bun:test"
import { TextIndex } from "../src/shared/text-index"

test("document text index preserves Unicode patches and logical line addressing", () => {
	let source = "😀e\u0301 paragraph\n".repeat(4096)
	let index = new TextIndex(source)
	let random = 2147483647
	function next(limit: number) {
		random = (Math.imul(random, 1664525) + 1013904223) >>> 0
		return random % limit
	}
	for (let turn = 0; turn < 400; turn++) {
		let start = next(source.length + 1)
		let end = Math.min(source.length, start + next(100))
		let insert =
			["😀", "e\u0301", "\n\n", "hello\nworld", "", "a".repeat(145)][next(6)] ??
			""
		index.replace({ start, end, insert })
		source = source.slice(0, start) + insert + source.slice(end)
		expect(index.value).toBe(source)
		expect(index.length).toBe(source.length)
		expect(index.codePoints).toBe(Array.from(source).length)
		expect(index.codePointOffset(start)).toBe(
			Array.from(source.slice(0, start)).length,
		)
		let codePoint = Math.floor(index.codePoints / 2)
		let boundary = Array.from(source).slice(0, codePoint).join("").length
		expect(index.offsetAtCodePoint(codePoint)).toBe(boundary)
		expect(index.slice(start, start + 300)).toBe(
			source.slice(start, start + 300),
		)
		let lines = source.split("\n")
		expect(index.newlines).toBe(lines.length - 1)
		let line = next(lines.length)
		let offset = lines
			.slice(0, line)
			.reduce((total, part) => total + part.length + 1, 0)
		expect(index.offsetAtLine(line)).toBe(offset)
		expect(index.lineAt(offset)).toBe(line)
		expect(index.lineAt(start)).toBe(
			source.slice(0, start).split("\n").length - 1,
		)
	}
})

test("large document index supports complete replacement and graphemes crossing storage boundaries", () => {
	let index = new TextIndex("a".repeat(1048576))
	index.replace({ start: 524288, end: 524288, insert: "😀\n" })
	expect(index.offsetAtLine(1)).toBe(524291)
	expect(index.slice(524288, 524291)).toBe("😀\n")
	index.replace({
		start: 0,
		end: index.length,
		insert: "a" + "\u0301".repeat(4096) + "😀\r\nnext",
	})
	expect(index.nextGrapheme(0)).toBe(4097)
	expect(index.previousGrapheme(4097)).toBe(0)
	expect(index.nextGrapheme(4097)).toBe(4099)
	expect(index.previousGrapheme(4099)).toBe(4097)
	expect(index.nextGrapheme(4099)).toBe(4101)
	index.replace({ start: 0, end: index.length, insert: "" })
	expect(index.value).toBe("")
	expect(index.offsetAtLine(0)).toBe(0)
	expect(index.newlines).toBe(0)
})
