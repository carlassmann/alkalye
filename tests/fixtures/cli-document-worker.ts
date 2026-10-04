import * as Effect from "effect/Effect"
import { cliDocumentSessionLayer } from "../../src/cli/document-platform"
import { DocumentSession } from "../../src/shared/document-session"
import { newComment } from "../../src/shared/documents"

let directory = process.argv[2]
let subject = process.argv[3]
if (!directory || !subject) throw new Error("Missing fixture arguments")
await Effect.runPromise(
	Effect.scoped(
		DocumentSession.use(session =>
			session.change("Process comment", staged =>
				newComment(
					staged,
					"process-comment",
					"doc",
					"Second",
					"From another process",
					"CLI",
				),
			),
		).pipe(
			Effect.provide(
				cliDocumentSessionLayer(directory, {
					document: "doc",
					subject,
					transport: {
						snapshot: () => Effect.fail(new Error("Offline")),
						commit: () => Effect.fail(new Error("Offline")),
						history: () => Effect.fail(new Error("Offline")),
					},
				}),
			),
		),
	),
)
