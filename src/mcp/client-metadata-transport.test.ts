import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import type { LookupFunction } from "node:net"
import { afterEach, describe, expect, test, vi } from "vitest"
import { fetchClientMetadata } from "./client-metadata"

let mocks = vi.hoisted(() => ({ get: vi.fn(), lookup: vi.fn() }))
vi.mock("node:https", () => ({ get: mocks.get, default: { get: mocks.get } }))
vi.mock("node:dns", () => ({
	lookup: mocks.lookup,
	default: { lookup: mocks.lookup },
}))
afterEach(() => vi.resetAllMocks())

function mockTransport(body: string, statusCode = 200, address = "8.8.8.8") {
	let response = Object.assign(new PassThrough(), { statusCode })
	mocks.lookup.mockImplementation((_hostname, _options, callback) => {
		callback(null, [{ address, family: 4 }])
	})
	mocks.get.mockImplementation(
		(
			url: URL,
			options: { lookup: LookupFunction },
			onResponse: (incoming: typeof response) => void,
		) => {
			let request = new EventEmitter()
			queueMicrotask(() => {
				options.lookup(url.hostname, { all: true }, error => {
					if (error) {
						request.emit("error", error)
						return
					}
					onResponse(response)
					response.end(body)
				})
			})
			return request
		},
	)
	return response
}

describe("client metadata HTTPS transport", () => {
	test("fetches JSON through the validated socket lookup", async () => {
		mockTransport('{"client_name":"Custom MCP client"}')
		await expect(
			fetchClientMetadata(new URL("https://custom.example/client.json")),
		).resolves.toEqual({ client_name: "Custom MCP client" })
		expect(mocks.get).toHaveBeenCalledWith(
			new URL("https://custom.example/client.json"),
			expect.objectContaining({ agent: false, lookup: expect.any(Function) }),
			expect.any(Function),
		)
	})

	test("blocks hostnames resolving to private addresses", async () => {
		mockTransport("{}", 200, "127.0.0.1")
		await expect(
			fetchClientMetadata(new URL("https://custom.example/client.json")),
		).rejects.toThrow("invalid_client")
	})

	test.each([302, 404, 500])(
		"rejects HTTP %s without following redirects",
		async status => {
			mockTransport("{}", status)
			await expect(
				fetchClientMetadata(new URL("https://custom.example/client.json")),
			).rejects.toThrow("invalid_client")
			expect(mocks.get).toHaveBeenCalledTimes(1)
		},
	)

	test("rejects oversized metadata documents", async () => {
		mockTransport(" ".repeat(64 * 1024 + 1))
		await expect(
			fetchClientMetadata(new URL("https://custom.example/client.json")),
		).rejects.toThrow("invalid_client")
	})

	test("rejects malformed JSON", async () => {
		mockTransport("invalid JSON")
		await expect(
			fetchClientMetadata(new URL("https://custom.example/client.json")),
		).rejects.toThrow()
	})
})
