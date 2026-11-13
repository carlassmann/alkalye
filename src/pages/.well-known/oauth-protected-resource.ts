import type { APIRoute } from "astro"
// v2-todo(agents-mcp): restore discovery after the v2 API port.
export const prerender = false
export let ALL: APIRoute = () => new Response("Unavailable during Jazz v2 migration", { status: 503 })
