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
import { frontmatter } from "../src/shared/markdown"

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

test("large body transactions after merged frontmatter retain exact source, Unicode, remote writers, undo and snapshots", () => {
	let replica = new Replica("birth")
	let body =
		"Paragraph **bold** ==marker== [link](https://example.com) ![Whiteboard](/assets/drawing.tldr) 😀 مرحبا\n\n".repeat(
			1400,
		)
	newDocument(
		replica,
		"doc",
		"",
		"---\ntitle: Original\n---\n# Notes\n\n" + body,
	)
	let owner = replica.fork("owner")
	let collaborator = replica.fork("collaborator")
	let title = owner.edit(
		"doc",
		owner.text("doc").replace("title: Original", "title: Renamed"),
	)
	let mode = collaborator.edit(
		"doc",
		collaborator
			.text("doc")
			.replace("title: Original", "title: Original\nmode: present"),
	)
	if (!title || !mode) throw Error("Missing metadata contributions")
	replica.apply([title, mode])
	expect(replica.metadata("doc").title).toBe("Renamed")
	expect(frontmatter(replica.text("doc")).data.mode).toBe("present")
	for (let position of ["first", "unicode", "last"]) {
		let before = replica.text("doc")
		let start =
			position === "first"
				? before.indexOf("\n\n") + 2
				: position === "unicode"
					? before.indexOf("😀")
					: before.length
		let remove = position === "unicode" ? 2 : 0
		let text = position === "unicode" ? "🌟" : "Local contribution "
		let audit = replica.fork("audit")
		let operation = replica.prepareReplacements("doc", [
			{ start, remove, text },
		])
		if (!operation) throw Error("Missing body transaction")
		replica.apply([operation])
		audit.apply([operation])
		let expected = before.slice(0, start) + text + before.slice(start + remove)
		expect(replica.text("doc")).toBe(expected)
		expect(audit.text("doc")).toBe(expected)
		let reopened = new Replica("reopened")
		reopened.restore(replica.checkpoint())
		expect(reopened.text("doc")).toBe(expected)
		expect(reopened.metadata("doc")).toEqual(replica.metadata("doc"))
	}
	let original = replica.text("doc")
	let audit = replica.fork("audit")
	let marked = replica.prepareReplacements("doc", [
		{ start: original.indexOf("==marker=="), remove: 10, text: "==bright==" },
		{ start: original.indexOf("Whiteboard"), remove: 10, text: "Drawing" },
	])
	if (!marked) throw Error("Missing multiple body replacements")
	replica.apply([marked])
	audit.apply([marked])
	let markedSource = original
		.replace("==marker==", "==bright==")
		.replace("Whiteboard", "Drawing")
	expect(replica.text("doc")).toBe(markedSource)
	expect(audit.text("doc")).toBe(markedSource)
	replica.cancel("doc", marked.id)
	expect(replica.text("doc")).toBe(original)
	let before = replica.text("doc")
	let base = replica.visible("doc")
	let peer = replica.fork("peer")
	let remote = peer.prepareReplacements("doc", [
		{ start: before.length, remove: 0, text: "Remote contribution" },
	])
	if (!remote) throw Error("Missing remote transaction")
	replica.apply([remote])
	let start = before.indexOf("==marker==")
	let local = replica.prepareReplacements(
		"doc",
		[
			{ start, remove: 10, text: "==changed==" },
			{ start: before.indexOf("🌟"), remove: 2, text: "😀" },
		],
		base,
	)
	if (!local) throw Error("Missing concurrent body transaction")
	replica.apply([local])
	let expected =
		before.replace("==marker==", "==changed==").replace("🌟", "😀") +
		"Remote contribution"
	expect(replica.text("doc")).toBe(expected)
	let undo = replica.cancel("doc", local.id)
	expect(replica.text("doc")).toBe(before + "Remote contribution")
	replica.cancel("doc", undo.id)
	expect(replica.text("doc")).toBe(expected)
	let reopened = new Replica("reopened")
	reopened.restore(replica.checkpoint())
	expect(reopened.text("doc")).toBe(expected)
	expect(reopened.metadata("doc").title).toBe("Renamed")
	expect(frontmatter(reopened.text("doc")).data.mode).toBe("present")
})

test("body-boundary edits after adding a header match replayed and reopened documents", () => {
	let replica = new Replica("birth")
	newDocument(replica, "doc", "", "foo 😀 tail")
	replica.edit("doc", "---\ntitle: Added\n---\n" + replica.text("doc"))
	for (let text of ["First ", "Second "]) {
		let before = replica.text("doc")
		let start = before.indexOf("foo")
		let audit = replica.fork("audit")
		let operation = replica.prepareReplacements("doc", [
			{ start, remove: 0, text },
		])
		if (!operation) throw Error("Missing boundary edit")
		replica.apply([operation])
		audit.apply([operation])
		let expected = before.slice(0, start) + text + before.slice(start)
		expect(replica.text("doc")).toBe(expected)
		expect(audit.text("doc")).toBe(expected)
		let reopened = new Replica("reopened")
		reopened.restore(replica.checkpoint())
		expect(reopened.text("doc")).toBe(expected)
		let remote = reopened.edit("doc", expected.replace("tail", "remote tail"))
		if (!remote) throw Error("Missing remote edit")
		replica.apply([remote])
		audit.apply([remote])
		expect(replica.text("doc")).toBe(reopened.text("doc"))
		expect(audit.text("doc")).toBe(reopened.text("doc"))
	}
})

test.each([false, true])(
	"empty body under an EOF header stays canonical through deletion, undo and reopening (precise=%s)",
	precise => {
		let replica = new Replica("birth")
		newDocument(replica, "doc", "", "---\na: 1\n---\n")
		let header = replica.fork("header")
		let writer = replica.fork("writer")
		let rewrite = header.edit("doc", "---\na: 1\na: 2\n---")
		let append = writer.edit("doc", writer.text("doc") + "y")
		if (!rewrite || !append)
			throw Error("Missing concurrent header and body edits")
		replica.apply([rewrite, append])
		let before = replica.text("doc")
		expect(before.endsWith("\ny")).toBe(true)
		let audit = replica.fork("audit")
		let operation = precise
			? replica.prepareReplacements("doc", [
					{ start: before.length - 1, remove: 1, text: "" },
				])
			: replica.prepareEdit("doc", before.slice(0, -1))
		if (!operation) throw Error("Missing body deletion")
		replica.apply([operation])
		audit.apply([operation])
		let expected = "---\na: 1\na: 2\n---"
		expect(audit.text("doc")).toBe(expected)
		expect(replica.text("doc")).toBe(expected)
		let reopened = new Replica("reopened")
		reopened.restore(replica.checkpoint())
		expect(reopened.text("doc")).toBe(expected)
		let undo = replica.cancel("doc", operation.id)
		expect(replica.text("doc")).toBe(before)
		replica.cancel("doc", undo.id)
		expect(replica.text("doc")).toBe(expected)
	},
)

test.each([false, true])(
	"body-boundary insertion keeps a closing newline restored below a tombstoned anchor (precise=%s)",
	precise => {
		let replica = new Replica("birth")
		newDocument(replica, "doc", "", "---\ntitle: Notes\n---\nfoo")
		let before = replica.text("doc")
		let start = before.indexOf("foo")
		let newline = replica.visible("doc")[start - 1]
		let replacement = replica.prepareEdit("doc", before + "unused")
		if (!newline || !replacement) throw Error("Missing closing newline fixture")
		let repair = {
			...replacement,
			insert: [
				{ id: `${replacement.id}:00000000`, after: newline.id, value: "\n" },
			],
			remove: [newline.id],
		}
		replica.apply([repair])
		expect(replica.text("doc")).toBe(before)
		let audit = replica.fork("audit")
		let text = "New ".repeat(40)
		let expected = before.slice(0, start) + text + before.slice(start)
		let operation = precise
			? replica.prepareReplacements("doc", [{ start, remove: 0, text }])
			: replica.prepareEdit("doc", expected)
		if (!operation) throw Error("Missing boundary insertion")
		replica.apply([operation])
		audit.apply([operation])
		expect(audit.text("doc")).toBe(expected)
		expect(replica.text("doc")).toBe(expected)
		let reopened = new Replica("reopened")
		reopened.restore(replica.checkpoint())
		expect(reopened.text("doc")).toBe(expected)
		expect(reopened.metadata("doc").title).toBe("Notes")
		let peer = reopened.edit("doc", expected + " peer")
		if (!peer) throw Error("Missing concurrent contribution")
		replica.apply([peer])
		let undo = replica.cancel("doc", operation.id)
		expect(replica.text("doc")).toBe(before + " peer")
		replica.cancel("doc", undo.id)
		expect(replica.text("doc")).toBe(expected + " peer")
	},
)

test.each([false, true])(
	"adding a body to an EOF header preserves one canonical header (precise=%s)",
	precise => {
		let replica = new Replica("birth")
		newDocument(replica, "doc", "", "---\na: 1\n---")
		let before = replica.text("doc")
		let expected = before + "\nfoo"
		let operation = precise
			? replica.prepareReplacements("doc", [
					{ start: before.length, remove: 0, text: "\nfoo" },
				])
			: replica.prepareEdit("doc", expected)
		if (!operation) throw Error("Missing EOF body insertion")
		replica.apply([operation])
		expect(replica.text("doc")).toBe(expected)
		let reopened = new Replica("reopened")
		reopened.restore(replica.checkpoint())
		expect(reopened.text("doc")).toBe(expected)
	},
)
