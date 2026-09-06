import { describe, expect, it } from "vitest"
import { getLeadingIndentColumns, getWrapIndentColumns } from "./wrapped-indent"

describe("getLeadingIndentColumns", () => {
	it("counts leading spaces", () => {
		let columns = getLeadingIndentColumns("    hello", 4)
		expect(columns).toBe(4)
	})

	it("counts leading tabs using tab size", () => {
		let columns = getLeadingIndentColumns("\thello", 4)
		expect(columns).toBe(4)
	})

	it("handles mixed spaces and tabs", () => {
		let columns = getLeadingIndentColumns("  \thello", 4)
		expect(columns).toBe(4)
	})

	it("stops at first non-whitespace character", () => {
		let columns = getLeadingIndentColumns("  \t  hello", 4)
		expect(columns).toBe(6)
	})

	it("returns zero for non-indented lines", () => {
		let columns = getLeadingIndentColumns("hello", 4)
		expect(columns).toBe(0)
	})
})

describe("getWrapIndentColumns", () => {
	it("keeps normal indentation for plain text", () => {
		let columns = getWrapIndentColumns("    hello", 4)
		expect(columns).toBe(4)
	})

	it("aligns unordered list continuation with list text", () => {
		let columns = getWrapIndentColumns("  - hello world", 4)
		expect(columns).toBe(4)
	})

	it("aligns task list continuation with task text", () => {
		let columns = getWrapIndentColumns("  - [ ] hello world", 4)
		expect(columns).toBe(8)
	})

	it("aligns custom task states with task text", () => {
		let columns = getWrapIndentColumns("  - [-] dismissed task", 4)
		expect(columns).toBe(8)
	})

	it("aligns ordered list continuation with list text", () => {
		let columns = getWrapIndentColumns("  12. hello world", 4)
		expect(columns).toBe(6)
	})

	it("handles tabs for list prefixes", () => {
		let columns = getWrapIndentColumns("\t- [x] hello world", 4)
		expect(columns).toBe(10)
	})
})
