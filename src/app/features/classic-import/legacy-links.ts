import { z } from "zod"
import { deviceAuthorization } from "@/app/features/agents/lib/agent-api"
export { legacyLinkTarget, resolveLegacyLink }

function legacyLinkTarget(path: string) {
	let match = path.match(
		/\/(doc|spaces|themes)\/(co_z[1-9A-HJ-NP-Za-km-z]+)(?=\/|$)/,
	)
	if (!match) return null
	let kind =
		match[1] === "doc" ? "document" : match[1] === "spaces" ? "space" : "theme"
	return { kind, classicId: match[2]! }
}
async function resolveLegacyLink(
	path: string,
	key: string,
	signal: AbortSignal,
) {
	let target = legacyLinkTarget(path)
	if (!target) return null
	let response = await fetch("/api/classic-import?action=lookup", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...deviceAuthorization(key),
		},
		body: JSON.stringify(target),
		signal,
	})
	if (!response.ok)
		throw new Error("Could not look up Classic link. Retry when connected.")
	let mapping = z
		.object({ id: z.uuid().nullable() })
		.parse(await response.json())
	return mapping.id ? path.replace(target.classicId, mapping.id) : null
}
