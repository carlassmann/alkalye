import type { APIRoute } from "astro"
import { jazz } from "../../jazz/server"

export const prerender = false
export let ALL: APIRoute = ({ request }) => jazz.handle(request)
