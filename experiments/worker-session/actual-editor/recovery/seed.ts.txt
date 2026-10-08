import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { accountHeader } from "./src/shared/authentication"
import { buildAction } from "./src/shared/document-actions"
import { Replica } from "./src/shared/crdt"
import { newDocument } from "./src/shared/documents"
import { personalWorkspaceRequest } from "./src/shared/workspace"

let input = Schema.Struct({
	subject: Schema.String,
	document: Schema.String,
	source: Schema.String,
})

export async function provisionFixture(
	request: Request,
	backend: URL,
	origin: string,
) {
	let parsed = Schema.decodeUnknownResult(input)(await request.json())
	if (parsed._tag === "Failure")
		return new Response("Invalid fixture seed", { status: 400 })
	let { subject, document, source } = parsed.success
	let headers = new Headers(request.headers)
	headers.set("content-type", "application/json")
	headers.set("host", new URL(origin).host)
	headers.set(accountHeader, subject)
	let workspace = "personal-" + subject
	let space = await fetch(new URL("/api/workspaces", backend), {
		method: "POST",
		headers,
		body: JSON.stringify({
			workspace,
			name: "Personal",
			request: personalWorkspaceRequest,
		}),
	})
	if (!space.ok) return new Response(space.body, { status: space.status })
	let action = await Effect.runPromise(
		buildAction(
			new Replica(subject + "-fixture", subject),
			document,
			"Fixture seed",
			replica => newDocument(replica, document, "Worker fixture", source),
		),
	)
	let created = await fetch(new URL("/api/documents", backend), {
		method: "POST",
		headers,
		body: JSON.stringify({ workspace, action }),
	})
	if (!created.ok) return new Response(created.body, { status: created.status })
	return Response.json({ document, source })
}
