import * as Effect from "effect/Effect"
import { promise } from "../platform/effects"

export function serveAsset(
	request: Request,
	path: string,
	headers: HeadersInit,
) {
	return Effect.gen(function* () {
		let file = Bun.file(path)
		if (!(yield* promise("asset.exists", () => file.exists()))) return undefined
		let responseHeaders = new Headers(headers)
		responseHeaders.set("Content-Type", file.type)
		responseHeaders.set("Vary", "Accept-Encoding")
		let compressed = Bun.file(path + ".gz")
		if (
			acceptsGzip(request) &&
			(yield* promise("asset.gzip.exists", () => compressed.exists()))
		) {
			responseHeaders.set("Content-Encoding", "gzip")
			return new Response(compressed, { headers: responseHeaders })
		}
		return new Response(file, { headers: responseHeaders })
	})
}

function acceptsGzip(request: Request) {
	return (request.headers.get("Accept-Encoding") ?? "")
		.split(",")
		.some(value => {
			let [encoding, ...parameters] = value.trim().toLowerCase().split(";")
			if (encoding?.trim() !== "gzip") return false
			let quality = parameters.find(value => value.trim().startsWith("q="))
			return quality === undefined || Number(quality.trim().slice(2)) > 0
		})
}
