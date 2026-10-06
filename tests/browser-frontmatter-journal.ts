import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import {
	browserDocumentSessionLayer,
	DocumentSession,
} from "../src/client/document-session"
import { buildAction } from "../src/shared/document-actions"
import { historicalDocument } from "../src/shared/document-history"
import { newDocument } from "../src/shared/documents"
import { Replica } from "../src/shared/crdt"
import { frontmatter } from "../src/shared/markdown"
import { parseCheckpoint } from "../src/shared/checkpoint"
import { mergeText } from "../src/shared/text-merge"

export function verifyFrontmatterJournal(
	subject: string,
	check: (value: unknown, message: string) => void,
) {
	return Effect.gen(function* () {
		for (let scenario of [
			{
				name: "comments",
				initial: "---\n# c\ntitle: T\n---\nBody",
				first: "---\n# c\ntitle: Peer\n---\nBody",
				second: "---\n# d\ntitle: T\n---\nBody",
				title: "Peer",
				body: "Body",
			},
			{
				name: "ending",
				initial: "---\ntitle: T\n---",
				first: "---\ntitle: Peer\n---",
				second: "---\ntitle: T\n---\n",
				title: "Peer",
				body: "",
			},
			{
				name: "separator",
				initial: "Body",
				first: "---\ntitle: X\n---\nBody",
				second: "---\nBody",
				title: "X",
				body: "---\nBody",
			},
			{
				name: "aliases",
				initial: "---\ntitle: T\n---\nBody",
				first: "---\ntitle: &n T\nalias: *n\n---\nBody",
				second: "---\ntitle: Z\n---\nBody",
				title: "Z",
				body: "Body",
			},
			{
				name: "deleted-anchor",
				initial: "---\ntitle: &n T\nx: 1\n---\nBody",
				first: "---\ntitle: &n T\nx: 1\nalias: *n\n---\nBody",
				second: "---\nx: 1\n---\nBody",
				title: "Untitled",
				body: "Body",
			},
			{
				name: "deleted-existing-alias",
				initial: "---\ntitle: &n T\nx: 1\nalias: 1\n---\nBody",
				first: "---\ntitle: &n T\nx: 1\nalias: *n\n---\nBody",
				second: "---\nx: 1\nalias: 1\n---\nBody",
				title: "Untitled",
				body: "Body",
			},
			{
				name: "undone-anchor",
				initial: "---\ntitle: T\nx: 1\n---\nBody",
				first: "---\ntitle: T\nx: 1\nalias: *n\n---\nBody",
				second: "---\nx: 1\n---\nBody",
				title: "Untitled",
				body: "Body",
			},
		]) {
			let document = "frontmatter-journal-" + scenario.name
			let transport = {
				snapshot: () =>
					Effect.die(new Error("Folder history must not access the network")),
				commit: () =>
					Effect.die(new Error("Folder history must not access the network")),
				history: () => Effect.succeed([]),
			}
			let initial = yield* buildAction(
				new Replica(subject + "-base"),
				document,
				"Open file",
				staged => newDocument(staged, document, "Untitled", scenario.initial),
			)
			let expected = yield* Effect.scoped(
				Effect.gen(function* () {
					let context = yield* Layer.build(
						browserDocumentSessionLayer({
							document,
							subject,
							historyOrigin: "local",
							transport,
							initialCreation: {
								subject,
								workspace: "folder",
								action: initial,
							},
						}),
					)
					let session = Context.get(context, DocumentSession)
					if (scenario.name === "undone-anchor") {
						yield* session.edit("---\ntitle: &n T\nx: 1\n---\nBody").saved
						yield* session.undo()
						yield* session.flush
						if (session.replica.text(document).includes("&n"))
							return yield* Effect.die(new Error("Anchor undo failed"))
					}
					let peerContext = yield* Layer.build(
						browserDocumentSessionLayer({
							document,
							subject,
							historyOrigin: "local",
							transport,
						}),
					)
					let peer = Context.get(peerContext, DocumentSession)
					let edits = [session.edit(scenario.first), peer.edit(scenario.second)]
					for (let edit of edits) yield* edit.saved
					yield* session.replay
					yield* peer.replay
					if (session.replica.text(document) !== peer.replica.text(document))
						return yield* Effect.die(
							new Error("Concurrent sessions did not converge"),
						)
					return session.replica.text(document)
				}),
			)
			yield* Effect.scoped(
				Effect.gen(function* () {
					let context = yield* Layer.build(
						browserDocumentSessionLayer({
							document,
							subject,
							historyOrigin: "local",
							transport,
						}),
					)
					let session = Context.get(context, DocumentSession)
					let moments = yield* session.localHistory()
					if (!moments)
						return yield* Effect.die(new Error("Missing local history"))
					let historical = yield* historicalDocument(
						document,
						moments,
						moments.length,
					)
					let observed = session
						.pending()
						.flatMap(action =>
							action.changes.flatMap(change =>
								change.insert.flatMap(atom =>
									atom.observed ? [atom.observed] : [],
								),
							),
						)
					check(
						moments.length === (scenario.name === "undone-anchor" ? 5 : 3) &&
							historical.text(document) === expected &&
							session.replica.text(document) === expected &&
							(scenario.name === "aliases"
								? ["T", "Z"].includes(session.replica.metadata(document).title)
								: session.replica.metadata(document).title ===
									scenario.title) &&
							frontmatter(expected).body === scenario.body &&
							(scenario.name !== "undone-anchor" ||
								expected.includes("alias: *n")) &&
							(!scenario.name.startsWith("deleted-") ||
								(frontmatter(expected).data.x === 1 &&
									!Object.hasOwn(frontmatter(expected).data, "alias") &&
									observed.length > 0 &&
									observed.every(Object.isFrozen))),
						"durable offline " +
							scenario.name +
							" edits retain convergent frontmatter through cold replay and Time machine",
					)
				}),
			)
		}
	})
}

export function verifyLargeDocumentSources(
	check: (value: unknown, message: string) => void,
) {
	let source = "---\ntitle: Large document\n---\n".padEnd(200_000, "x")
	let document = new Replica("large-source")
	document.edit("doc", source)
	let restored = new Replica("large-restored")
	restored.restore(
		parseCheckpoint(JSON.parse(JSON.stringify(document.checkpoint()))),
	)
	check(
		restored.text("doc") === source,
		"a 200,000-character frontmatter document survives its checkpoint without exceeding browser argument limits",
	)
	restored.edit("doc", "---\ntitle: Large document\n---\n")
	check(
		restored.text("doc") === "---\ntitle: Large document\n---\n",
		"deleting a large body preserves its header without exceeding browser argument limits",
	)
	let base = "left\nright"
	let local = "ours\n" + base
	let disk = base + "\n" + "x".repeat(131_072)
	let merged = mergeText(base, local, disk)
	check(
		!merged.conflict && merged.content === "ours\n" + disk,
		"local file merging preserves an independent 128 KB insertion without exceeding browser argument limits",
	)
}
