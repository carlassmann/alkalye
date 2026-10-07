import { browser, browserBatch } from "../../../tests/browser-driver"

let session = "viewport-recovery-journey"
let origin = process.argv[2] ?? "http://127.0.0.1:4331"
let document = "recovery-check-" + crypto.randomUUID()
try {
	browser(
		session,
		"open",
		`${origin}/?mode=session&size=131072&document=${document}`,
	)
	browser(session, "wait", "--fn", "Boolean(window.viewportSession)")
	browser(
		session,
		"eval",
		"window.originalSource=window.viewportExperiment.value",
	)
	browser(
		session,
		"eval",
		"window.viewportSession.peerEdit(0,0,'Peer contribution\\n')",
	)
	browserBatch(session, [
		[
			"eval",
			"window.viewportExperiment.select(window.viewportExperiment.length)",
		],
		["keyboard", "inserttext", "LOCAL RECOVERY"],
		["wait", "--fn", "Boolean(window.viewportSession.failure)"],
		[
			"eval",
			"(()=>{if(window.viewportExperiment.value!==window.originalSource+'LOCAL RECOVERY')throw Error('Draft lost on stale revision');if(!window.viewportExperiment.element.readOnly)throw Error('Failed session remains editable');window.recoveryLength=window.viewportExperiment.length})()",
		],
	])
	let length = browser(session, "eval", "window.recoveryLength").result
	if (typeof length !== "number") throw Error("Missing draft length")
	browser(session, "click", "#recover-draft")
	browser(
		session,
		"wait",
		"--fn",
		"new URL(location.href).searchParams.get('document')?.startsWith('recovered-')",
	)
	browser(session, "wait", "--fn", "Boolean(window.viewportSession)")
	let restored = browser(
		session,
		"eval",
		`(async()=>{let state=await window.viewportSession.read();return window.viewportExperiment.length===${length}&&window.viewportExperiment.value.endsWith('LOCAL RECOVERY')&&state.content===window.viewportExperiment.value})()`,
	).result
	if (restored !== true) throw Error("Recovered document lost optimistic draft")
	browser(session, "reload")
	browser(session, "wait", "--fn", "Boolean(window.viewportSession)")
	let reopened = browser(
		session,
		"eval",
		`window.viewportExperiment.length===${length}&&window.viewportExperiment.value.endsWith('LOCAL RECOVERY')`,
	).result
	if (reopened !== true) throw Error("Recovered document failed durable reload")
	let result = {
		staleRejected: true,
		draftRetained: true,
		recoveredCopy: true,
		durableReload: true,
		length,
	}
	await Bun.write(
		import.meta.dir + "/recovery-results.json",
		JSON.stringify(result, null, 2) + "\n",
	)
	console.log(JSON.stringify(result))
} finally {
	browser(session, "close")
}
