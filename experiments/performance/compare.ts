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
})
type Configuration = typeof Configuration.Type
type Fixture = typeof Fixture.Type
interface Measurement {
	version: Configuration["kind"]
	name: string
	kb: number
	values: number[]
	medianMs: number
	minMs: number
	maxMs: number
}

let configurationPath = process.argv[2]
let outputPath = process.argv[3]
if (!configurationPath || !outputPath)
	throw Error(
		"Usage: bun experiments/performance/compare.ts CONFIG.json RESULTS.json",
	)
let configurations = Schema.decodeUnknownSync(Schema.Array(Configuration))(
	await Bun.file(configurationPath).json(),
)
let results: Measurement[] = []
let failures: { version: string; kb: number; error: string }[] = []

for (let configuration of configurations) {
	browser(configuration, "set", "viewport", "1280", "900")
	for (let fixture of configuration.docs) {
		try {
			measureReload(configuration, fixture)
			measureTyping(configuration, fixture)
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
	let values: number[] = []
	for (let iteration = 0; iteration < 9; iteration++) {
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

function measureTyping(configuration: Configuration, fixture: Fixture) {
	let values: number[] = []
	for (let iteration = 0; iteration < 12; iteration++) {
		focusEnd(configuration)
		let marker = ` perf${fixture.kb}_${iteration}`
		let before = number(configuration, `${source(configuration)}.length`)
		evaluate(
			configuration,
			`window.__benchmark.armJourney('typing',()=>(${source(configuration)}.length===${before + marker.length}));true`,
		)
		browser(configuration, "keyboard", "inserttext", marker)
		wait(configuration, "window.__benchmark.arm===null")
		let sample = Schema.decodeUnknownSync(Sample)(
			evaluate(configuration, "window.__benchmark.samples.at(-1)"),
		)
		if (sample.error || sample.ms === undefined)
			throw Error(sample.error ?? "Missing input measurement")
		values.push(sample.ms)
		wait(
			configuration,
			configuration.kind === "original"
				? `window.__benchmark.lastSaved?.content?.endsWith(${JSON.stringify(marker)})`
				: `document.querySelector('#save-status')?.getAttribute('aria-busy')==='false' && document.querySelector('#save-status')?.dataset.pending==='0'`,
		)
	}
	collect(configuration, fixture, "insert text to paint opportunity", values)
}

function collect(
	configuration: Configuration,
	fixture: Fixture,
	name: string,
	values: number[],
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
		medianMs,
		minMs,
		maxMs,
	}
	results.push(measurement)
	console.log(JSON.stringify(measurement))
}

function focusEnd(configuration: Configuration) {
	evaluate(
		configuration,
		configuration.kind === "original"
			? `(()=>{let view=document.querySelector('.cm-content').cmTile.view;view.dispatch({selection:{anchor:view.state.doc.length}});view.focus()})()`
			: `(()=>{let editor=document.querySelector('alkalye-editor').source;editor.setSelectionRange(editor.value.length,editor.value.length);editor.focus()})()`,
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
				AGENT_BROWSER_DEFAULT_TIMEOUT: "30000",
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
