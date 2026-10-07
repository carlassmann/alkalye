import { assert, browser, evaluate, wait } from "./browser-driver"

let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let session = "document-worker-" + Date.now()
try {
	let output = await server.stdout.getReader().read()
	if (!output.value) throw new Error("Missing app URL")
	let url = new URL("/app", new TextDecoder().decode(output.value).trim()).href
	browser(session, "open", url)
	wait(session, 'document.querySelector("#editor") !== null')
	evaluate(
		session,
		`(() => {
		window.workerTransfers = [];
		window.workerTerminations = 0;
		window.workerCreations = 0;
		window.workerExits = 0;
		let NativeWorker = window.Worker;
		window.Worker = class extends NativeWorker {
			constructor(url, options) {
				super(window.breakStatsWorker ? "/missing-worker.js" : url, options);
				window.workerCreations++;
				this.addEventListener("message", event => { if (Array.isArray(event.data) && event.data[0] === 1 && event.data[1]?._tag === "Exit") window.workerExits++; });
			}
			postMessage(message, ...rest) {
				window.workerTransfers.push(JSON.stringify(message).length);
				return super.postMessage(message, ...rest);
			}
			terminate() { window.workerTerminations++; return super.terminate(); }
		};
		let stats = document.createElement("alkalye-stats");
		stats.id = "worker-proof";
		document.body.append(stats);
		window.workerSource = "---\\ntitle: Ignore these metadata words\\n---\\n" + "One two.\\n".repeat(16384);
		stats.update(window.workerSource, "words");
	})()`,
	)
	wait(
		session,
		'document.querySelector("#worker-proof #stats").textContent === "32768 words"',
	)
	assert(
		evaluate(session, "window.workerTransfers.some(size => size > 100000)"),
		"Initial source is transferred to the real worker",
	)
	evaluate(
		session,
		`(() => {
		window.workerTransfers = [];
		window.workerSource += "Last word.";
		document.querySelector("#worker-proof").update(window.workerSource, "words");
	})()`,
	)
	wait(
		session,
		'document.querySelector("#worker-proof #stats").textContent === "32770 words"',
	)
	assert(
		evaluate(
			session,
			"window.workerTransfers.length > 0 && Math.max(...window.workerTransfers) < 2000",
		),
		"A source edit transfers a small replacement, not the whole document",
	)
	evaluate(
		session,
		`(() => {
		let stats = document.querySelector("#worker-proof");
		for (let index = 0; index < 30; index++) stats.update("Item ".repeat(index + 1), "words");
	})()`,
	)
	wait(
		session,
		'document.querySelector("#worker-proof #stats").textContent === "30 words"',
	)
	assert(true, "Coalesced revisions show the newest counts")
	evaluate(
		session,
		'document.querySelector("#worker-proof").update("- [ ] First\\n- [x] Second", "tasks")',
	)
	wait(
		session,
		'document.querySelector("#worker-proof #stats").textContent === "1 / 2 tasks"',
	)
	evaluate(session, 'document.querySelector("#worker-proof").clear()')
	assert(
		evaluate(session, 'document.querySelector("#worker-proof").hidden'),
		"Clearing hides counts and invalidates in-flight replies",
	)
	evaluate(
		session,
		'document.querySelector("#worker-proof").update("", "words")',
	)
	wait(
		session,
		'document.querySelector("#worker-proof #stats").textContent === "0 words" && !document.querySelector("#worker-proof").hidden',
	)
	evaluate(session, 'document.querySelector("#worker-proof").remove()')
	wait(session, "window.workerTerminations > 0")
	assert(
		true,
		"Disconnecting closes the Effect scope and terminates the worker",
	)
	wait(session, "navigator.serviceWorker.controller !== null")
	evaluate(session, "window.workerExits = 0")
	browser(session, "set", "offline", "on")
	evaluate(
		session,
		`(() => {
		let stats = document.createElement("alkalye-stats");
		stats.id = "worker-offline-proof";
		document.body.append(stats);
		stats.update("Offline words stay available.", "words");
	})()`,
	)
	wait(
		session,
		'document.querySelector("#worker-offline-proof #stats").textContent === "4 words"',
	)
	assert(
		evaluate(session, "window.workerExits > 0"),
		"Offline derived counts come from a cached real worker",
	)
	browser(session, "set", "offline", "off")
	evaluate(
		session,
		`(() => {
		window.breakStatsWorker = true;
		window.workerCreations = 0;
		let stats = document.createElement("alkalye-stats");
		stats.id = "worker-fallback-proof";
		document.body.append(stats);
		stats.update("Fallback is available.", "words");
	})()`,
	)
	wait(
		session,
		'document.querySelector("#worker-fallback-proof #stats").textContent === "3 words"',
	)
	let failedCreations = evaluate(session, "window.workerCreations")
	evaluate(
		session,
		'document.querySelector("#worker-fallback-proof").update("Fallback keeps working without retries.", "words")',
	)
	wait(
		session,
		'document.querySelector("#worker-fallback-proof #stats").textContent === "5 words"',
	)
	assert(
		evaluate(session, "window.workerCreations") === failedCreations,
		"An unavailable worker scope closes; later updates use idle fallback without retry loops",
	)
} finally {
	try {
		browser(session, "close")
	} catch {}
	server.kill("SIGTERM")
	await server.exited
}
