/* global WebSocket */
import { execFileSync } from "node:child_process"

export function browser(...args) {
	return execFileSync(
		"agent-browser",
		["--session", "heavy-tooling", ...args],
		{ encoding: "utf8" },
	).trim()
}

export async function connect() {
	let url = browser("get", "cdp-url")

	let socket = new WebSocket(url)
	await new Promise(resolve =>
		socket.addEventListener("open", resolve, { once: true }),
	)
	let sequence = 0
	let pending = new Map()
	socket.addEventListener("message", event => {
		let message = JSON.parse(event.data)

		if (!message.id) return
		let listener = pending.get(message.id)
		pending.delete(message.id)
		if (message.error) listener.reject(new Error(JSON.stringify(message.error)))
		else listener.resolve(message.result)
	})
	function send(method, params = {}, sessionId) {
		return new Promise((resolve, reject) => {
			let id = ++sequence
			pending.set(id, { resolve, reject })
			socket.send(JSON.stringify({ id, method, params, sessionId }))
		})
	}
	let { targetInfos } = await send("Target.getTargets")

	let target = targetInfos.find(
		target =>
			target.type === "page" && target.url.startsWith("http://localhost:4317/"),
	)
	let { sessionId } = await send("Target.attachToTarget", {
		targetId: target.targetId,
		flatten: true,
	})
	return {
		rootCommand(method, params) {
			return send(method, params)
		},
		command(method, params) {
			return send(method, params, sessionId)
		},
		close() {
			socket.close()
		},
	}
}
