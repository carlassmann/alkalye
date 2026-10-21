import { co } from "jazz-tools"
import { createJazzTestAccount } from "jazz-tools/testing"

let kilobytes = Number(process.argv[2] ?? 1024)
if (!Number.isInteger(kilobytes) || kilobytes < 1)
	throw new Error("Usage: bun experiments/performance/jazz-text-repro.ts [KiB]")

let account = await createJazzTestAccount({ isCurrentActiveAccount: true })
let text = co.plainText().create("x".repeat(kilobytes * 1024), account)
let position = Math.floor((kilobytes * 1024) / 2)
let operations = [
	{
		name: "insertBefore",
		apply() {
			text.insertBefore(position, "x")
		},
	},
	{
		name: "insertAfter",
		apply() {
			text.insertAfter(position, "x")
		},
	},
	{
		name: "rawInsertBefore",
		apply() {
			text.$jazz.raw.insertBefore(position, "x")
		},
	},
	{
		name: "applyDiff",
		apply() {
			let before = text.toString()
			text.$jazz.applyDiff(
				before.slice(0, position) + "x" + before.slice(position),
			)
		},
	},
]

for (let subscribed of [false, true]) {
	let notifications = 0
	let stop = subscribed ? text.$jazz.subscribe(() => notifications++) : () => {}
	for (let operation of operations) {
		let mutations: number[] = []
		let reads: number[] = []
		text.toString()
		for (let run = 0; run < 3; run++) {
			let start = performance.now()
			operation.apply()
			mutations.push(performance.now() - start)
			start = performance.now()
			text.toString()
			reads.push(performance.now() - start)
		}
		console.log(
			JSON.stringify({
				kilobytes,
				subscribed,
				operation: operation.name,
				mutationMedianMs: median(mutations),
				readMedianMs: median(reads),
				notifications,
			}),
		)
	}
	stop()
}

function median(values: number[]) {
	return [...values].sort((left, right) => left - right)[1]
}
