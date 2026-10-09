import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type { ApplicationError } from "../platform/errors"

export class StaticAssets extends Context.Service<
	StaticAssets,
	{ serve: (request: Request) => Effect.Effect<Response, ApplicationError> }
>()("alkalye/StaticAssets") {}

export function assetRequest(request: Request) {
	let url = new URL(request.url)
	if (url.pathname === "/") url.pathname = "/index.html"
	else if (
		[
			"/en",
			"/de",
			"/privacy",
			"/terms",
			"/imprint",
			"/support",
			"/changelog",
		].includes(url.pathname)
	)
		url.pathname += ".html"
	else if (
		url.pathname === "/app" ||
		url.pathname.startsWith("/app/") ||
		url.pathname === "/invite"
	)
		url.pathname = "/app.html"
	return new Request(url, request)
}

export function assetHeaders(request: Request) {
	return {
		"Cache-Control": new URL(request.url).pathname.startsWith("/chunks/")
			? "public, max-age=31536000, immutable"
			: "no-cache",
		"X-Content-Type-Options": "nosniff",
		"Content-Security-Policy":
			"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https:; media-src 'self' blob: data: https:; font-src 'self' data: https:; connect-src 'self' ws: wss:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
	}
}
