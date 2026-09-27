import { execFileSync } from "node:child_process"
import { setTimeout, clearTimeout } from "node:timers"
import { Buffer } from "node:buffer"
import { setTimeout as sleep } from "node:timers/promises"

export function browser(...args) {
	return execFileSync(
		"agent-browser",
		["--session", "sidebar2", "--json", ...args],
		{
			encoding: "utf8",
			timeout: 20000,
		},
	)
}

export function evaluate(source) {
	let response = JSON.parse(
		browser("eval", "-b", Buffer.from(source).toString("base64")),
	)
	if (!response.success)
		throw Error(response.error ?? "Browser evaluation failed")
	return response.data.result
}

export async function wait(source) {
	let deadline = Date.now() + 20000
	while (Date.now() < deadline) {
		if (evaluate(`Boolean(${source})`)) return
		await sleep(50)
	}
	throw Error("Condition timed out: " + source)
}

export async function connectInstrumentation() {
	let response = JSON.parse(browser("get", "cdp-url"))
	let socket = new globalThis.WebSocket(response.data.cdpUrl)
	let pending = new Map()
	let serial = 0
	function rejectPending(error) {
		for (let request of pending.values()) request.reject(error)
		pending.clear()
	}
	socket.addEventListener("close", () =>
		rejectPending(Error("CDP connection closed")),
	)
	socket.addEventListener("error", () =>
		rejectPending(Error("CDP connection failed")),
	)
	socket.addEventListener("message", event => {
		let message = JSON.parse(String(event.data))
		let request = pending.get(message.id)
		if (!request) return
		pending.delete(message.id)
		if (message.error) request.reject(Error(message.error.message))
		else request.resolve(message.result)
	})
	try {
		await new Promise((resolve, reject) => {
			let timer = setTimeout(
				() => reject(Error("CDP connection timed out")),
				20000,
			)
			socket.addEventListener(
				"open",
				() => {
					clearTimeout(timer)
					resolve()
				},
				{ once: true },
			)
			socket.addEventListener(
				"error",
				() => {
					clearTimeout(timer)
					reject(Error("CDP connection failed"))
				},
				{ once: true },
			)
		})
		let targets = await send("Target.getTargets")
		let target = targets.targetInfos.find(
			target =>
				target.type === "page" &&
				new globalThis.URL(target.url).origin === "http://localhost:4391",
		)
		if (!target)
			throw Error("Open the benchmark app on port 4391 before running")
		let { sessionId } = await send("Target.attachToTarget", {
			targetId: target.targetId,
			flatten: true,
		})
		return { send, sessionId, close: () => socket.close() }
	} catch (error) {
		socket.close()
		throw error
	}
	function send(method, params = {}, sessionId) {
		return new Promise((resolve, reject) => {
			let id = ++serial
			let timer = setTimeout(() => {
				pending.delete(id)
				reject(Error(`CDP timed out: ${method}`))
			}, 20000)
			pending.set(id, {
				resolve: value => {
					clearTimeout(timer)
					resolve(value)
				},
				reject: error => {
					clearTimeout(timer)
					reject(error)
				},
			})
			try {
				socket.send(JSON.stringify({ id, method, params, sessionId }))
			} catch (error) {
				pending.get(id).reject(error)
				pending.delete(id)
			}
		})
	}
}
