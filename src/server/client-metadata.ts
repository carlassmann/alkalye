import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import * as Cache from "effect/Cache"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import { attempt } from "../platform/effects"
import type { ApplicationError, NetworkError } from "../platform/errors"
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
export class ClientMetadata extends Context.Service<
	ClientMetadata,
	{
		load: (
			id: string,
		) => Effect.Effect<
			{ name: string; redirects: string[] },
			NetworkError | ApplicationError
		>
	}
>()("alkalye/ClientMetadata") {}

export function clientMetadata(id: string) {
	return Effect.flatMap(ClientMetadata, service => service.load(id))
}
export function clientMetadataLayer(
	read: (url: URL) => Effect.Effect<string, NetworkError | ApplicationError>,
) {
	return Layer.effect(
		ClientMetadata,
		Effect.gen(function* () {
			let cache = yield* Cache.makeWith(
				(id: string) => loadMetadata(id, read),
				{
					capacity: 256,
					timeToLive: exit =>
						Exit.isSuccess(exit) ? "5 minutes" : Duration.zero,
				},
			)
			return { load: (id: string) => Cache.get(cache, id) }
		}),
	)
}
function loadMetadata(
	id: string,
	read: (url: URL) => Effect.Effect<string, NetworkError | ApplicationError>,
) {
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
		let body = yield* read(url)
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
