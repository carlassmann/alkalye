import * as Cache from "effect/Cache"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import { lookup } from "node:dns/promises"
import { request } from "node:https"
import { isIP } from "node:net"
import { attempt, promise } from "../platform/effects"
import { NetworkError } from "../platform/errors"
import { array, object, string } from "../shared/model"

export function redirectUris(value: unknown) {
	let redirects = array(value).map(string)
	if (!redirects.length || redirects.length > 10)
		throw new Error("Provide redirect URIs")
	for (let value of redirects) {
		let redirect = new URL(value)
		if (
			redirect.hash ||
			redirect.username ||
			redirect.password ||
			(redirect.protocol !== "https:" &&
				!(
					redirect.protocol === "http:" &&
					["127.0.0.1", "localhost", "[::1]"].includes(redirect.hostname)
				))
		)
			throw new Error("Use HTTPS or a loopback redirect URI")
	}
	return redirects
}
let metadataCache = Effect.runSync(
	Cache.makeWith(loadMetadata, {
		capacity: 256,
		timeToLive: exit => (Exit.isSuccess(exit) ? "5 minutes" : Duration.zero),
	}),
)
export function clientMetadata(id: string) {
	return Cache.get(metadataCache, id)
}
function loadMetadata(id: string) {
	return Effect.gen(function* () {
		let url = yield* attempt("metadata.url", () => {
			let url = new URL(id)
			if (
				url.protocol !== "https:" ||
				url.username ||
				url.password ||
				url.hash ||
				url.pathname === "/"
			)
				throw new Error("Use an HTTPS client metadata URL")
			return url
		})
		let addresses = yield* promise("metadata.dns", () =>
			lookup(url.hostname, { all: true }),
		)
		if (
			!addresses.length ||
			addresses.some(address => !publicAddress(address.address))
		)
			return yield* Effect.fail(
				new NetworkError({
					operation: "metadata.dns",
					cause: new Error(
						"Client metadata must be hosted on the public internet",
					),
				}),
			)
		let address =
			addresses.find(address => address.family === 4) ?? addresses[0]
		if (!address)
			return yield* Effect.fail(
				new NetworkError({
					operation: "metadata.dns",
					cause: new Error("Client metadata unavailable"),
				}),
			)
		let body = yield* readMetadata(url, address.address)
		return yield* attempt("metadata.parse", () => {
			let metadata = object(JSON.parse(body))
			if (
				metadata.client_id !== id ||
				(metadata.token_endpoint_auth_method ?? "none") !== "none"
			)
				throw new Error("Invalid public client metadata")
			return {
				name:
					typeof metadata.client_name === "string"
						? metadata.client_name
						: url.hostname,
				redirects: redirectUris(metadata.redirect_uris),
			}
		})
	})
}
function readMetadata(url: URL, address: string) {
	return Effect.callback<string, NetworkError>(resume => {
		function fail(cause: unknown) {
			resume(
				Effect.fail(new NetworkError({ operation: "metadata.request", cause })),
			)
		}
		let outgoing = request(
			{
				hostname: address,
				port: url.port || 443,
				servername: url.hostname,
				path: url.pathname + url.search,
				method: "GET",
				headers: { Host: url.host, Accept: "application/json" },
			},
			response => {
				if (response.statusCode !== 200) {
					response.resume()
					fail(new Error("Client metadata request failed"))
					return
				}
				let chunks: Buffer[] = [],
					length = 0
				response.on("data", (chunk: Buffer) => {
					length += chunk.length
					if (length > 128_000)
						outgoing.destroy(new Error("Client metadata is too large"))
					else chunks.push(chunk)
				})
				response.on("error", fail)
				response.on("end", () =>
					resume(Effect.succeed(Buffer.concat(chunks).toString("utf8"))),
				)
			},
		)
		outgoing.on("error", fail)
		outgoing.end()
		return Effect.sync(() => {
			outgoing.destroy()
		})
	}).pipe(
		Effect.timeoutOrElse({
			duration: "5 seconds",
			orElse: () =>
				Effect.fail(
					new NetworkError({
						operation: "metadata.request",
						cause: new Error("Client metadata timed out"),
					}),
				),
		}),
	)
}
export function publicAddress(address: string) {
	if (isIP(address) === 6) {
		let lower = address.toLowerCase()
		return (
			/^[23][0-9a-f]{3}:/.test(lower) &&
			!lower.startsWith("2001:db8:") &&
			!lower.startsWith("2001:0:") &&
			!lower.startsWith("2002:")
		)
	}
	if (isIP(address) !== 4) return false
	let [first = 0, second = 0] = address.split(".").map(Number)
	return (
		first !== 0 &&
		first !== 10 &&
		first !== 127 &&
		first < 224 &&
		!(first === 169 && second === 254) &&
		!(first === 172 && second >= 16 && second <= 31) &&
		!(first === 192 && (second === 168 || second === 0)) &&
		!(first === 100 && second >= 64 && second <= 127) &&
		!(first === 198 && (second === 18 || second === 19 || second === 51)) &&
		!(first === 203 && second === 0)
	)
}
