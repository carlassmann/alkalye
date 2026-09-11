import type { APIRoute } from "astro"
import { ALKALYE_OPENAI_APPS_CHALLENGE } from "astro:env/server"
import { challengeResponse } from "@/mcp/metadata"

export { GET }

export const prerender = false

let GET: APIRoute = () => challengeResponse(ALKALYE_OPENAI_APPS_CHALLENGE)
