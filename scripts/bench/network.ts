import CDP from "chrome-remote-interface"
import type { Browser, CDPSession, Page } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

export { benchmarkBrowserArgs, captureNetwork }

let benchmarkBrowserArgs = [
	"--remote-debugging-port=0",
	"--remote-debugging-address=127.0.0.1",
	"--ignore-certificate-errors",
]
let captures = new WeakMap<Browser, ReturnType<typeof createCapture>>()

type Traffic = ReturnType<typeof createTraffic>

async function captureNetwork(page: Page, cdp: CDPSession) {
	let browser = page.context().browser()
	if (!browser) throw new Error("Network capture requires a browser")
	let capture = captures.get(browser)
	if (!capture) {
		capture = createCapture(browser)
		captures.set(browser, capture)
	}
	return (await capture).attach(page, cdp)
}

function createTraffic() {
	let issues: string[] = []
	return {
		wire: { sent: 0, received: 0, http: 0, httpSent: 0, bundle: 0 },
		cacheDisabled: true,
		closed: false,
		issues,
		timeline: new Array<{ at: number; kind: string; bytes?: number }>(),
		bundleRequests: new Set<string>(),
		bundleTransfers: new Map<string, { url: string; bytes: number }>(),
		resources: new Map<string, number>(),
		requests: new Set<string>(),
		websocketOwners: new Map<string, string>(),
	}
}

async function createCapture(browser: Browser) {
	let root = await browser.newBrowserCDPSession()
	let { arguments: args } = await root.send("Browser.getBrowserCommandLine")
	let directory = args
		.find(arg => arg.startsWith("--user-data-dir="))
		?.slice("--user-data-dir=".length)
	if (!directory) throw new Error("Cannot find Chromium debug profile")
	let [port, endpoint] = (
		await readFile(join(directory, "DevToolsActivePort"), "utf8")
	)
		.trim()
		.split("\n")
	if (!port || !endpoint)
		throw new Error("Chromium did not expose its debugging endpoint")
	await root.detach()
	let client = await CDP({
		target: `ws://127.0.0.1:${port}${endpoint}`,
		local: true,
	})
	let contexts = new Map<string, Traffic>()
	let sessions = new Map<string, Traffic>()
	let connected = true
	client.on("disconnect", () => {
		connected = false
	})
	browser.on("disconnected", () => {
		void client.close().catch(() => {})
	})

	function traffic(sessionId?: string) {
		return sessionId ? sessions.get(sessionId) : undefined
	}

	client.on("Network.requestWillBeSent", (event, sessionId) => {
		let state = traffic(sessionId)
		if (!state) return
		let key = `${event.requestId}:${event.timestamp}`
		if (state.requests.has(key)) return
		state.requests.add(key)
		let entries =
			event.request.postDataEntries?.flatMap(entry =>
				entry.bytes === undefined ? [] : [entry.bytes],
			) ?? []
		state.wire.httpSent += entries.length
			? entries.reduce(
					(total, bytes) => total + Buffer.byteLength(bytes, "base64"),
					0,
				)
			: Buffer.byteLength(event.request.postData ?? "")
	})
	client.on("Network.responseReceived", (event, sessionId) => {
		let state = traffic(sessionId)
		if (!state) return
		if (
			event.type === "Script" ||
			/javascript|wasm/.test(event.response.mimeType) ||
			/\.wasm(?:\?|$)/.test(event.response.url)
		) {
			if (!state.bundleRequests.has(event.requestId))
				state.wire.bundle += state.resources.get(event.requestId) ?? 0
			state.bundleRequests.add(event.requestId)
			state.bundleTransfers.set(event.requestId, {
				url: event.response.url,
				bytes: state.resources.get(event.requestId) ?? 0,
			})
		}
	})
	client.on("Network.loadingFinished", (event, sessionId) => {
		let state = traffic(sessionId)
		if (!state) return
		let previous = state.resources.get(event.requestId) ?? 0
		let extra = Math.max(0, event.encodedDataLength - previous)
		state.resources.set(
			event.requestId,
			Math.max(previous, event.encodedDataLength),
		)
		let transfer = state.bundleTransfers.get(event.requestId)
		if (transfer) transfer.bytes += extra
		state.wire.http += extra
		if (state.bundleRequests.has(event.requestId)) state.wire.bundle += extra
	})
	function countFrame(
		sessionId: string | undefined,
		requestId: string,
		payload: string,
		opcode: number,
		sent: boolean,
	) {
		let state = traffic(sessionId)
		if (!state || !sessionId) return
		let owner = state.websocketOwners.get(requestId)
		if (owner && owner !== sessionId) return
		state.websocketOwners.set(requestId, sessionId)
		let bytes = Buffer.byteLength(payload, opcode === 2 ? "base64" : "utf8")
		state.timeline.push({
			at: performance.now(),
			kind: sent ? "sent" : "received",
			bytes,
		})
		if (sent) state.wire.sent += bytes
		else state.wire.received += bytes
	}
	for (let name of [
		"Network.webSocketCreated",
		"Network.webSocketClosed",
		"Network.webSocketFrameError",
	]) {
		client.on(name, (_event: unknown, sessionId?: string) => {
			traffic(sessionId)?.timeline.push({ at: performance.now(), kind: name })
		})
	}
	client.on("Network.webSocketFrameSent", (event, sessionId) =>
		countFrame(
			sessionId,
			event.requestId,
			event.response.payloadData,
			event.response.opcode,
			true,
		),
	)
	client.on("Network.webSocketFrameReceived", (event, sessionId) =>
		countFrame(
			sessionId,
			event.requestId,
			event.response.payloadData,
			event.response.opcode,
			false,
		),
	)
	client.on("Target.detachedFromTarget", event => {
		sessions.delete(event.sessionId)
	})
	client.on("Target.attachedToTarget", (event, parentSession) => {
		if (event.targetInfo.type === "page") return
		let state =
			contexts.get(event.targetInfo.browserContextId ?? "") ??
			traffic(parentSession)
		if (!state) return
		sessions.set(event.sessionId, state)
		void initialize(event.sessionId, state)
			.catch(error => {
				if (!state.closed && sessions.has(event.sessionId))
					state.issues.push(
						error instanceof Error ? error.message : String(error),
					)
			})
			.finally(() => {
				void client.Runtime.runIfWaitingForDebugger(event.sessionId).catch(
					() => {},
				)
			})
	})

	async function initialize(sessionId: string, state: Traffic) {
		await client.Network.enable({ maxPostDataSize: 8 * 1024 * 1024 }, sessionId)
		await client.Network.setCacheDisabled(
			{ cacheDisabled: state.cacheDisabled },
			sessionId,
		)
		await client.Target.setAutoAttach(
			{
				autoAttach: true,
				waitForDebuggerOnStart: true,
				flatten: true,
				filter: [{ type: "worker" }, { type: "iframe" }, { exclude: true }],
			},
			sessionId,
		)
	}
	await client.Target.setAutoAttach({
		autoAttach: true,
		waitForDebuggerOnStart: true,
		flatten: true,
		filter: [{ type: "shared_worker" }, { exclude: true }],
	})

	async function attach(page: Page, cdp: CDPSession) {
		let { targetInfo } = await cdp.send("Target.getTargetInfo")
		let contextId = targetInfo.browserContextId
		if (!contextId)
			throw new Error("Network capture requires an isolated browser context")
		let state = contexts.get(contextId)
		if (!state) {
			state = createTraffic()
			contexts.set(contextId, state)
			let current = state
			page.context().once("close", () => {
				current.closed = true
			})
		}
		let { sessionId } = await client.Target.attachToTarget({
			targetId: targetInfo.targetId,
			flatten: true,
		})
		sessions.set(sessionId, state)
		await initialize(sessionId, state)
		let current = state
		return {
			wire: current.wire,
			timeline: current.timeline,
			bundleTransfers: current.bundleTransfers,
			ensureHealthy() {
				if (!connected || current.issues.length)
					throw new Error(
						`Worker network capture failed: ${current.issues.join("; ") || "CDP disconnected"}`,
					)
			},
			async setCacheDisabled(disabled: boolean) {
				current.cacheDisabled = disabled
				await Promise.all(
					[...sessions]
						.filter(([, value]) => value === current)
						.map(([id]) =>
							client.Network.setCacheDisabled({ cacheDisabled: disabled }, id),
						),
				)
			},
		}
	}
	return { attach }
}
