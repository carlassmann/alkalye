import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run } from "../src/platform/effects"
import { startServer } from "../src/server/index"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import { Signatures } from "../src/platform/signatures"
import { encode } from "../src/shared/base64"
import { object } from "../src/shared/model"

let directory = await mkdtemp(join(tmpdir(), "alkalye-effect-mcp-cli-"))
let instance: import("effect").Effect.Success<ReturnType<typeof startServer>>
let token = ""
beforeAll(async () => {
	instance = await run(startServer({ port: 0, data: directory, build: false }))
	let identity = await Effect.runPromise(
		Effect.gen(function* () {
			return yield* (yield* Signatures).account(
				Redacted.make(encode(new Uint8Array(32).fill(42))),
			)
		}).pipe(Effect.provide(Signatures.layer)),
	)
	token = await run(
		instance.mcp.createAccount({
			kind: "account",
			subject: identity.subject,
			workspaces: "all",
			ceiling: "owner",
		}),
	)
})
afterAll(async () => {
	await run(instance.close())
	await rm(directory, { recursive: true, force: true })
})
async function proxy(
	input: string,
	credential = token,
	server = instance.server.url.href,
	apiKey = false,
) {
	let child = Bun.spawn(["bun", "cli.ts", "--server", server, "mcp"], {
		env: {
			...process.env,
			ALKALYE_API_KEY: apiKey ? credential : "",
			ALKALYE_MCP_TOKEN: apiKey ? "" : credential,
		},
		stdin: new Blob([input]),
		stdout: "pipe",
		stderr: "pipe",
	})
	let [output, error, status] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	])
	return { output, error, status }
}
test.each([false, true])(
	"Effect MCP proxy initializes with shared API key %s, skips notifications and forwards the final unframed request",
	async apiKey => {
		let result = await proxy(
			[
				JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "initialize",
					params: {
						protocolVersion: "2025-06-18",
						capabilities: {},
						clientInfo: { name: "CLI test", version: "1" },
					},
				}),
				JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
				JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
			].join("\n"),
			token,
			instance.server.url.href,
			apiKey,
		)
		expect(result.status).toBe(0)
		let replies = result.output
			.trim()
			.split("\n")
			.map(line => object(JSON.parse(line)))
		expect(replies.map(reply => reply.id)).toEqual([1, 2])
		let tools = object(replies[1]?.result).tools
		if (!Array.isArray(tools)) throw new Error("Expected MCP tools")
		expect(tools).toHaveLength(11)
	},
)
test("malformed and invalid MCP frames produce distinct errors and preserve the next request", async () => {
	let result = await proxy(
		'{broken\n{"jsonrpc":"2.0","id":3}\n{"jsonrpc":"2.0","id":4,"method":"tools/list"}',
	)
	expect(result.status).toBe(0)
	let replies = result.output
		.trim()
		.split("\n")
		.map(line => object(JSON.parse(line)))
	expect(object(replies[0]?.error).code).toBe(-32700)
	expect(object(replies[1]?.error).code).toBe(-32600)
	expect(replies[2]?.id).toBe(4)
})
test("bad MCP tokens fail without echoing credentials", async () => {
	let result = await proxy(
		'{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n',
		"private-rejected-token",
	)
	expect(result.output + result.error).not.toContain("private-rejected-token")
	expect(result.status).toBe(1)
	expect(result.error).toContain("MCP HTTP 401")
	expect(result.output).toBe("")
})
test("MCP proxy preserves stateless metadata and encodes Unicode tool headers", async () => {
	let headers = new Headers()
	let received = ""
	let server = Bun.serve({
		port: 0,
		async fetch(request) {
			headers = request.headers
			received = await request.text()
			return Response.json({ jsonrpc: "2.0", id: "unicode", result: {} })
		},
	})
	try {
		let message = JSON.stringify({
			jsonrpc: "2.0",
			id: "unicode",
			method: "tools/call",
			params: {
				name: "héllo",
				_meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" },
			},
		})
		let result = await proxy(message, token, server.url.href)
		expect(result.status).toBe(0)
		expect(received).toBe(message)
		expect(headers.get("mcp-protocol-version")).toBe("2026-07-28")
		expect(headers.get("mcp-method")).toBe("tools/call")
		expect(headers.get("mcp-name")).toBe(
			"=?base64?" + Buffer.from("héllo").toString("base64") + "?=",
		)
	} finally {
		server.stop(true)
	}
})
test("non-JSON HTTP errors become protocol errors without a secondary parse crash", async () => {
	let requests = 0
	let server = Bun.serve({
		port: 0,
		fetch: () =>
			++requests === 1
				? new Response("Unavailable", { status: 503 })
				: Response.json({ jsonrpc: "2.0", id: 2, result: {} }),
	})
	try {
		let result = await proxy(
			'{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}',
			token,
			server.url.href,
		)
		expect(result.status).toBe(0)
		let replies = result.output
			.trim()
			.split("\n")
			.map(line => object(JSON.parse(line)))
		expect(replies.map(reply => reply.id)).toEqual([1, 2])
		expect(object(replies[0]?.error).code).toBe(-32603)
		expect(replies[1]?.result).toEqual({})
		expect(result.error).toBe("")
	} finally {
		server.stop(true)
	}
})

test("MCP proxy passes responses and batches unchanged and decodes SSE through Effect", async () => {
	let received: string[] = []
	let server = Bun.serve({
		port: 0,
		async fetch(request) {
			received.push(await request.text())
			let data =
				'data: {"jsonrpc":"2.0","id":7,"result":{"text":"héllo"}}\n\ndata: {"jsonrpc":"2.0","method":"notifications/message","params":{}}\n\n'
			return new Response(new TextEncoder().encode(data), {
				headers: { "Content-Type": "text/event-stream" },
			})
		},
	})
	try {
		let response =
			'{"jsonrpc":"2.0","id":9,"result":{"answer":"client response"}}'
		let batch =
			'[{"jsonrpc":"2.0","id":1,"method":"ping"},{"jsonrpc":"2.0","id":2,"method":"ping"}]'
		let result = await proxy(response + "\n" + batch, token, server.url.href)
		expect(result.status).toBe(0)
		// Replies bypass queued requests so server-initiated calls cannot deadlock.
		expect([...received].sort()).toEqual([response, batch].sort())
		let replies = result.output
			.trim()
			.split("\n")
			.map(line => object(JSON.parse(line)))
		expect(replies).toHaveLength(4)
		expect(object(replies[0]?.result).text).toBe("héllo")
		expect(replies[1]?.method).toBe("notifications/message")
	} finally {
		server.stop(true)
	}
})

test("termination interrupts a stalled MCP request through the Effect runtime", async () => {
	let started = Promise.withResolvers<void>()
	let server = Bun.serve({
		port: 0,
		fetch() {
			started.resolve()
			return new Promise<Response>(() => {})
		},
	})
	let child = Bun.spawn(["bun", "cli.ts", "mcp", "--server", server.url.href], {
		env: { ...process.env, ALKALYE_MCP_TOKEN: token },
		stdin: new Blob(['{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n']),
		stdout: "pipe",
		stderr: "pipe",
	})
	try {
		await Promise.race([
			started.promise,
			Bun.sleep(3000).then(() => {
				throw new Error("MCP request did not start")
			}),
		])
		child.kill("SIGTERM")
		let status = await Promise.race([
			child.exited,
			Bun.sleep(3000).then(() => {
				throw new Error("MCP process did not stop")
			}),
		])
		expect(status).toBe(143)
		expect(await new Response(child.stderr).text()).toBe("")
		expect(await new Response(child.stdout).text()).toBe("")
	} finally {
		child.kill()
		server.stop(true)
	}
})

test("a cancellation bypasses queued requests and later pretty JSON remains one stdio frame", async () => {
	let started = Promise.withResolvers<void>()
	let server = Bun.serve({
		port: 0,
		async fetch(request) {
			let message = object(await request.json())
			if (message.method === "tools/call") {
				started.resolve()
				return new Promise<Response>(() => {})
			}
			if (message.method === "notifications/cancelled")
				return new Response(null, { status: 202 })
			return new Response(
				JSON.stringify(
					{ jsonrpc: "2.0", id: 2, result: { extension: { retained: true } } },
					null,
					2,
				) + "\n",
				{ headers: { "Content-Type": "application/json" } },
			)
		},
	})
	let child = Bun.spawn(["bun", "cli.ts", "mcp", "--server", server.url.href], {
		env: { ...process.env, ALKALYE_MCP_TOKEN: token },
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	})
	try {
		child.stdin.write(
			'{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"slow"}}\n',
		)
		await child.stdin.flush()
		await Promise.race([
			started.promise,
			Bun.sleep(3000).then(() => {
				throw new Error("Slow request did not start")
			}),
		])
		child.stdin.write(
			'{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":1}}\n{"jsonrpc":"2.0","id":2,"method":"ping"}\n',
		)
		child.stdin.end()
		let status = await Promise.race([
			child.exited,
			Bun.sleep(3000).then(() => {
				throw new Error("Cancellation did not release queued request")
			}),
		])
		expect(status).toBe(0)
		let output = await new Response(child.stdout).text()
		expect(output.trim().split("\n")).toHaveLength(1)
		expect(JSON.parse(output)).toEqual({
			jsonrpc: "2.0",
			id: 2,
			result: { extension: { retained: true } },
		})
		expect(await new Response(child.stderr).text()).toBe("")
	} finally {
		child.kill()
		server.stop(true)
	}
})

test("SSE priming and a retry after the result never create a duplicate response", async () => {
	let server = Bun.serve({
		port: 0,
		fetch: () =>
			new Response(
				'id: priming\ndata:\n\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n\nretry: 1000\n\n',
				{ headers: { "Content-Type": "text/event-stream" } },
			),
	})
	try {
		let result = await proxy(
			'{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
			token,
			server.url.href,
		)
		expect(result.status).toBe(0)
		expect(result.output.trim().split("\n")).toHaveLength(1)
		expect(JSON.parse(result.output)).toEqual({
			jsonrpc: "2.0",
			id: 1,
			result: {},
		})
	} finally {
		server.stop(true)
	}
})
test("failed batches report each request and failed client responses stay silent", async () => {
	let server = Bun.serve({
		port: 0,
		fetch: () => new Response("Unavailable", { status: 503 }),
	})
	try {
		let result = await proxy(
			'[{"jsonrpc":"2.0","id":1,"method":"tools/list"},{"jsonrpc":"2.0","method":"notifications/initialized"},{"jsonrpc":"2.0","id":2,"method":"tools/list"}]\n{"jsonrpc":"2.0","id":3,"result":{}}',
			token,
			server.url.href,
		)
		expect(result.status).toBe(0)
		let replies = result.output
			.trim()
			.split("\n")
			.map(line => object(JSON.parse(line)))
		expect(replies.map(reply => reply.id)).toEqual([1, 2])
		expect(replies.every(reply => object(reply.error).code === -32603)).toBe(
			true,
		)
	} finally {
		server.stop(true)
	}
})
test("cancelling a queued request prevents its HTTP call without losing later requests", async () => {
	let started = Promise.withResolvers<void>()
	let requests: unknown[] = []
	let server = Bun.serve({
		port: 0,
		async fetch(request) {
			let message = object(await request.json())
			if (message.method === "notifications/cancelled")
				return new Response(null, { status: 202 })
			requests.push(message.id)
			if (message.id === 1) {
				started.resolve()
				return new Promise<Response>(() => {})
			}
			return Response.json({ jsonrpc: "2.0", id: message.id, result: {} })
		},
	})
	let child = Bun.spawn(["bun", "cli.ts", "mcp", "--server", server.url.href], {
		env: { ...process.env, ALKALYE_MCP_TOKEN: token },
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	})
	try {
		child.stdin.write('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n')
		await child.stdin.flush()
		await Promise.race([
			started.promise,
			Bun.sleep(3000).then(() => {
				throw new Error("Request did not start")
			}),
		])
		child.stdin.write(
			[
				{ jsonrpc: "2.0", id: 2, method: "tools/list" },
				{
					jsonrpc: "2.0",
					method: "notifications/cancelled",
					params: { requestId: 2 },
				},
				{
					jsonrpc: "2.0",
					method: "notifications/cancelled",
					params: { requestId: 1 },
				},
				{ jsonrpc: "2.0", id: 3, method: "tools/list" },
			]
				.map(message => JSON.stringify(message))
				.join("\n"),
		)
		child.stdin.end()
		let status = await Promise.race([
			child.exited,
			Bun.sleep(3000).then(() => {
				throw new Error("Queued cancellation stalled")
			}),
		])
		expect(status).toBe(0)
		expect(requests).toEqual([1, 3])
		expect(JSON.parse(await new Response(child.stdout).text())).toEqual({
			jsonrpc: "2.0",
			id: 3,
			result: {},
		})
	} finally {
		child.kill()
		server.stop(true)
	}
})

test("legacy MCP proxy silently reinitializes expired sessions and retries once", async () => {
	let initializations = 0
	let sessions: (string | null)[] = []
	let server = Bun.serve({
		port: 0,
		async fetch(request) {
			let message = object(await request.json())
			sessions.push(request.headers.get("mcp-session-id"))
			if (message.method === "initialize") {
				initializations++
				return Response.json(
					{
						jsonrpc: "2.0",
						id: message.id,
						result: {
							protocolVersion: "2025-11-25",
							capabilities: {},
							serverInfo: { name: "session-test", version: "1" },
						},
					},
					{
						headers: {
							"mcp-session-id": initializations === 1 ? "initial" : "renewed",
						},
					},
				)
			}
			if (message.method === "notifications/initialized")
				return new Response(null, { status: 202 })
			if (initializations === 1) return new Response(null, { status: 404 })
			return Response.json({
				jsonrpc: "2.0",
				id: message.id,
				result: { tools: [] },
			})
		},
	})
	try {
		let input = [
			{
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2025-11-25",
					capabilities: {},
					clientInfo: { name: "session-test", version: "1" },
				},
			},
			{ jsonrpc: "2.0", method: "notifications/initialized" },
			{ jsonrpc: "2.0", id: 2, method: "tools/list" },
		]
			.map(frame => JSON.stringify(frame))
			.join("\n")
		let result = await proxy(input, "session-token", server.url.href)
		expect(result.status).toBe(0)
		let replies = result.output
			.trim()
			.split("\n")
			.map(line => object(JSON.parse(line)))
		expect(replies.map(reply => reply.id)).toEqual([1, 2])
		expect(object(replies[1]?.result).tools).toEqual([])
		expect(sessions).toEqual([
			null,
			"initial",
			"initial",
			null,
			"renewed",
			"renewed",
		])
		expect(initializations).toBe(2)
	} finally {
		await server.stop(true)
	}
})

test("legacy MCP recovery retries an expired request at most once", async () => {
	let initializations = 0
	let calls = 0
	let server = Bun.serve({
		port: 0,
		async fetch(request) {
			let message = object(await request.json())
			if (message.method === "initialize") {
				initializations++
				return Response.json(
					{
						jsonrpc: "2.0",
						id: message.id,
						result: {
							protocolVersion: "2025-11-25",
							capabilities: {},
							serverInfo: { name: "retry-test", version: "1" },
						},
					},
					{ headers: { "mcp-session-id": "session-" + initializations } },
				)
			}
			calls++
			return new Response(null, { status: 404 })
		},
	})
	try {
		let input = [
			{
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2025-11-25",
					capabilities: {},
					clientInfo: { name: "retry-test", version: "1" },
				},
			},
			{ jsonrpc: "2.0", id: 2, method: "tools/list" },
		]
			.map(frame => JSON.stringify(frame))
			.join("\n")
		let result = await proxy(input, "session-token", server.url.href)
		expect(result.status).toBe(0)
		let replies = result.output
			.trim()
			.split("\n")
			.map(line => object(JSON.parse(line)))
		expect(replies.map(reply => reply.id)).toEqual([1, 2])
		expect(object(replies[1]?.error).message).toContain("initialize again")
		expect(initializations).toBe(2)
		expect(calls).toBe(2)
	} finally {
		await server.stop(true)
	}
})

test("an expired legacy notification cannot strand later proxy requests", async () => {
	let initializations = 0
	let server = Bun.serve({
		port: 0,
		async fetch(request) {
			let message = object(await request.json())
			if (message.method === "initialize") {
				initializations++
				return Response.json(
					{
						jsonrpc: "2.0",
						id: message.id,
						result: {
							protocolVersion: "2025-11-25",
							capabilities: {},
							serverInfo: { name: "notification-recovery", version: "1" },
						},
					},
					{ headers: { "mcp-session-id": "session-" + initializations } },
				)
			}
			if (message.method === "notifications/initialized")
				return new Response(null, { status: 202 })
			if (initializations === 1) return new Response(null, { status: 404 })
			return Response.json({
				jsonrpc: "2.0",
				id: message.id,
				result: { tools: [] },
			})
		},
	})
	try {
		let input = [
			{
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2025-11-25",
					capabilities: {},
					clientInfo: { name: "notification-recovery", version: "1" },
				},
			},
			{ jsonrpc: "2.0", method: "notifications/initialized" },
			{ jsonrpc: "2.0", method: "notifications/roots/list_changed" },
			{ jsonrpc: "2.0", id: 2, method: "tools/list" },
		]
			.map(frame => JSON.stringify(frame))
			.join("\n")
		let result = await proxy(input, "session-token", server.url.href)
		expect(result.status).toBe(0)
		let replies = result.output
			.trim()
			.split("\n")
			.map(line => object(JSON.parse(line)))
		expect(replies.map(reply => reply.id)).toEqual([1, 2])
		expect(object(replies[1]?.result).tools).toEqual([])
		expect(initializations).toBe(2)
	} finally {
		await server.stop(true)
	}
})

test("a failed recovery notification leaves the old session available for another recovery", async () => {
	let initializations = 0
	let server = Bun.serve({
		port: 0,
		async fetch(request) {
			let message = object(await request.json())
			if (message.method === "initialize") {
				initializations++
				return Response.json(
					{
						jsonrpc: "2.0",
						id: message.id,
						result: {
							protocolVersion: "2025-11-25",
							capabilities: {},
							serverInfo: { name: "notification-failure", version: "1" },
						},
					},
					{ headers: { "mcp-session-id": "session-" + initializations } },
				)
			}
			if (message.method === "notifications/initialized")
				return new Response(null, { status: initializations === 2 ? 500 : 202 })
			if (request.headers.get("mcp-session-id") === "session-1")
				return new Response(null, { status: 404 })
			return Response.json({
				jsonrpc: "2.0",
				id: message.id,
				result: { tools: [] },
			})
		},
	})
	try {
		let input = [
			{
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2025-11-25",
					capabilities: {},
					clientInfo: { name: "notification-failure", version: "1" },
				},
			},
			{ jsonrpc: "2.0", method: "notifications/initialized" },
			{ jsonrpc: "2.0", id: 2, method: "tools/list" },
			{ jsonrpc: "2.0", id: 3, method: "tools/list" },
		]
			.map(frame => JSON.stringify(frame))
			.join("\n")
		let result = await proxy(input, "session-token", server.url.href)
		expect(result.status).toBe(0)
		let replies = result.output
			.trim()
			.split("\n")
			.map(line => object(JSON.parse(line)))
		expect(replies.map(reply => reply.id)).toEqual([1, 2, 3])
		expect(object(replies[1]?.error).message).toContain("notification failed")
		expect(object(replies[2]?.result).tools).toEqual([])
		expect(initializations).toBe(3)
	} finally {
		await server.stop(true)
	}
})

test("MCP API-key transport preserves a server path prefix and refuses redirects", async () => {
	let paths: string[] = []
	let destinationRequests = 0
	let destination = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		fetch() {
			destinationRequests++
			return Response.json({})
		},
	})
	let redirect = false
	let gateway = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		fetch(request) {
			paths.push(new URL(request.url).pathname)
			return redirect
				? new Response(null, {
						status: 302,
						headers: { Location: destination.url.href },
					})
				: Response.json({ jsonrpc: "2.0", id: 1, result: { tools: [] } })
		},
	})
	let request = JSON.stringify({
		jsonrpc: "2.0",
		id: 1,
		method: "tools/list",
		params: {
			_meta: {
				"io.modelcontextprotocol/protocolVersion": "2026-07-28",
				"io.modelcontextprotocol/clientCapabilities": {},
			},
		},
	})
	try {
		let result = await proxy(request, token, gateway.url.href + "prefix", true)
		expect(result.status).toBe(0)
		expect(object(JSON.parse(result.output)).result).toEqual({ tools: [] })
		expect(paths).toEqual(["/prefix/mcp"])
		redirect = true
		let refused = await proxy(request, token, gateway.url.href + "prefix", true)
		expect(object(JSON.parse(refused.output)).error).toBeDefined()
		expect(destinationRequests).toBe(0)
		expect(refused.output + refused.error).not.toContain(token)
	} finally {
		gateway.stop(true)
		destination.stop(true)
	}
})
