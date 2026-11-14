import { expect, test } from "vitest"
import { queryValuesEqual } from "./use-stable-rows"

test("retains equivalent projections and distinguishes changed or removed fields", () => {
	function row() {
		return {
			id: "1",
			title: "same",
			date: new Date(42),
			tags: ["a"],
			bytes: new Uint8Array([1, 2]),
			count: 42n,
		}
	}
	expect(queryValuesEqual([row()], [row()])).toBe(true)
	expect(queryValuesEqual([row()], [{ ...row(), title: "changed" }])).toBe(
		false,
	)
	expect(queryValuesEqual([row()], [])).toBe(false)
	expect(queryValuesEqual([row()], [{ ...row(), date: new Date(43) }])).toBe(
		false,
	)
	expect(
		queryValuesEqual([row()], [{ ...row(), bytes: new Uint8Array([1]) }]),
	).toBe(false)
	expect(queryValuesEqual([row()], [{ ...row(), tags: ["b"] }])).toBe(false)
	expect(queryValuesEqual({ missing: undefined }, {})).toBe(false)
	expect(queryValuesEqual(null, [])).toBe(false)
})
