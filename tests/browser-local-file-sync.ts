import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { syncLocalFile } from "../src/client/local-file-sync"
import {
	browserDocumentSessionLayer,
	DocumentSession,
} from "../src/client/document-session"
import { makeDocumentTransport } from "../src/client/document-transport"
import { LocalDocumentFailure } from "../src/client/document-failures"
import { Storage } from "../src/client/storage"
import { buildAction } from "../src/shared/document-actions"
import { Replica } from "../src/shared/crdt"
import { newDocument } from "../src/shared/documents"

type Check = (value: unknown, message: string) => void

export function verifyLocalFileSync(subject: string, check: Check) {
	return Effect.gen(function* () {
		yield* scenario(
			"missing-base",
			"Original",
			"Editor version",
			"Disk version",
			undefined,
		)
		yield* scenario(
			"conflict",
			"Original",
			"Editor version",
			"Disk version",
			"Original",
		)
		yield* scenario(
			"disk-race",
			"Alpha\nBeta\nGamma\n",
			"Alpha local\nBeta\nGamma\n",
			"Alpha\nBeta disk\nGamma\n",
			"Alpha\nBeta\nGamma\n",
		)
		yield* scenario(
			"journal-failure",
			"Original",
			"Original",
			"Disk version",
			"Original",
		)
		yield* scenario(
			"adjacent-edits",
			"red blue",
			"RED blue",
			"red BLUE",
			"red blue",
		)
		function scenario(
			name: string,
			initial: string,
			local: string,
			disk: string,
			base: string | undefined,
		) {
			return Effect.scoped(
				Effect.gen(function* () {
					let document = "local-sync-" + name
					let transport = yield* makeDocumentTransport(location.origin, subject)
					let action = yield* buildAction(
						new Replica(subject + "-" + name),
						document,
						"Create document",
						staged => newDocument(staged, document, "Untitled", initial),
					)
					let context = yield* Layer.build(
						browserDocumentSessionLayer({
							document,
							subject,
							transport,
							initialCreation: {
								subject,
								workspace: "personal-" + subject,
								action,
							},
						}),
					)
					let session = Context.get(context, DocumentSession)
					yield* session.edit(local).saved
					let storage = yield* Effect.acquireRelease(Storage.open(), storage =>
						Effect.sync(() => storage.close()),
					)
					let baseKey = "local-file-base:" + document
					if (base !== undefined) yield* storage.set(baseKey, base)
					let writes: string[] = []
					let modified = 1
					let raced = false
					let change: typeof session.change = (label, command) => {
						if (name === "journal-failure")
							return Effect.fail(
								new LocalDocumentFailure({
									operation: "append",
									message: "Journal write failed",
									retryable: false,
								}),
							)
						return session.change(label, command).pipe(
							Effect.tap(() =>
								Effect.sync(() => {
									if (name === "disk-race" && !raced) {
										raced = true
										disk = "Alpha\nBeta disk\nGamma external\n"
										modified++
									}
								}),
							),
						)
					}
					let syncing = yield* syncLocalFile({
						document,
						session: {
							replica: session.replica,
							change,
							flush: session.flush,
							changes: session.changes,
						},
						storage,
						folders: {
							read: () =>
								Effect.sync(() => ({ content: disk, lastModified: modified })),
							write: (_document, content) =>
								Effect.sync(() => {
									writes.push(content)
									disk = content
									return ++modified
								}),
						},
					})
					if (name === "missing-base" || name === "conflict") {
						check(
							syncing.current().status === "conflict" &&
								writes.length === 0 &&
								disk === "Disk version" &&
								session.replica.text(document) === "Editor version",
							name === "missing-base"
								? "a local file without an agreed merge base preserves both different versions instead of overwriting the disk"
								: "overlapping local file edits preserve the editor and disk versions without writing",
						)
					} else if (name === "journal-failure") {
						check(
							syncing.current().status === "error" &&
								syncing.current().message === "Journal write failed" &&
								writes.length === 0 &&
								disk === "Disk version" &&
								session.replica.text(document) === "Original",
							"a disk merge reports durable journal failure as an error, preserving both source versions",
						)
					} else {
						let expected =
							name === "disk-race"
								? "Alpha local\nBeta disk\nGamma external\n"
								: "RED BLUE"
						check(
							syncing.current().status === "saved" &&
								disk === expected &&
								session.replica.text(document) === expected &&
								writes.every(content => content === expected) &&
								(yield* storage.get(baseKey)) === expected,
							name === "disk-race"
								? "a disk edit during a durable editor merge is reread and preserved before any disk write"
								: "independent edits on the same local-file line merge through the durable document session",
						)
					}
				}),
			)
		}
	})
}
