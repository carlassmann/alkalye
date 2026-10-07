import { test, expect } from "bun:test"
import { TextIndex } from "./text-index"

test("UTF16 document replacement, slices and visual addressing survive mixed Unicode edits", () => {
	let source = "😀e\u0301 paragraph\n".repeat(4096)
	let index = new TextIndex(source)
	let random = 2147483647
	function next(limit: number) {
		random = (Math.imul(random, 1664525) + 1013904223) >>> 0
		return random % limit
	}
	for (let turn = 0; turn < 400; turn++) {
		let start = next(source.length + 1),
			end = Math.min(source.length, start + next(100))
		let insert =
			["😀", "e\u0301", "\n\n", "hello\nworld", "", "a".repeat(145)][next(6)] ??
			""
		index.replace({ start, end, insert })
		source = source.slice(0, start) + insert + source.slice(end)
		expect(index.value).toBe(source)
		expect(index.length).toBe(source.length)
		expect(index.newlines).toBe(source.split("\n").length - 1)
		expect(index.slice(start, Math.min(source.length, start + 300))).toBe(
			source.slice(start, start + 300),
		)
		let rows = source
			.split("\n")
			.flatMap(line =>
				Array.from(
					{ length: Math.max(1, Math.ceil(line.length / 72)) },
					(_, row) => row * 72,
				),
			)
		expect(index.rows).toBe(rows.length)
		let offset = 0,
			expected: number[] = []
		for (let line of source.split("\n")) {
			for (let row = 0; row < Math.max(1, Math.ceil(line.length / 72)); row++)
				expected.push(offset + row * 72)
			offset += line.length + 1
		}
		let row = next(expected.length)
		expect(index.offsetAtRow(row)).toBe(expected[row] ?? 0)
		expect(index.rowAt(expected[row] ?? 0)).toBe(row)
	}
})
test("Large single paragraphs remain indexed through boundaries, complete deletion and reconstruction", () => {
	let index = new TextIndex("a".repeat(1048576))
	expect(index.offsetAtRow(10000)).toBe(720000)
	index.replace({ start: 524288, end: 524288, insert: "😀\n" })
	expect(index.newlines).toBe(1)
	expect(index.slice(524288, 524291)).toBe("😀\n")
	index.replace({ start: 0, end: index.length, insert: "" })
	expect(index.value).toBe("")
	expect(index.rows).toBe(1)
	index.replace({ start: 0, end: 0, insert: "x".repeat(72) + "\nnext" })
	expect(index.offsetAtRow(1)).toBe(73)
	expect(index.rowAt(72)).toBe(0)
})

test("Indexed grapheme boundaries span leaf splits and oversized combining clusters", () => {
	let source = "a" + "\u0301".repeat(4096) + "😀\r\nnext"
	let index = new TextIndex(source)
	expect(index.nextGrapheme(0)).toBe(4097)
	expect(index.previousGrapheme(4097)).toBe(0)
	expect(index.nextGrapheme(4097)).toBe(4099)
	expect(index.previousGrapheme(4099)).toBe(4097)
	expect(index.nextGrapheme(4099)).toBe(4101)
})
