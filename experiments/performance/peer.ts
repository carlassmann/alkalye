import * as Schema from "effect/Schema"
import { browser, evaluate } from "../../tests/browser-driver"

let Configuration = Schema.Struct({
	kind: Schema.Literals(["original", "rewrite"]),
	session: Schema.String,
	peerSession: Schema.String,
	url: Schema.String,
	transport: Schema.optional(Schema.Literals(["socket", "poll"])),
	docs: Schema.Array(
		Schema.Struct({
			kb: Schema.Number,
			title: Schema.String,
			path: Schema.String,
		}),
	),
})
type Configuration = typeof Configuration.Type
let Resource = Schema.Struct({
	path: Schema.String,
	initiator: Schema.String,
	startMs: Schema.Number,
	responseMs: Schema.Number,
	durationMs: Schema.Number,
})
type Resource = typeof Resource.Type
interface Stages {
	producer: readonly Resource[]
	peer: readonly Resource[]
	producerSocket: readonly SocketFrame[]
	peerSocket: readonly SocketFrame[]
}
let SocketFrame = Schema.Struct({
	path: Schema.String,
	direction: Schema.String,
	startMs: Schema.Number,
})
type SocketFrame = typeof SocketFrame.Type
let configurationPath = process.argv[2],
	outputPath = process.argv[3]
if (!configurationPath || !outputPath)
	throw Error(
		"Usage: bun experiments/performance/peer.ts CONFIG_WITH_PEERS.json RESULTS.json",
	)
let configurations = Schema.decodeUnknownSync(Schema.Array(Configuration))(
	await Bun.file(configurationPath).json(),
)
let results: {
	version: string
	transport: string
	name: string
	kb: number
	n: number
	medianMs: number
	p95Ms: number
	values: number[]
	resources: Stages[]
}[] = []
let failures: { version: string; error: string }[] = []
for (let configuration of configurations) {
	try {
		measure(configuration)
	} catch (error) {
		failures.push({ version: configuration.kind, error: String(error) })
		browser(configuration.session, "set", "offline", "off")
	}
	await Bun.write(outputPath, JSON.stringify({ results, failures }, null, 2))
}

function source(configuration: Configuration) {
	return configuration.kind === "original"
		? "document.querySelector('.cm-content')?.cmTile?.view?.state.doc.toString()"
		: "document.querySelector('alkalye-editor')?.source.value"
}
function wait(session: string, condition: string) {
	browser(session, "wait", "--fn", condition)
}
function number(session: string, expression: string) {
	return Schema.decodeUnknownSync(Schema.Number)(evaluate(session, expression))
}
function focusEnd(configuration: Configuration) {
	evaluate(
		configuration.session,
		configuration.kind === "original"
			? "(()=>{let view=document.querySelector('.cm-content').cmTile.view;view.dispatch({selection:{anchor:view.state.doc.length}});view.focus()})()"
			: "(()=>{let editor=document.querySelector('alkalye-editor').source;editor.setSelectionRange(editor.value.length,editor.value.length);editor.focus()})()",
	)
}
function observe(configuration: Configuration, marker: string) {
	evaluate(
		configuration.peerSession,
		`(()=>{window.__peerPaint=null;function check(){if(${source(configuration)}.includes(${JSON.stringify(marker)})){requestAnimationFrame(()=>requestAnimationFrame(()=>window.__peerPaint=performance.timeOrigin+performance.now()))}else requestAnimationFrame(check)}requestAnimationFrame(check);return true})()`,
	)
}
function sample(configuration: Configuration) {
	wait(configuration.peerSession, "window.__peerPaint!==null")
	let start = number(configuration.session, "window.__syncStart")
	if (!start) throw Error("Missing producer event")
	return number(configuration.peerSession, "window.__peerPaint") - start
}
function resources(configuration: Configuration): Stages {
	let start = number(configuration.session, "window.__syncStart"),
		end = number(configuration.peerSession, "window.__peerPaint")
	function read(session: string) {
		return Schema.decodeUnknownSync(Schema.Array(Resource))(
			evaluate(
				session,
				`performance.getEntriesByType('resource').filter(entry=>performance.timeOrigin+entry.responseEnd>=${start}&&performance.timeOrigin+entry.startTime<=${end}).map(entry=>({path:new URL(entry.name).pathname,initiator:entry.initiatorType,startMs:performance.timeOrigin+entry.startTime-${start},responseMs:performance.timeOrigin+entry.responseEnd-${start},durationMs:entry.duration}))`,
			),
		)
	}
	function sockets(session: string) {
		return Schema.decodeUnknownSync(Schema.Array(SocketFrame))(
			evaluate(
				session,
				`(window.__benchmark.socketFrames??[]).filter(frame=>frame.time>=${start}&&frame.time<=${end}).map(frame=>({path:frame.path,direction:frame.direction,startMs:frame.time-${start}}))`,
			),
		)
	}
	return {
		producer: read(configuration.session),
		peer: read(configuration.peerSession),
		producerSocket: sockets(configuration.session),
		peerSocket: sockets(configuration.peerSession),
	}
}
function collect(
	configuration: Configuration,
	name: string,
	values: number[],
	resources: Stages[],
) {
	let sorted = [...values].sort((a, b) => a - b),
		median = sorted[Math.floor(sorted.length / 2)],
		p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]
	if (median === undefined || p95 === undefined) throw Error("Missing samples")
	results.push({
		version: configuration.kind,
		transport: configuration.transport ?? "socket",
		name,
		kb: 2,
		n: values.length,
		medianMs: median,
		p95Ms: p95,
		values,
		resources,
	})
	console.log(JSON.stringify(results.at(-1)))
}
function measure(configuration: Configuration) {
	let fixture = configuration.docs.find(doc => doc.kb === 2)
	if (!fixture) throw Error("Missing 2KiB fixture")
	for (let session of [configuration.session, configuration.peerSession]) {
		evaluate(
			session,
			configuration.transport === "poll"
				? "localStorage.setItem('__benchmarkTransport','poll');true"
				: "localStorage.removeItem('__benchmarkTransport');true",
		)
		browser(session, "open", configuration.url + fixture.path)
		wait(
			session,
			`${source(configuration)}?.includes(${JSON.stringify(fixture.title)})`,
		)
		if (configuration.transport === "poll")
			wait(
				session,
				"performance.getEntriesByType('resource').some(entry=>new URL(entry.name).pathname==='/api/live/send'&&entry.responseEnd>0)",
			)
	}
	let online: number[] = [],
		reconnect: number[] = [],
		onlineResources: Stages[] = [],
		reconnectResources: Stages[] = []
	for (let iteration = 0; iteration < 9; iteration++) {
		let marker = ` online_${Date.now()}_${iteration}`
		observe(configuration, marker)
		focusEnd(configuration)
		evaluate(
			configuration.session,
			"window.__syncStart=null;document.addEventListener('beforeinput',()=>window.__syncStart=performance.timeOrigin+performance.now(),{once:true,capture:true});true",
		)
		browser(configuration.session, "keyboard", "inserttext", marker)
		online.push(sample(configuration))
		onlineResources.push(resources(configuration))
	}
	collect(
		configuration,
		"edit to other device paint opportunity",
		online,
		onlineResources,
	)
	for (let iteration = 0; iteration < 3; iteration++) {
		browser(configuration.session, "set", "offline", "on")
		let marker = ` offline_${Date.now()}_${iteration}`
		observe(configuration, marker)
		focusEnd(configuration)
		browser(configuration.session, "keyboard", "inserttext", marker)
		wait(
			configuration.session,
			configuration.kind === "original"
				? `window.__benchmark.lastSaved?.content?.includes(${JSON.stringify(marker)})`
				: "document.querySelector('#save-status').getAttribute('aria-busy')==='false'",
		)
		let absent = Schema.decodeUnknownSync(Schema.Boolean)(
			evaluate(
				configuration.peerSession,
				`new Promise(resolve=>{let start=performance.now();function check(){if(${source(configuration)}.includes(${JSON.stringify(marker)}))resolve(false);else if(performance.now()-start>=750)resolve(true);else requestAnimationFrame(check)}requestAnimationFrame(check)})`,
			),
		)
		if (!absent) throw Error("Offline edit reached peer during observation")
		evaluate(
			configuration.session,
			"window.__syncStart=null;window.addEventListener('online',()=>window.__syncStart=performance.timeOrigin+performance.now(),{once:true});true",
		)
		browser(configuration.session, "set", "offline", "off")
		reconnect.push(sample(configuration))
		reconnectResources.push(resources(configuration))
	}
	collect(
		configuration,
		"offline reconnect to other device paint opportunity",
		reconnect,
		reconnectResources,
	)
}
