import type { APIRoute } from "astro"
export { GET }
export const prerender = false
let GET: APIRoute = ({ request }) =>
	Response.json({
		baseUrl: new URL(request.url).origin,
		jazzUrl: new URL("/jazz", request.url).href,
		authentication: "device-recovery-phrase",
	})
