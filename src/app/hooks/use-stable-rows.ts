import { useState } from "react"
import { useAll } from "jazz-tools/react"
import type { QueryBuilder } from "jazz-tools/shared"

export { useStableRows, queryValuesEqual }

function useStableRows<T extends { id: string }>(query: QueryBuilder<T>) {
	let result = useAll(query)
	let [snapshot, setSnapshot] = useState(result)
	if (
		snapshot.db !== result.db ||
		snapshot.isLoading !== result.isLoading ||
		snapshot.error !== result.error ||
		!queryValuesEqual(snapshot.data, result.data)
	) {
		setSnapshot(result)
		return result
	}
	return snapshot
}

// Stock alpha.61 can invalidate a row whose selected columns did not change.
function queryValuesEqual(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true
	if (
		left === null ||
		right === null ||
		typeof left !== "object" ||
		typeof right !== "object"
	)
		return false
	if (left instanceof Date && right instanceof Date)
		return Object.is(left.getTime(), right.getTime())
	if (left instanceof Uint8Array && right instanceof Uint8Array)
		return (
			left.length === right.length &&
			left.every((byte, index) => byte === right[index])
		)
	if (Array.isArray(left) !== Array.isArray(right)) return false
	if (
		Array.isArray(left) &&
		Array.isArray(right) &&
		left.length !== right.length
	)
		return false
	let prototype = Object.getPrototypeOf(left)
	if (prototype !== Object.getPrototypeOf(right)) return false
	if (
		!Array.isArray(left) &&
		prototype !== Object.prototype &&
		prototype !== null
	)
		return false
	let keys = Object.keys(left)
	return (
		keys.length === Object.keys(right).length &&
		keys.every(
			key =>
				Object.hasOwn(right, key) &&
				queryValuesEqual(Reflect.get(left, key), Reflect.get(right, key)),
		)
	)
}
