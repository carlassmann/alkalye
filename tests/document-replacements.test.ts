import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { cliDocumentSessionLayer } from "../src/cli/document-platform"
import { DocumentSession } from "../src/shared/document-session"
import type { DocumentTransport } from "../src/shared/document-session"
import type { DocumentSnapshot } from "../src/shared/document-actions"
import { Replica } from "../src/shared/crdt"
import { newDocument } from "../src/shared/documents"

test("precise document transactions retain repeated-character intent, concurrent contributions, Unicode, undo and durable reopening", async () => {
	let directory = await mkdtemp(join(tmpdir(), "alkalye-replacements-"))
	let remote = new Replica("birth")
	newDocument(remote, "doc", "", "aaaa 😀 tail")
	let snapshot: DocumentSnapshot = {
		format: "document-state-v1",
		document: "doc",
		log: "replacement-log",
		position: 1,
		state: JSON.stringify(remote.checkpoint()),
	}
	let transport: DocumentTransport = {
		snapshot: () => Effect.succeed(snapshot),
		commit: () => Effect.fail(new Error("Offline")),
		history: () => Effect.succeed([]),
	}
	function open<A, E>(
		work: (session: DocumentSession["Service"]) => Effect.Effect<A, E>,
	) {
		return Effect.scoped(
			Effect.gen(function* () {
				let services = yield* Layer.build(
					cliDocumentSessionLayer(directory, {
						document: "doc",
						subject: "owner",
						transport,
					}),
				)
				return yield* work(Context.get(services, DocumentSession))
			}),
		)
	}
	try {
		await Effect.runPromise(
			open(first =>
				Effect.gen(function* () {
					let base = first.replica.visible("doc")
					yield* open(second =>
						Effect.gen(function* () {
							yield* second.replace([{ start: 0, remove: 0, text: "X" }]).saved
						}),
					)
					yield* first.replay
					let exact = first.replace(
						[
							{ start: 0, remove: 0, text: "" },
							{ start: 0, remove: 1, text: "" },
						],
						base,
					)
					let firstAtom = base[0]
					if (!firstAtom) throw Error("Missing document base")
					expect(exact.operation?.remove).toEqual([firstAtom.id])
					yield* exact.saved
					expect(first.replica.text("doc")).toBe("Xaaa 😀 tail")
					yield* first.replace([
						{ start: 1, remove: 0, text: "1" },
						{ start: 4, remove: 0, text: "2" },
					]).saved
					expect(first.replica.text("doc")).toBe("X1aaa2 😀 tail")
					yield* first.undo()
					expect(first.replica.text("doc")).toBe("Xaaa 😀 tail")
					let invalid = first.replace([{ start: 6, remove: 0, text: "!" }])
					expect(invalid.operation).toBeNull()
					expect((yield* Effect.result(invalid.saved))._tag).toBe("Failure")
					yield* first.replace([{ start: 5, remove: 2, text: "🌟" }]).saved
					expect(first.replica.text("doc")).toBe("Xaaa 🌟 tail")
					for (let changes of [
						[{ start: 0, remove: 0, text: "\uD800" }],
						[
							{ start: 1, remove: 0, text: "1" },
							{ start: 1, remove: 0, text: "2" },
						],
					]) {
						let invalid = first.replace(changes)
						expect((yield* Effect.result(invalid.saved))._tag).toBe("Failure")
						expect(first.replica.text("doc")).toBe("Xaaa 🌟 tail")
					}
					let same = first.replica.visible("doc")
					expect(() =>
						same.push({ id: "fake", after: "", value: "fake" }),
					).toThrow()
					expect(() =>
						Object.defineProperty(same, "0", { value: { id: "fake" } }),
					).toThrow()
					yield* first.replace([
						{ start: 7, remove: 0, text: "A" },
						{ start: 12, remove: 0, text: "B" },
					]).saved
					expect(first.replica.text("doc")).toBe("Xaaa 🌟A tailB")
					yield* first.undo()
					expect(first.replica.text("doc")).toBe("Xaaa 🌟 tail")
				}),
			),
		)
		await Effect.runPromise(
			open(session =>
				Effect.gen(function* () {
					expect(session.replica.text("doc")).toBe("Xaaa 🌟 tail")
					yield* session.replace([
						{
							start: 0,
							remove: 0,
							text: "---\ntitle: First\nmode: present\n---\n",
						},
					]).saved
					let source = session.replica.text("doc")
					yield* session.replace([
						{ start: source.indexOf("First"), remove: 5, text: "Second" },
					]).saved
					expect(session.replica.metadata("doc").title).toBe("Second")
					yield* session.undo()
					expect(session.replica.metadata("doc").title).toBe("First")
				}),
			),
		)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
}, 15000)

test.each([false, true])(
	"frontmatter authoring keeps literal fences and the body anchor through merged snapshots, saves and undo (precise: %s)",
	async precise => {
		for (let scenario of ["empty-fence", "merged-body", "body-fence"]) {
			let directory = await mkdtemp(
				join(tmpdir(), "alkalye-frontmatter-authoring-"),
			)
			let remote = new Replica("birth")
			newDocument(
				remote,
				"doc",
				"",
				scenario === "empty-fence" ? "---\nt: 1\n---\n" : "",
			)
			if (scenario !== "empty-fence") {
				let body = remote.fork("zzz"),
					header = remote.fork("aaa")
				let text = body.edit("doc", "hello\n"),
					metadata = header.edit("doc", "---\ntitle: x\n---\n")
				if (!text || !metadata) throw Error("Missing concurrent fixture edits")
				body.apply([metadata])
				remote = body
			}
			let initial = remote.text("doc")
			let start = scenario === "empty-fence" ? 0 : initial.indexOf("hello")
			let insertion =
				scenario === "empty-fence"
					? "---\n"
					: scenario === "body-fence"
						? "---\nfoo: 1\n---\n"
						: "X"
			let expected = initial.slice(0, start) + insertion + initial.slice(start)
			let snapshot: DocumentSnapshot = {
				format: "document-state-v1",
				document: "doc",
				log: "frontmatter-authoring",
				position: 1,
				state: JSON.stringify(remote.checkpoint()),
			}
			let transport: DocumentTransport = {
				snapshot: () => Effect.succeed(snapshot),
				history: () => Effect.succeed([]),
				commit: () => Effect.fail(new Error("Offline")),
			}
			function open<A, E>(
				work: (session: DocumentSession["Service"]) => Effect.Effect<A, E>,
			) {
				return Effect.scoped(
					Effect.gen(function* () {
						let services = yield* Layer.build(
							cliDocumentSessionLayer(directory, {
								document: "doc",
								subject: "owner",
								transport,
							}),
						)
						return yield* work(Context.get(services, DocumentSession))
					}),
				)
			}
			try {
				await Effect.runPromise(
					open(session =>
						Effect.gen(function* () {
							let edit = precise
								? session.replace([{ start, remove: 0, text: insertion }])
								: session.edit(expected)
							yield* edit.saved
							expect(session.replica.text("doc")).toBe(expected)
							yield* session.undo()
							expect(session.replica.text("doc")).toBe(initial)
							yield* session.redo()
							expect(session.replica.text("doc")).toBe(expected)
						}),
					),
				)
				await Effect.runPromise(
					open(session =>
						Effect.sync(() =>
							expect(session.replica.text("doc")).toBe(expected),
						),
					),
				)
			} finally {
				await rm(directory, { recursive: true, force: true })
			}
		}
	},
)
