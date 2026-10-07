import * as Schema from "effect/Schema"
import { browser, evaluate } from "../../tests/browser-driver"

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
let configurationPath = process.argv[2],
	outputPath = process.argv[3]
if (!configurationPath || !outputPath)
	throw Error(
		"Usage: bun experiments/performance/journeys.ts CONFIG.json RESULTS.json",
	)
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
let failures: { version: string; phase: string; kb?: number; error: string }[] =
	[]
for (let kb of [2, 128])
	for (let configuration of configurations) {
		let fixture = configuration.docs.find(doc => doc.kb === kb)
		if (!fixture) continue
		try {
			open(configuration, fixture)
			measureFind(configuration, fixture)
			measurePreview(configuration, fixture)
		} catch (error) {
			failures.push({
				version: configuration.kind,
				phase: "find and preview",
				kb,
				error: String(error),
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
	browser(configuration.session, "wait", "--fn", condition)
}
function arm(configuration: Configuration, name: string, condition: string) {
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
		matching: number[] = []
	for (let iteration = 0; iteration < 9; iteration++) {
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
				: `document.querySelector('.find-count')?.textContent?.includes('${count}') && !!document.querySelector('.search-match')`,
		)
		browser(session, "keyboard", "inserttext", "reference")
		matching.push(sample(configuration))
		if (original)
			browser(
				session,
				"find",
				"role",
				"button",
				"click",
				"--name",
				"Close",
				"--exact",
			)
		else browser(session, "click", "#close-find")
	}
	collect(configuration, "open find panel", fixture.kb, opening)
	collect(configuration, "find all reference matches", fixture.kb, matching)
}
function measurePreview(configuration: Configuration, fixture: Fixture) {
	let values: number[] = []
	for (let iteration = 0; iteration < 9; iteration++) {
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
	for (let iteration = 0; iteration < 9; iteration++)
		for (let fixture of fixtures) {
			let id = fixture.path.split("/").at(-1),
				selector =
					configuration.kind === "original"
						? `[data-testid="doc-list-item"][data-doc-id="${id}"]`
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
