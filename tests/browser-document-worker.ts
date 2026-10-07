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
	wait(
		session,
		'document.querySelector("alkalye-stats #stats")?.textContent.includes("words")',
	)
	evaluate(
		session,
		`(() => {
		window.workerSchedulerChannels = [];
		let NativeChannel = window.MessageChannel;
		window.MessageChannel = class extends NativeChannel {
			constructor() {
				super();
				let record = {first:false,second:false,turns:0};
				this.port1.addEventListener("message", () => {record.turns++});
				window.workerSchedulerChannels.push(record);
				for (let [port, key] of [[this.port1,"first"],[this.port2,"second"]]) {
					let close = port.close.bind(port);
					port.close = () => {record[key] = true; close()};
				}
			}
		};
		window.workerTransfers = [];
		window.workerTransferTurns = [];
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
				window.workerTransferTurns.push(window.workerSchedulerChannels.at(-1)?.turns ?? 0);
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
		window.workerTransfers = [];
		window.interactionFrameProof = undefined;
		document.dispatchEvent(new KeyboardEvent("keydown", {key:"Shift", bubbles:true}));
		let stats = document.querySelector("#worker-proof");
		stats.update("An obsolete count.", "words");
		window.workerSource = "Newest values only.";
		stats.update(window.workerSource, "words");
		requestAnimationFrame(() => requestAnimationFrame(() => {
			window.interactionFrameProof = window.workerTransfers.length === 0 && stats.querySelector("#stats").textContent === "32770 words";
		}));
	})()`,
	)
	wait(session, "window.interactionFrameProof !== undefined")
	assert(
		evaluate(session, "window.interactionFrameProof"),
		"Input gets two frame opportunities before deferred statistics transfer or repaint",
	)
	wait(
		session,
		'document.querySelector("#worker-proof #stats").textContent === "3 words"',
	)
	assert(
		evaluate(session, "window.workerTransfers.length === 1"),
		"Statistics coalesce superseded updates while interaction holds the background gate",
	)
	evaluate(
		session,
		`(() => {
		window.workerSource = "One two.\\n".repeat(131072);
		document.querySelector("#worker-proof").update(window.workerSource, "words");
	})()`,
	)
	wait(
		session,
		'document.querySelector("#worker-proof #stats").textContent === "262144 words"',
	)
	for (let edit of ["append", "prepend"]) {
		evaluate(
			session,
			`(() => {
			window.workerTransfers = [];
			window.workerScanTask = undefined;
			window.workerTransferTurns = [];
			window.workerSchedulerChannels.at(-1).turns = 0;
			window.workerSource = ${JSON.stringify(edit)} === "append" ? window.workerSource + " Last word." : "First. " + window.workerSource;
			document.querySelector("#worker-proof").update(window.workerSource, "words");
			setTimeout(() => {window.workerScanTask = window.workerTransfers.length === 0}, 0);
		})()`,
		)
		wait(session, "window.workerScanTask !== undefined")
		assert(
			evaluate(session, "window.workerScanTask"),
			`A browser task runs during the large common ${edit === "append" ? "prefix" : "suffix"} scan`,
		)
		wait(
			session,
			`document.querySelector("#worker-proof #stats").textContent === "${edit === "append" ? "262146" : "262147"} words"`,
		)
		assert(
			evaluate(
				session,
				"window.workerTransfers.length > 0 && Math.max(...window.workerTransfers) < 2000",
			),
			"Large-source edits still transfer compact replacements",
		)
		assert(
			evaluate(session, "window.workerTransferTurns[0] >= 8"),
			"The large diff crosses multiple scheduler turns before RPC submission",
		)
	}
	evaluate(
		session,
		`(() => {
		window.workerTransfers = [];
		window.workerScanCancelled = undefined;
		window.workerCancelledChannel = window.workerSchedulerChannels.at(-1);
		let stats = document.querySelector("#worker-proof");
		stats.update(window.workerSource + " Cancelled calculation.", "words");
		setTimeout(() => {
			window.workerScanCancelled = window.workerTransfers.length === 0;
			stats.clear();
			stats.update("Fresh counts.", "words");
		}, 0);
	})()`,
	)
	wait(
		session,
		'window.workerScanCancelled !== undefined && document.querySelector("#worker-proof #stats").textContent === "2 words"',
	)
	assert(
		evaluate(
			session,
			"window.workerScanCancelled && window.workerTerminations > 0 && window.workerCancelledChannel.first && window.workerCancelledChannel.second",
		),
		"Clearing queued large-source work releases its worker and both scheduler ports",
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
	wait(
		session,
		"window.workerSchedulerChannels.length > 0 && window.workerSchedulerChannels.every(channel => channel.first && channel.second)",
	)
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
	evaluate(
		session,
		`(() => {
		window.workerFallbackTask = undefined;
		window.workerFallbackChannel = window.workerSchedulerChannels.at(-1);
		window.workerFallbackChannel.turns = 0;
		document.querySelector("#worker-fallback-proof").update("One two.\\n".repeat(131072), "words");
		setTimeout(() => {window.workerFallbackTask = document.querySelector("#worker-fallback-proof #stats").textContent !== "262144 words"}, 0);
	})()`,
	)
	wait(
		session,
		'document.querySelector("#worker-fallback-proof #stats").textContent === "262144 words"',
	)
	assert(
		evaluate(
			session,
			"window.workerFallbackTask && window.workerFallbackChannel.turns >= 8",
		),
		"Large unavailable-worker counts yield across browser tasks with exact counts",
	)
	let incompleteSources = [
		{
			source: '"`".repeat(200)+"\\n"+"One two. ".repeat(32768)',
			sentences: 32768,
		},
		{ source: '"[".repeat(131072)', sentences: 1 },
		{ source: '"![".repeat(65536)', sentences: 1 },
		{ source: '"[a](".repeat(32768)', sentences: 1 },
		{ source: '".".repeat(131072)+"x"', sentences: 1 },
	]
	for (let [index, { source, sentences }] of incompleteSources.entries()) {
		evaluate(
			session,
			`document.querySelector("#worker-fallback-proof").update("Lead. ".repeat(${index + 1})+(${source}), "sentences")`,
		)
		wait(
			session,
			`document.querySelector("#worker-fallback-proof #stats").textContent === "${sentences + index + 1} sentences"`,
		)
	}
	assert(
		true,
		"Unavailable-worker fallback handles large incomplete fences, links and punctuation",
	)

	evaluate(
		session,
		`(() => {
		let stats = document.querySelector("#worker-fallback-proof");
		window.workerFallbackCancelledChannel = window.workerSchedulerChannels.at(-1);
		stats.update("One two.\\n".repeat(131072) + "Pending.", "words");
		setTimeout(() => {stats.clear(); stats.update("Fresh fallback.", "words")}, 0);
	})()`,
	)
	wait(
		session,
		'document.querySelector("#worker-fallback-proof #stats").textContent === "2 words" && window.workerFallbackCancelledChannel.first && window.workerFallbackCancelledChannel.second',
	)
	let cancelledTurns = evaluate(
		session,
		"window.workerFallbackCancelledChannel.turns",
	)
	evaluate(
		session,
		'document.querySelector("#worker-fallback-proof").update("Fresh fallback continues.", "words")',
	)
	wait(
		session,
		'document.querySelector("#worker-fallback-proof #stats").textContent === "3 words"',
	)
	assert(
		evaluate(session, "window.workerFallbackCancelledChannel.turns") ===
			cancelledTurns,
		"Interrupted fallback work schedules no further turns while replacement counts continue",
	)
} finally {
	try {
		browser(session, "close")
	} catch {}
	server.kill("SIGTERM")
	await server.exited
}
