import * as Schema from "effect/Schema"
let traceSchema = Schema.Struct({
	traceEvents: Schema.Array(
		Schema.Struct({
			name: Schema.String,
			ts: Schema.Number,
			dur: Schema.optional(Schema.Number),
			args: Schema.optional(
				Schema.Struct({
					data: Schema.optional(
						Schema.Struct({ type: Schema.optional(Schema.String) }),
					),
				}),
			),
		}),
	),
})
let session = "viewport-native-trace"
function browser(...args: string[]) {
	let process = Bun.spawnSync(
		["agent-browser", "--session", session, "--json", ...args],
		{ env: { ...Bun.env, AGENT_BROWSER_HEADED: "false" }, timeout: 60000 },
	)
	let response = JSON.parse(process.stdout.toString())
	if (!response.success) throw Error(process.stdout.toString())
	return response.data.result
}
let results = []
try {
	for (let size of [131072, 1048576])
		for (let mode of ["bare", "bounded"]) {
			browser(
				"open",
				`http://127.0.0.1:4331/?size=${size}&fixture=long&mode=${mode}`,
			)
			browser("wait", "--fn", "Boolean(window.viewportExperiment)")
			browser(
				"eval",
				`window.viewportExperiment.select(${size >>> 1});window.viewportExperiment.samples.length=0`,
			)
			browser("trace", "start")
			browser("keyboard", "inserttext", "trace")
			browser(
				"wait",
				"--fn",
				"window.viewportExperiment.samples.some(sample=>sample.kind==='insertText'&&sample.frame>0)",
			)
			let path = `/tmp/alkalye-viewport-${size}-${mode}-trace.json`
			browser("trace", "stop", path)
			let file = Schema.decodeUnknownSync(traceSchema)(
				await Bun.file(path).json(),
			)
			let events = file.traceEvents
			let start = events.find(
				event =>
					event.name === "EventDispatch" &&
					event.args?.data?.type === "beforeinput",
			)?.ts
			let groups: Record<
				string,
				{ count: number; total: number; max: number }
			> = {}
			for (let event of events) {
				if (
					!start ||
					event.ts < start ||
					event.ts > start + 100000 ||
					!event.dur ||
					![
						"Layout",
						"UpdateLayoutTree",
						"Paint",
						"EventDispatch",
						"FireAnimationFrame",
					].includes(event.name)
				)
					continue
				let group = (groups[event.name] ??= { count: 0, total: 0, max: 0 })
				group.count++
				group.total += event.dur / 1000
				group.max = Math.max(group.max, event.dur / 1000)
			}
			let result = { size, mode, groups, path }
			results.push(result)
			await Bun.write(
				import.meta.dir + "/trace-results.json",
				JSON.stringify(results, null, 2) + "\n",
			)
			console.log(JSON.stringify(result))
		}
} finally {
	browser("close")
}
