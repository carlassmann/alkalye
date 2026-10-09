import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import {
	clientMetadata,
	clientMetadataLayer,
} from "../src/server/client-metadata"
import { bunClientMetadataLayer } from "../src/server/bun-client-metadata"
import { cloudflareClientMetadataLayer } from "../src/cloudflare/client-metadata"
import { NetworkError } from "../src/platform/errors"

test("OAuth metadata validates public clients, caches success and retries failures", async () => {
	let requests = 0
	let layer = clientMetadataLayer(url =>
		Effect.sync(() => {
			requests++
			return JSON.stringify({
				client_id: url.href,
				client_name: "Public client",
				redirect_uris: [
					"https://client.example/callback",
					"http://localhost:3000/callback",
				],
			})
		}),
	)
	await Effect.runPromise(
		Effect.gen(function* () {
			let first = yield* clientMetadata("https://client.example/metadata.json")
			let second = yield* clientMetadata("https://client.example/metadata.json")
			expect(second).toEqual(first)
			expect(first.name).toBe("Public client")
			expect(first.redirects).toHaveLength(2)
			expect(requests).toBe(1)
			for (let id of [
				"http://client.example/metadata.json",
				"https://user@client.example/metadata.json",
				"https://client.example/",
				"https://client.example/metadata.json#secret",
			]) {
				let rejected = yield* clientMetadata(id).pipe(Effect.result)
				expect(rejected._tag).toBe("Failure")
			}
			expect(requests).toBe(1)
		}).pipe(Effect.provide(layer)),
	)
	let attempts = 0
	let retry = clientMetadataLayer(url => {
		attempts++
		return attempts === 1
			? Effect.fail(
					new NetworkError({
						operation: "metadata.request",
						cause: Error("Unavailable"),
					}),
				)
			: Effect.succeed(
					JSON.stringify({
						client_id: url.href,
						redirect_uris: ["https://client.example/callback"],
					}),
				)
	})
	await Effect.runPromise(
		Effect.gen(function* () {
			expect(
				(yield* clientMetadata("https://client.example/metadata.json").pipe(
					Effect.result,
				))._tag,
			).toBe("Failure")
			expect(
				(yield* clientMetadata("https://client.example/metadata.json"))
					.redirects,
			).toEqual(["https://client.example/callback"])
			expect(attempts).toBe(2)
		}).pipe(Effect.provide(retry)),
	)
})

test("OAuth metadata rejects mismatched identities, confidential clients and unsafe redirects", async () => {
	for (let metadata of [
		{
			client_id: "https://other.example/metadata.json",
			redirect_uris: ["https://client.example/callback"],
		},
		{
			client_id: "https://client.example/metadata.json",
			token_endpoint_auth_method: "client_secret_basic",
			redirect_uris: ["https://client.example/callback"],
		},
		{
			client_id: "https://client.example/metadata.json",
			redirect_uris: ["http://private.example/callback"],
		},
		{
			client_id: "https://client.example/metadata.json",
			redirect_uris: ["https://client.example/callback#fragment"],
		},
	]) {
		let result = await Effect.runPromise(
			clientMetadata("https://client.example/metadata.json").pipe(
				Effect.result,
				Effect.provide(
					clientMetadataLayer(() => Effect.succeed(JSON.stringify(metadata))),
				),
			),
		)
		expect(result._tag).toBe("Failure")
	}
})

test("runtime metadata transports reject private DNS and unavailable pinned Worker transport", async () => {
	for (let id of [
		"https://localhost/metadata.json",
		"https://127.0.0.1/metadata.json",
	]) {
		let result = await Effect.runPromise(
			clientMetadata(id).pipe(
				Effect.result,
				Effect.provide(bunClientMetadataLayer),
			),
		)
		expect(result._tag).toBe("Failure")
		if (result._tag === "Failure") {
			expect(result.failure._tag).toBe("NetworkError")
			expect(result.failure.operation).toBe("metadata.dns")
		}
	}
	let result = await Effect.runPromise(
		clientMetadata("https://client.example/metadata.json").pipe(
			Effect.result,
			Effect.provide(cloudflareClientMetadataLayer),
		),
	)
	expect(result._tag).toBe("Failure")
	if (result._tag === "Failure") {
		expect(result.failure._tag).toBe("NetworkError")
		expect(result.failure.message).toContain("register the client")
	}
})
