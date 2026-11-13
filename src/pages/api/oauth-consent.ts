import type { APIRoute } from "astro"
// v2-todo(agents-mcp): restore OAuth routes with v2 sessions.
export const prerender = false
export let ALL: APIRoute = () => new Response("Unavailable during Jazz v2 migration", { status: 503 })
