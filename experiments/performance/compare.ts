import * as Schema from "effect/Schema"

let Fixture = Schema.Struct({
	kb: Schema.Number,
	title: Schema.String,
	path: Schema.String,
})
let Configuration = Schema.Struct({
	kind: Schema.Literals(["original", "rewrite"]),
	session: Schema.String,
	url: Schema.String,
	docs: Schema.Array(Fixture),
})
let Envelope = Schema.Struct({
	success: Schema.Boolean,
	data: Schema.optional(
		Schema.Struct({ result: Schema.optional(Schema.Unknown) }),
	),
})
let Sample = Schema.Struct({
	ms: Schema.optional(Schema.Number),
	error: Schema.optional(Schema.String),
	animationWork: Schema.optional(
		Schema.Array(
			Schema.Struct({
				start: Schema.Number,
				frame: Schema.Number,
				duration: Schema.Number,
			}),
		),
	),
})
type Configuration = typeof Configuration.Type
type Fixture = typeof Fixture.Type
interface Measurement {
	version: Configuration["kind"]
	name: string
	kb: number
	values: number[]
	medianMs: number
	p95Ms: number
	minMs: number
	maxMs: number
	maxFrameCallbackWorkMs?: number[]
	nativeInputMs?: number[]
}

let configurationPath = process.argv[2]
let outputPath = process.argv[3]
let reloadSamples = sampleCount(Bun.env.BENCHMARK_RELOAD_SAMPLES, 9)
let inputSamples = sampleCount(Bun.env.BENCHMARK_INPUT_SAMPLES, 12)
if (!configurationPath || !outputPath)
	throw Error(
		"Usage: bun experiments/performance/compare.ts CONFIG.json RESULTS.json",
	)
let configurations = Schema.decodeUnknownSync(Schema.Array(Configuration))(
	await Bun.file(configurationPath).json(),
)
let results: Measurement[] = []
let failures: { version: string; kb: number; error: string }[] = []

for (let kb of [
	...new Set(
		configurations.flatMap(configuration =>
			configuration.docs.map(fixture => fixture.kb),
		),
	),
]) {
	for (let configuration of kb === 32 || kb === 1024
		? configurations.slice().reverse()
		: configurations) {
		let fixture = configuration.docs.find(fixture => fixture.kb === kb)
		if (!fixture) continue
		browser(configuration, "set", "viewport", "1280", "900")
		try {
			measureReload(configuration, fixture)
			measureTyping(configuration, fixture, "end")
			if (fixture.kb >= 32) {
				measureTyping(configuration, fixture, "start")
				measureTyping(configuration, fixture, "middle")
			}
		} catch (error) {
			failures.push({
				version: configuration.kind,
				kb: fixture.kb,
				error: String(error),
			})
		}
		await Bun.write(outputPath, JSON.stringify({ results, failures }, null, 2))
	}
}

function measureReload(configuration: Configuration, fixture: Fixture) {
	evaluate(
		configuration,
		`localStorage.setItem('__benchmarkExpected',${JSON.stringify(fixture.title)})`,
	)
	browser(configuration, "open", configuration.url + fixture.path)
	wait(configuration, "window.__benchmark.readyMs!==null")
	browser(configuration, "reload")
	wait(configuration, "window.__benchmark.readyMs!==null")
	let values: number[] = []
	for (let iteration = 0; iteration < reloadSamples; iteration++) {
		browser(configuration, "reload")
		wait(configuration, "window.__benchmark.readyMs!==null")
		if (
			evaluate(configuration, "!!navigator.serviceWorker.controller") !== true
		)
			throw Error("The PWA service worker must control this page")
		values.push(number(configuration, "window.__benchmark.readyMs"))
	}
	collect(configuration, fixture, "warm document reload", values)
	evaluate(configuration, "localStorage.removeItem('__benchmarkExpected')")
}

function measureTyping(
	configuration: Configuration,
	fixture: Fixture,
	location: "start" | "middle" | "end",
) {
	let values: number[] = []
	let maxFrameCallbackWorkMs: number[] = []
	let nativeInputMs: number[] = []
	for (let iteration = 0; iteration < inputSamples; iteration++) {
		focusPosition(configuration, location)
		let marker = ` perf${location}${fixture.kb}_${iteration}`
		let before = number(configuration, `${source(configuration)}.length`)
		evaluate(
			configuration,
			`window.__benchmark.armJourney('typing',()=>(${source(configuration)}.length===${before + marker.length}));true`,
		)
		evaluate(
			configuration,
			"(()=>{window.__benchmarkNativeMs=null;let started;document.addEventListener('beforeinput',()=>started=performance.now(),{once:true,capture:true});document.addEventListener('input',()=>window.__benchmarkNativeMs=performance.now()-started,{once:true});return true})()",
		)
		browser(configuration, "keyboard", "inserttext", marker)
		wait(configuration, "window.__benchmark.arm===null")
		let sample = Schema.decodeUnknownSync(Sample)(
			evaluate(configuration, "window.__benchmark.samples.at(-1)"),
		)
		if (sample.error || sample.ms === undefined)
			throw Error(sample.error ?? "Missing input measurement")
		values.push(sample.ms)
		nativeInputMs.push(number(configuration, "window.__benchmarkNativeMs"))
		let frames = new Map<number, number>()
		for (let callback of sample.animationWork ?? [])
			frames.set(
				callback.frame,
				(frames.get(callback.frame) ?? 0) + callback.duration,
			)
		if (frames.size) maxFrameCallbackWorkMs.push(Math.max(...frames.values()))
		wait(
			configuration,
			configuration.kind === "original"
				? `window.__benchmark.lastSaved?.content?.includes(${JSON.stringify(marker)})`
				: `document.querySelector('#save-status')?.getAttribute('aria-busy')==='false' && document.querySelector('#save-status')?.dataset.pending==='0'`,
		)
	}
	collect(
		configuration,
		fixture,
		location === "end"
			? "insert text to paint opportunity"
			: `insert at ${location} to paint opportunity`,
		values,
		{
			maxFrameCallbackWorkMs,
			nativeInputMs,
		},
	)
}

function sampleCount(value: string | undefined, fallback: number) {
	let count = value === undefined ? fallback : Number(value)
	if (!Number.isInteger(count) || count < 3 || count > 30)
		throw Error("Benchmark sample count must be an integer from 3 to 30")
	return count
}

function collect(
	configuration: Configuration,
	fixture: Fixture,
	name: string,
	values: number[],
	work: { maxFrameCallbackWorkMs?: number[]; nativeInputMs?: number[] } = {},
) {
	let sorted = [...values].sort((left, right) => left - right)
	let lower = sorted[Math.floor((sorted.length - 1) / 2)]
	let upper = sorted[Math.floor(sorted.length / 2)]
	let medianMs =
		lower === undefined || upper === undefined ? undefined : (lower + upper) / 2
	let minMs = sorted[0]
	let maxMs = sorted.at(-1)
	if (medianMs === undefined || minMs === undefined || maxMs === undefined)
		throw Error("No timing samples")
	let measurement = {
		version: configuration.kind,
		name,
		kb: fixture.kb,
		values,
		p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1] ?? maxMs,
		medianMs,
		minMs,
		maxMs,
		...work,
	}
	results.push(measurement)
	console.log(JSON.stringify(measurement))
}

function focusPosition(
	configuration: Configuration,
	location: "start" | "middle" | "end",
) {
	let offset =
		location === "end"
			? `${source(configuration)}.length`
			: location === "middle"
				? `Math.floor(${source(configuration)}.length/2)`
				: `${source(configuration)}.indexOf(String.fromCharCode(10,10))+2`
	evaluate(
		configuration,
		configuration.kind === "original"
			? `(()=>{let view=document.querySelector('.cm-content').cmTile.view;view.dispatch({selection:{anchor:${offset}}});view.focus()})()`
			: `(()=>{let editor=document.querySelector('alkalye-editor').source;editor.setSelectionRange(${offset},${offset});editor.focus()})()`,
	)
}

function source(configuration: Configuration) {
	return configuration.kind === "original"
		? "document.querySelector('.cm-content')?.cmTile?.view?.state.doc.toString()"
		: "document.querySelector('alkalye-editor')?.source.value"
}

function number(configuration: Configuration, expression: string) {
	return Schema.decodeUnknownSync(Schema.Number)(
		evaluate(configuration, expression),
	)
}

function wait(configuration: Configuration, condition: string) {
	browser(configuration, "wait", "--fn", condition)
}

function evaluate(configuration: Configuration, expression: string) {
	return browser(configuration, "eval", expression)
}

function browser(configuration: Configuration, ...arguments_: string[]) {
	let process = Bun.spawnSync(
		[
			"agent-browser",
			"--session",
			configuration.session,
			"--json",
			...arguments_,
		],
		{
			env: {
				...Bun.env,
				AGENT_BROWSER_HEADED: "false",
				AGENT_BROWSER_DEFAULT_TIMEOUT: "20000",
			},
			timeout: 60_000,
			stdout: "pipe",
			stderr: "pipe",
		},
	)
	if (process.exitCode !== 0)
		throw Error(
			`${configuration.kind} ${arguments_[0]} failed: ${process.stderr.toString() || process.stdout.toString()}`,
		)
	let response: unknown = JSON.parse(process.stdout.toString())
	let envelope = Schema.decodeUnknownSync(Envelope)(response)
	if (!envelope.success)
		throw Error(`${configuration.kind} browser command failed`)
	return envelope.data?.result
}
