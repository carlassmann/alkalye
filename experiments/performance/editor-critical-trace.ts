import * as Schema from "effect/Schema"
import { object } from "../../src/shared/model"

let input = Bun.argv[2],
	output = Bun.argv[3]
if (!input || !output) throw new Error("Results and summary paths required")
let results = object(await Bun.file(input).json())
let rows = []
for (let row of Schema.decodeUnknownSync(Schema.Array(Schema.Unknown))(
	results.results,
)) {
	let result = object(row)
	if (typeof result.tracePath !== "string") throw new Error("Missing trace")
	let trace = object(await Bun.file(result.tracePath).json())
	let events = Schema.decodeUnknownSync(Schema.Array(Schema.Unknown))(
		trace.traceEvents,
	).map(object)
	let phases = []
	for (let phase of Schema.decodeUnknownSync(Schema.Array(Schema.Unknown))(
		result.phases,
	)) {
		let name = object(phase).name
		let start = events.find(event => event.name === `critical:${name}:start`)
		let end = events.find(event => event.name === `critical:${name}:end`)
		if (
			!start ||
			!end ||
			typeof start.ts !== "number" ||
			typeof end.ts !== "number"
		)
			throw new Error("Missing phase markers")
		let beginning = start.ts,
			ending = end.ts
		let tasks = events.filter(
			event =>
				event.name === "RunTask" &&
				event.ph === "X" &&
				event.pid === start.pid &&
				event.tid === start.tid &&
				typeof event.ts === "number" &&
				typeof event.dur === "number" &&
				event.ts <= ending &&
				event.ts + event.dur >= beginning,
		)
		let durations = tasks
			.map(task => (typeof task.dur === "number" ? task.dur / 1000 : 0))
			.sort((left, right) => left - right)
		let largest = Math.max(0, ...durations)
		let inputTask = tasks.find(
			task =>
				typeof task.ts === "number" &&
				typeof task.dur === "number" &&
				task.ts <= beginning &&
				task.ts + task.dur >= beginning,
		)
		phases.push({
			name,
			largestTaskMs: largest,
			inputTaskMs:
				typeof inputTask?.dur === "number" ? inputTask.dur / 1000 : null,
			tasksOverBudget: durations.filter(duration => duration > 1000 / 120)
				.length,
			taskCount: durations.length,
		})
	}
	rows.push({
		fixture: result.fixture,
		trial: result.trial,
		phases,
		correctness: result.correctness,
		undoExact: result.undoExact,
	})
}
await Bun.write(
	output,
	JSON.stringify({ rows, failures: results.failures }, null, 2),
)
