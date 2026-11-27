import { afterEach, expect, test, vi } from "vitest"
import {
	fetchClientMetadata,
	configureCloudflareMetadataFetch,
} from "./client-metadata"

afterEach(() => configureCloudflareMetadataFetch(undefined))

test("Cloudflare metadata uses public fetch without following redirects", async () => {
	let fetcher = vi
		.fn<typeof fetch>()
		.mockResolvedValue(new Response('{"client_name":"Client"}'))
	configureCloudflareMetadataFetch(fetcher)
	await expect(
		fetchClientMetadata(new URL("https://client.example/metadata.json")),
	).resolves.toEqual({ client_name: "Client" })
	expect(fetcher).toHaveBeenCalledWith(
		new URL("https://client.example/metadata.json"),
		expect.objectContaining({
			redirect: "manual",
			signal: expect.any(AbortSignal),
		}),
	)
})

test.each([
	"http://client.example/metadata.json",
	"https://127.0.0.1/metadata.json",
])("rejects unsafe metadata URL %s before network access", async address => {
	let fetcher = vi.fn<typeof fetch>()
	configureCloudflareMetadataFetch(fetcher)
	await expect(fetchClientMetadata(new URL(address))).rejects.toThrow(
		"invalid_client",
	)
	expect(fetcher).not.toHaveBeenCalled()
})

test("rejects redirect responses instead of fetching their destination", async () => {
	let fetcher = vi.fn<typeof fetch>().mockResolvedValue(
		new Response(null, {
			status: 302,
			headers: { location: "https://127.0.0.1" },
		}),
	)
	configureCloudflareMetadataFetch(fetcher)
	await expect(
		fetchClientMetadata(new URL("https://client.example/metadata.json")),
	).rejects.toThrow("invalid_client")
	expect(fetcher).toHaveBeenCalledTimes(1)
})

test("limits streamed metadata and cancels an oversized response", async () => {
	let cancel = vi.fn()
	let body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new Uint8Array(64 * 1024 + 1))
		},
		cancel,
	})
	let fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body))
	configureCloudflareMetadataFetch(fetcher)
	await expect(
		fetchClientMetadata(new URL("https://client.example/metadata.json")),
	).rejects.toThrow("invalid_client")
	expect(cancel).toHaveBeenCalledOnce()
})
