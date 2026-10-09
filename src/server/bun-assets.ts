import { resolve, sep } from "node:path"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { StaticAssets, assetRequest, assetHeaders } from "./static-assets"
import { serveAsset } from "./static-files"
import { RelaySettings } from "./settings"
import { attempt } from "../platform/effects"

export let bunAssetsLayer = Layer.effect(
	StaticAssets,
	Effect.gen(function* () {
		let settings = yield* RelaySettings
		return {
			serve(request: Request) {
				return Effect.gen(function* () {
					let url = new URL(assetRequest(request).url)
					let path = yield* attempt("asset.path", () =>
						resolve(settings.assets, `.${decodeURIComponent(url.pathname)}`),
					)
					if (!path.startsWith(settings.assets + sep))
						return new Response("Not found", { status: 404 })
					return (
						(yield* serveAsset(request, path, assetHeaders(request))) ??
						new Response("Not found", { status: 404 })
					)
				})
			},
		}
	}),
)
