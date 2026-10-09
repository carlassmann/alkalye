import * as Layer from "effect/Layer"
import { promise } from "../platform/effects"
import {
	StaticAssets,
	assetRequest,
	assetHeaders,
} from "../server/static-assets"

export function cloudflareAssetsLayer(binding: Fetcher) {
	return Layer.succeed(StaticAssets, {
		serve(request: Request) {
			return cloudflareAsset(request, binding)
		},
	})
}

export function cloudflareAsset(request: Request, binding: Fetcher) {
	return promise("assets.fetch", async signal => {
		let response = await binding.fetch(
			new Request(assetRequest(request), { signal }),
		)
		let headers = new Headers(response.headers)
		for (let [name, value] of Object.entries(assetHeaders(request)))
			headers.set(name, value)
		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers,
		})
	})
}
