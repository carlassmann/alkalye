import { createServer } from "node:http"
import { once } from "node:events"
import assert from "node:assert/strict"
import { WebSocketServer } from "ws"
import { chromium } from "@playwright/test"
import { benchmarkBrowserArgs } from "./network"
import { instrument } from "./metrics"

let wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])
let server = createServer(async (request, response) => {
	if (request.url === "/module.wasm") {
		response.writeHead(200, {
			"content-type": "application/wasm",
			"content-length": wasm.length,
		})
		response.end(wasm)
	} else if (request.method === "POST") {
		request.resume()
		await once(request, "end")
		response.end("ok")
	} else {
		response.writeHead(200, { "content-type": "text/html" })
		response.end("<!doctype html><title>Worker network fixture</title>")
	}
})
let sockets = new WebSocketServer({ server })
sockets.on("connection", socket =>
	socket.on("message", (data, binary) => socket.send(data, { binary })),
)
server.listen(0, "127.0.0.1")
await once(server, "listening")
let address = server.address()
if (!address || typeof address === "string") throw new Error("No fixture port")
let target = `http://127.0.0.1:${address.port}`
let browser = await chromium.launch({ args: benchmarkBrowserArgs })
try {
	let context = await browser.newContext()
	let page = await context.newPage()
	let capture = await instrument(page, 1)
	await page.goto(target)
	let before = { ...capture.wire }
	for (let shared of [false, true]) {
		await page.evaluate(
			async ({ target, shared }) => {
				let work = `async function run(){await fetch(${JSON.stringify(target + "/module.wasm")}).then(r=>r.arrayBuffer());await fetch(${JSON.stringify(target + "/edit")},{method:"POST",body:new Uint8Array([0,255,128,1])});await new Promise((resolve,reject)=>{let socket=new WebSocket(${JSON.stringify(target.replace("http:", "ws:"))});socket.onopen=()=>socket.send(new Uint8Array([0,1,2,3]));socket.onmessage=()=>{socket.close();resolve()};socket.onerror=reject})}`
				let source = shared
					? `${work};onconnect=e=>run().then(()=>e.ports[0].postMessage("done"))`
					: `${work};run().then(()=>postMessage("done"))`
				let url = URL.createObjectURL(
					new Blob([source], { type: "text/javascript" }),
				)
				await new Promise<void>((resolve, reject) => {
					let timer = setTimeout(
						() => reject(new Error("Worker network fixture timed out")),
						10_000,
					)
					if (shared) {
						let worker = new SharedWorker(url)
						worker.port.onmessage = () => {
							clearTimeout(timer)
							worker.port.close()
							resolve()
						}
						worker.onerror = reject
					} else {
						let worker = new Worker(url)
						worker.onmessage = () => {
							clearTimeout(timer)
							worker.terminate()
							resolve()
						}
						worker.onerror = reject
					}
				})
				URL.revokeObjectURL(url)
			},
			{ target, shared },
		)
	}
	capture.ensureHealthy()
	let delta = {
		sent: capture.wire.sent - before.sent,
		received: capture.wire.received - before.received,
		httpSent: capture.wire.httpSent - before.httpSent,
		bundle: capture.wire.bundle - before.bundle,
	}
	assert.equal(delta.sent, 8)
	assert.equal(delta.received, 8)
	assert.equal(delta.httpSent, 8)
	assert.ok(delta.bundle >= wasm.length * 2)
	console.log(
		"Dedicated and SharedWorker HTTP, WebSocket and Wasm capture passed",
		delta,
	)
} finally {
	await browser.close()
	sockets.close()
	server.close()
}
