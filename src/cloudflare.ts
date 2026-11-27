import "jazz-tools/load-edge-wasm"
import { createExports as createAstroExports } from "@astrojs/cloudflare/entrypoints/server.js"
import type { SSRManifest } from "astro"
import { configureIsolatedUserRuntimes } from "./mcp/jazz"
import { configureCloudflareMetadataFetch } from "./mcp/client-metadata"

export { createExports }

type WorkerFetch = ReturnType<typeof createAstroExports>["default"]["fetch"]

configureIsolatedUserRuntimes()
configureCloudflareMetadataFetch(globalThis.fetch)

function createExports(manifest: SSRManifest) {
	let astro = createAstroExports(manifest).default
	let fetch: WorkerFetch = async (request, environment, context) => {
		let url = new URL(request.url)
		if (url.hostname === "alkalye.com") {
			url.hostname = "www.alkalye.com"
			return Response.redirect(url, 307)
		}
		if (
			url.pathname === "/legal/privacy" ||
			url.pathname === "/de/legal/privacy"
		) {
			return Response.redirect(
				new URL(url.pathname, "https://my.syntwin.ai"),
				302,
			)
		}
		if (
			/^\/(doc|spaces|settings)(\/.*)?$/.test(url.pathname) ||
			/^\/(welcome|new|local)$/.test(url.pathname) ||
			/^\/tutor\/[^/]+$/.test(url.pathname)
		) {
			url.pathname = `/app${url.pathname}`
			return Response.redirect(url, 308)
		}
		if (url.pathname === "/app" || url.pathname.startsWith("/app/")) {
			url.pathname = "/app/"
			return environment.ASSETS.fetch(url.href)
		}
		return astro.fetch(request, environment, context)
	}
	return { default: { fetch } }
}
