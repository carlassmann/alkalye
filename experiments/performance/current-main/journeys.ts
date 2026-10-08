import * as Schema from "effect/Schema"
import {
	browser as browserCommand,
	evaluate,
} from "../../../tests/browser-driver"

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
let Sample = Schema.Struct({
	ms: Schema.optional(Schema.Number),
	error: Schema.optional(Schema.String),
})
type Configuration = typeof Configuration.Type
type Fixture = typeof Fixture.Type
let journeySamples = sampleCount(Bun.env.BENCHMARK_JOURNEY_SAMPLES, 5)
let configurationPath = process.argv[2],
	outputPath = process.argv[3]
if (!configurationPath || !outputPath)
	throw Error(
		"Usage: bun experiments/performance/journeys.ts CONFIG.json RESULTS.json",
	)
let traceIndex = 0
let traceOutputPath = outputPath
let activeTrace = ""
let lastCondition = ""
let configurations = Schema.decodeUnknownSync(Schema.Array(Configuration))(
	await Bun.file(configurationPath).json(),
)
let results: {
	version: string
	name: string
	kb: number
	n: number
	medianMs: number
	p95Ms: number
	values: number[]
}[] = []
let failures: {
	version: string
	phase: string
	kb?: number
	error: string
	condition: string
	state: unknown
}[] = []
for (let kb of Bun.env.BENCHMARK_ONLY === "switch"
	? []
	: Bun.env.BENCHMARK_ONLY === "trace"
		? [128]
		: Bun.env.BENCHMARK_JOURNEY_KB === "2"
			? [2]
			: [2, 128])
	for (let configuration of configurations) {
		let fixture = configuration.docs.find(doc => doc.kb === kb)
		if (!fixture) continue
		try {
			open(configuration, fixture)
			measureFind(configuration, fixture)
			if (Bun.env.BENCHMARK_ONLY !== "trace")
				measurePreview(configuration, fixture)
		} catch (error) {
			failures.push({
				version: configuration.kind,
				phase: "find and preview",
				kb,
				error: String(error),
				condition: lastCondition,
				state: diagnostic(configuration),
			})
		}
		await persist(outputPath)
	}
for (let configuration of configurations) {
	try {
		measureSwitch(configuration)
	} catch (error) {
		failures.push({
			version: configuration.kind,
			phase: "switch",
			error: String(error),
			condition: lastCondition,
			state: diagnostic(configuration),
		})
	}
	await persist(outputPath)
}

function open(configuration: Configuration, fixture: Fixture) {
	browser(configuration.session, "open", configuration.url + fixture.path)
	wait(
		configuration,
		`${source(configuration)}?.includes(${JSON.stringify(fixture.title)})`,
	)
}
function source(configuration: Configuration) {
	return configuration.kind === "original"
		? "document.querySelector('.cm-content')?.cmTile?.view?.state.doc.toString()"
		: "document.querySelector('alkalye-editor')?.source.value"
}
function wait(configuration: Configuration, condition: string) {
	lastCondition = condition
	browser(configuration.session, "wait", "--fn", condition)
}
function arm(configuration: Configuration, name: string, condition: string) {
	if (Bun.env.BENCHMARK_TRACE === "1") {
		activeTrace =
			traceOutputPath.replace(/\.json$/, "") +
			`-${configuration.kind}-${name.replaceAll(" ", "-")}-${traceIndex++}.trace.json`
		browserCommand(
			configuration.session,
			"profiler",
			"start",
			"--categories",
			"devtools.timeline,disabled-by-default-devtools.timeline,toplevel,blink.user_timing,v8",
		)
		evaluate(
			configuration.session,
			"(()=>{let controller=new AbortController();for(let name of ['pointerdown','keydown','beforeinput'])document.addEventListener(name,event=>{if(event.isTrusted){performance.mark('matrix:journey:start');controller.abort()}},{capture:true,signal:controller.signal});return true})()",
		)
	}

	evaluate(
		configuration.session,
		`window.__benchmark.armJourney(${JSON.stringify(name)},()=>(${condition}));true`,
	)
}
function sample(configuration: Configuration) {
	wait(configuration, "window.__benchmark.arm===null")
	let result = Schema.decodeUnknownSync(Sample)(
		evaluate(configuration.session, "window.__benchmark.samples.at(-1)"),
	)
	if (result.error || result.ms === undefined)
		throw Error(result.error ?? "Missing timing")
	if (Bun.env.BENCHMARK_TRACE === "1") {
		evaluate(
			configuration.session,
			"new Promise(resolve=>setTimeout(()=>{performance.mark('matrix:journey:end');resolve(true)},3000))",
		)
		browserCommand(configuration.session, "profiler", "stop", activeTrace)
	}
	return result.ms
}
function collect(
	configuration: Configuration,
	name: string,
	kb: number,
	values: number[],
) {
	let sorted = [...values].sort((a, b) => a - b),
		median = sorted[Math.floor(sorted.length / 2)],
		p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]
	if (median === undefined || p95 === undefined) throw Error("Missing samples")
	results.push({
		version: configuration.kind,
		name,
		kb,
		n: values.length,
		medianMs: median,
		p95Ms: p95,
		values,
	})
	console.log(JSON.stringify(results.at(-1)))
}
async function persist(path: string) {
	await Bun.write(path, JSON.stringify({ results, failures }, null, 2))
}
function measureFind(configuration: Configuration, fixture: Fixture) {
	let session = configuration.session,
		original = configuration.kind === "original",
		selector = original ? 'input[placeholder="Find..."]' : "#find-text",
		opening: number[] = [],
		matching: number[] = [],
		closing: number[] = []
	for (let iteration = 0; iteration < journeySamples; iteration++) {
		let closed = original
			? evaluate(
					session,
					"document.querySelector('[aria-label=\"Document tools\"]')?.getAttribute('aria-expanded')==='false'",
				)
			: evaluate(
					session,
					"!document.querySelector('#app').classList.contains('tools-open')",
				)
		if (closed)
			browser(
				session,
				"click",
				original
					? '[aria-label="Document tools"]'
					: '[data-action="toggle-tools"]',
			)
		arm(
			configuration,
			"open find",
			`!!document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`,
		)
		browser(
			session,
			"find",
			"role",
			"button",
			"click",
			"--name",
			"Find",
			"--exact",
		)
		opening.push(sample(configuration))
		browser(session, "fill", selector, "")
		browser(session, "focus", selector)
		let count = Schema.decodeUnknownSync(Schema.Number)(
			evaluate(
				session,
				`(${source(configuration)}.match(/reference/g)||[]).length`,
			),
		)
		arm(
			configuration,
			"find matches",
			original
				? `document.body.innerText.includes('1 of ${count}')`
				: `document.querySelector('.find-count')?.textContent?.includes('${count}') && (document.querySelector('.search-match') || CSS.highlights?.get('alkalye-search')?.size)`,
		)
		browser(session, "keyboard", "inserttext", "reference")
		matching.push(sample(configuration))
		let beforeClose = evaluate(session, source(configuration))
		arm(
			configuration,
			"close find",
			`!document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`,
		)
		if (original)
			browserCommand(
				session,
				"find",
				"role",
				"button",
				"click",
				"--name",
				"Close",
				"--exact",
			)
		else browserCommand(session, "click", "#close-find")
		closing.push(sample(configuration))
		if (evaluate(session, source(configuration)) !== beforeClose)
			throw Error("Closing Find changed the document")
	}
	collect(configuration, "close find panel", fixture.kb, closing)
	collect(configuration, "open find panel", fixture.kb, opening)
	collect(configuration, "find all reference matches", fixture.kb, matching)
}
function measurePreview(configuration: Configuration, fixture: Fixture) {
	let values: number[] = []
	for (let iteration = 0; iteration < journeySamples; iteration++) {
		arm(
			configuration,
			"preview",
			configuration.kind === "original"
				? "location.pathname.endsWith('/preview') && !!document.querySelector('article a[href=\"https://example.com\"]')"
				: "location.pathname.endsWith('/preview') && Array.from(document.querySelectorAll('*')).some(node=>node.shadowRoot?.querySelector('a[href=\"https://example.com\"]'))",
		)
		browser(configuration.session, "click", '[aria-label="Preview"]')
		values.push(sample(configuration))
		open(configuration, fixture)
	}
	collect(configuration, "open rendered preview", fixture.kb, values)
}
function measureSwitch(configuration: Configuration) {
	let small = configuration.docs.find(doc => doc.kb === 2),
		large = configuration.docs.find(doc => doc.kb === 128)
	if (!small || !large) return
	open(configuration, small)
	let values: number[] = []
	let fixtures: Fixture[] = [large, small]
	for (let iteration = 0; iteration < journeySamples; iteration++)
		for (let fixture of fixtures) {
			let id = fixture.path.split("/").at(-1),
				selector =
					configuration.kind === "original"
						? `[data-testid="doc-list-item"][data-doc-id="${id}"] a`
						: `[data-doc="${id}"]`
			if (
				!evaluate(
					configuration.session,
					`!!document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`,
				)
			)
				browser(
					configuration.session,
					"click",
					configuration.kind === "original"
						? '[aria-label="Documents"]'
						: '[data-action="library"]',
				)
			arm(
				configuration,
				"switch",
				`${source(configuration)}?.includes(${JSON.stringify(fixture.title)})`,
			)
			browser(configuration.session, "click", selector)
			let elapsed = sample(configuration)
			if (fixture === large) values.push(elapsed)
		}
	collect(configuration, "switch existing128KiB document", 128, values)
}

function browser(session: string, ...arguments_: string[]) {
	if (Bun.env.BENCHMARK_ACTIVATION !== "keyboard")
		return browserCommand(session, ...arguments_)
	let selector = arguments_[0] === "click" ? arguments_[1] : undefined
	if (arguments_[0] === "find" && arguments_[3] === "click") {
		let name = arguments_[5]
		evaluate(
			session,
			`[...document.querySelectorAll('button,[role=button]')].find(node=>node.checkVisibility()&&(node.getAttribute('aria-label')||node.textContent.trim())===${JSON.stringify(name)})?.setAttribute('data-benchmark-activation','')`,
		)
		selector = "[data-benchmark-activation]"
	}
	if (!selector) return browserCommand(session, ...arguments_)
	browserCommand(session, "focus", selector)
	let result = browserCommand(session, "press", "Enter")
	evaluate(
		session,
		"document.querySelectorAll('[data-benchmark-activation]').forEach(node=>node.removeAttribute('data-benchmark-activation'))",
	)
	return result
}

function sampleCount(value: string | undefined, fallback: number) {
	let count = value === undefined ? fallback : Number(value)
	if (!Number.isInteger(count) || count < 3 || count > 12)
		throw Error("Journey sample count must be 3–12")
	return count
}

function diagnostic(configuration: Configuration) {
	return evaluate(
		configuration.session,
		`(()=>{let find=document.querySelector(${JSON.stringify(configuration.kind === "original" ? 'input[placeholder="Find..."]' : "#find-text")});return {path:location.pathname,sourceCharacters:${source(configuration)}?.length,findVisible:find?.checkVisibility(),findCount:document.querySelector(".find-count")?.textContent,matchSpans:document.querySelectorAll(".search-match").length,nativeMatches:CSS.highlights?.get("alkalye-search")?.size,focused:document.activeElement?.id,readonly:document.querySelector("#editor")?.readOnly,pending:document.querySelector("#save-status")?.dataset.pending}})()`,
	)
}
