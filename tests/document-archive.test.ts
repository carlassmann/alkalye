import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import { Replica } from "../src/shared/crdt"
import {
	ArchiveInvalid,
	archiveContents,
	archiveIdentityKeys,
	documentKey,
	exportArchive,
	importSteps,
	importedSource,
	parseArchive,
	portableMarkdown,
} from "../src/shared/document-archive"
import type { ArchivePlan } from "../src/shared/document-archive"
import { buildAction } from "../src/shared/document-actions"
import { blobContentType, blobReference } from "../src/shared/document-blobs"
import { commentRange, newDocument } from "../src/shared/documents"
import { legacyShapes } from "../src/shared/legacy-drawing"
import { frontmatter } from "../src/shared/markdown"
import { unzip, zip } from "../src/shared/zip"
import type { ZipEntry } from "../src/shared/zip"

let encoder = new TextEncoder()
let decoder = new TextDecoder()
let image = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4])
let audio = new Uint8Array([73, 68, 51, 9, 9])
let preview = encoder.encode('<svg xmlns="http://www.w3.org/2000/svg"/>')

test("a document archive round-trips text, assets, whiteboards, themes, comments and links", async () => {
	let notes = await sourceDocument()
	let linked = new Replica("linked-author")
	newDocument(
		linked,
		"doc-linked",
		"Untitled",
		"---\ntitle: Linked\npath: Projects\n---\n\nBack to [[doc-notes|notes]].",
	)
	let entries = await run(
		exportArchive([
			notes,
			{ document: "doc-linked", replica: linked, media: new Map() },
		]),
	)
	let bytes = zip(entries)
	let names = (await unzip(bytes)).map(entry => entry.name).sort()
	expect(names).toEqual([
		"Projects/Linked.md",
		"Projects/Notes/Notes.assets.json",
		"Projects/Notes/Notes.comments.json",
		"Projects/Notes/Notes.md",
		"Projects/Notes/assets/Photo.png",
		"Projects/Notes/assets/Sketch.svg",
		"Projects/Notes/assets/Sketch.svg.alkalye-drawing.json",
		"Projects/Notes/assets/voice.mp3",
		"alkalye.json",
		"themes/Paper.theme.md",
	])
	let markdown = text(entries, "Projects/Notes/Notes.md")
	expect(markdown).toContain("![Photo](assets/Photo.png)")
	expect(markdown).toContain("![Sketch](assets/Sketch.svg)")
	expect(markdown).toContain("[[Projects/Linked]]")
	expect(frontmatter(markdown).values.theme).toBe("Paper")
	expect(frontmatter(markdown).values["theme-id"]).toBeUndefined()
	expect(text(entries, "Projects/Linked.md")).toContain(
		"[[Projects/Notes|notes]]",
	)

	let plan = await run(parseArchive(await unzip(bytes)))
	let identities = fresh(plan)
	let imported = await materialize(plan, identities)
	let notesId = identities.get("document:Projects/Notes/Notes.md") ?? ""
	let linkedId = identities.get("document:Projects/Linked.md") ?? ""
	let result = imported.get(notesId)
	if (!result) throw new Error("Missing imported notes")
	let source = result.text(notesId)
	expect(source).toContain(`[[${linkedId}]]`)
	expect(imported.get(linkedId)?.text(linkedId)).toContain(
		`[[${notesId}|notes]]`,
	)
	expect(result.metadata(notesId)).toMatchObject({
		title: "Notes",
		path: "Projects",
		tags: ["draft", "ideas"],
		pinned: true,
	})
	let contents = archiveContents(result, notesId)
	expect(contents.assets).toHaveLength(2)
	let photo = contents.assets.find(
		asset => result.fields(asset.id).name === "Photo",
	)
	let voice = contents.assets.find(
		asset => result.fields(asset.id).name === "voice.mp3",
	)
	expect(blobContentType(photo?.reference ?? "")).toBe("image/png")
	expect(source).toContain(`![Photo](asset:${photo?.id})`)
	expect(result.fields(voice?.id ?? "").muted).toBe("true")
	let [board] = contents.whiteboards
	expect(result.fields(board ?? "")).toMatchObject({
		type: "whiteboard",
		document: notesId,
		name: "Sketch",
	})
	expect(
		[...legacyShapes(result.fields(board ?? "")).values()].map(shape => ({
			kind: shape.kind,
			text: shape.text,
		})),
	).toEqual([
		{ kind: "rectangle", text: "" },
		{ kind: "text", text: "Label" },
	])
	let theme = contents.selectedTheme ?? ""
	expect(result.fields(theme)).toMatchObject({ type: "theme", name: "Paper" })
	expect(result.text(theme)).toContain("```css theme")
	expect(frontmatter(source).values["theme-id"]).toBe(theme)
	let [comment] = contents.comments
	let fields = result.fields(comment ?? "")
	expect(fields).toMatchObject({
		body: "Tighten this",
		author: "Ada",
		resolved: "true",
	})
	let range = commentRange(result, notesId, fields)
	expect(range && source.slice(range.start, range.end)).toBe("second paragraph")
	expect(
		Object.entries(fields)
			.filter(([key]) => key.startsWith("reply:"))
			.map(([, value]) => JSON.parse(value).body),
	).toEqual(["Done"])

	let media = new Map<string, Uint8Array<ArrayBuffer>>()
	for (let asset of contents.assets)
		media.set(
			asset.id,
			blobContentType(asset.reference) === "image/png" ? image : audio,
		)
	for (let board of contents.whiteboards) media.set(board, preview)
	let again = await run(
		exportArchive([
			{ document: notesId, replica: result, media },
			{
				document: linkedId,
				replica: imported.get(linkedId) ?? new Replica("missing"),
				media: new Map(),
			},
		]),
	)
	expect(text(again, "Projects/Notes/Notes.md")).toBe(markdown)
	expect(
		JSON.parse(text(again, "Projects/Notes/Notes.comments.json")).comments[0]
			.from,
	).toBe(
		JSON.parse(text(entries, "Projects/Notes/Notes.comments.json")).comments[0]
			.from,
	)
})

test("plain documents download as Markdown with wiki links named by title", async () => {
	let replica = new Replica("author")
	newDocument(
		replica,
		"plain",
		"Untitled",
		"# Plain\n\nSee [[other]] and [[gone]].",
	)
	expect(archiveContents(replica, "plain")).toEqual({
		assets: [],
		whiteboards: [],
		comments: [],
		themes: [],
	})
	expect(
		portableMarkdown(replica, "plain", new Map([["other", "Other title"]])),
	).toBe("# Plain\n\nSee [[Other title]] and [[gone]].")
})

test("archives from the original application import folders, assets and comment sidecars", async () => {
	let entries: ZipEntry[] = [
		file(
			"Trip/Trip.md",
			"# Trip\r\n\r\n![Map](assets/map.png)\r\n\r\nPack the tent.",
		),
		{ name: "Trip/assets/map.png", data: image },
		{ name: "Trip/assets/unreferenced.png", data: image },
		file(
			"Trip/Trip.comments.json",
			JSON.stringify({
				version: 1,
				comments: [
					{
						id: "c1",
						quote: "tent",
						contextBefore: "Pack the ",
						contextAfter: ".",
						from: 99,
						to: 103,
						resolved: false,
						replies: [
							{ body: "Which one?", authorName: "Grace" },
							{
								body: "The green one",
								authorName: "Ada",
								createdAt: "2026-01-01T00:00:00Z",
							},
						],
					},
				],
			}),
		),
		file("Work/Plans/Roadmap.md", "Link to [[Trip]] and [[../Missing]]."),
		file("__MACOSX/Trip/._Trip.md", "ignored"),
	]
	let plan = await run(parseArchive(entries))
	expect(
		plan.documents.map(document => [document.title, document.folder]),
	).toEqual([
		["Trip", ""],
		["Roadmap", "Work/Plans"],
	])
	expect(plan.documents[0]?.assets.map(asset => asset.path)).toEqual([
		"Trip/assets/map.png",
		"Trip/assets/unreferenced.png",
	])
	let identities = fresh(plan)
	let imported = await materialize(plan, identities)
	let trip = identities.get("document:Trip/Trip.md") ?? ""
	let roadmap = identities.get("document:Work/Plans/Roadmap.md") ?? ""
	let tripReplica = imported.get(trip)
	if (!tripReplica) throw new Error("Missing trip")
	let comment = archiveContents(tripReplica, trip).comments[0] ?? ""
	let range = commentRange(tripReplica, trip, tripReplica.fields(comment))
	expect(range && tripReplica.text(trip).slice(range.start, range.end)).toBe(
		"tent",
	)
	expect(tripReplica.fields(comment).body).toBe("Which one?")
	expect(imported.get(roadmap)?.text(roadmap)).toContain(`[[${trip}]]`)
	expect(imported.get(roadmap)?.text(roadmap)).toContain("[[../Missing]]")
	expect(imported.get(roadmap)?.metadata(roadmap).path).toBe("Work/Plans")
})

test("malformed archives fail as ArchiveInvalid before any document is planned", async () => {
	let cases: ZipEntry[][] = [
		[file("alkalye.json", "{not json"), file("a.md", "a")],
		[
			file("alkalye.json", JSON.stringify({ format: "other" })),
			file("a.md", "a"),
		],
		[
			file(
				"alkalye.json",
				JSON.stringify({
					format: "alkalye-portable-v1",
					documents: [{ path: "missing.md" }],
					themes: [],
				}),
			),
			file("a.md", "a"),
		],
		[file("a.md", "a"), file("a.md", "b")],
		[file("../escape.md", "a")],
		[file("folder//a.md", "a")],
		[{ name: "binary.md", data: new Uint8Array([0xff, 0xfe, 0xfd]) }],
		[file("a.md", "x".repeat(2_000_001))],
		[file("Doc/Doc.md", "a"), file("Doc/Doc.comments.json", "[1]")],
		[
			file("Doc/Doc.md", "![x](assets/x.png)"),
			{ name: "Doc/assets/x.png", data: image },
			file("Doc/assets/x.png.alkalye-drawing.json", '{"format":"nope"}'),
		],
		[file("image.png", "not markdown")],
	]
	for (let entries of cases) {
		let exit = await Effect.runPromiseExit(parseArchive(entries))
		expect(Exit.isFailure(exit)).toBe(true)
		if (Exit.isFailure(exit))
			expect(exit.cause.toString()).toContain("ArchiveInvalid")
	}
	let failure = await Effect.runPromise(
		Effect.flip(parseArchive([file("alkalye.json", "{")])),
	)
	expect(failure).toBeInstanceOf(ArchiveInvalid)
})

test("unzip refuses entries that inflate past their declared size, truncation and duplicates", async () => {
	let zeros = new Uint8Array(4_000_000)
	let compressed = new Uint8Array(
		await new Response(
			new Blob([zeros])
				.stream()
				.pipeThrough(new CompressionStream("deflate-raw")),
		).arrayBuffer(),
	)
	let bomb = zip([{ name: "bomb.md", data: compressed }])
	let view = new DataView(bomb.buffer)
	let central = bomb.length - 22 - (46 + "bomb.md".length)
	view.setUint16(8, 8, true)
	view.setUint32(22, 1000, true)
	view.setUint16(central + 10, 8, true)
	view.setUint32(central + 24, 1000, true)
	await expect(unzip(bomb)).rejects.toThrow("declared size")
	let valid = zip([file("a.md", "hello")])
	await expect(unzip(valid.slice(0, valid.length - 30))).rejects.toThrow()
	let duplicate = zip([file("a.md", "1"), file("a.md", "2")])
	await expect(unzip(duplicate)).rejects.toThrow("duplicate")
})

test("large whiteboards and discussions import in actions within the server limits", async () => {
	let shapes = Array.from({ length: 2300 }, (_value, index) => ({
		kind: "pen",
		color: "#123456",
		width: 2,
		points: [
			{ x: index, y: 0 },
			{ x: index + 1, y: 1 },
		],
		text: "",
	}))
	let comments = Array.from({ length: 150 }, (_value, index) => ({
		quote: "word" + index,
		from: null,
		to: null,
		resolved: false,
		replies: [{ body: "Comment " + index, authorName: "Ada" }],
	}))
	let entries = [
		file(
			"Board/Board.md",
			"# Board\n\n![Board](assets/board.svg)\n\n" +
				comments.map(comment => comment.quote).join(" "),
		),
		{ name: "Board/assets/board.svg", data: preview },
		file(
			"Board/assets/board.svg.alkalye-drawing.json",
			JSON.stringify({ format: "alkalye-drawing-v1", shapes }),
		),
		file("Board/Board.comments.json", JSON.stringify({ version: 1, comments })),
	]
	let plan = await run(parseArchive(entries))
	let identities = fresh(plan)
	let document = plan.documents[0]
	if (!document) throw new Error("Missing document")
	let id = identities.get(documentKey(document)) ?? ""
	let replica = new Replica("importer")
	let { source } = await run(importedSource(plan, document, identities))
	newDocument(replica, id, "Untitled", source)
	let steps = await run(importSteps(plan, document, identities, new Map()))
	expect(steps.length).toBeGreaterThan(2)
	for (let step of steps) {
		let action = await run(buildAction(replica, id, step.label, step.build))
		expect(action.changes.length).toBeLessThanOrEqual(1024)
		step.build(replica)
	}
	let board = archiveContents(replica, id).whiteboards[0] ?? ""
	expect(legacyShapes(replica.fields(board)).size).toBe(2300)
	let discussion = archiveContents(replica, id).comments
	expect(discussion).toHaveLength(150)
	let last = replica.fields(discussion.at(-1) ?? "")
	expect(commentRange(replica, id, last)).toBeDefined()
})

async function sourceDocument() {
	let replica = new Replica("source-author")
	let photo = await run(
		blobReference({
			version: 1,
			type: "image/png",
			size: image.length,
			chunks: [{ digest: "a".repeat(42) + "A", size: image.length }],
		}),
	)
	let voice = await run(
		blobReference({
			version: 1,
			type: "audio/mpeg",
			size: audio.length,
			chunks: [{ digest: "b".repeat(42) + "E", size: audio.length }],
		}),
	)
	newDocument(
		replica,
		"doc-notes",
		"Untitled",
		"---\ntitle: Notes\npath: Projects\ntags: [draft, ideas]\npinned: true\ntheme-id: theme-1\n---\n\nFirst paragraph with [[doc-linked]].\n\n![Photo](asset:asset-photo)\n\nThe second paragraph matters.\n\n![Sketch](asset:board-1)\n\n![voice.mp3](asset:asset-voice)\n",
	)
	for (let { id, name, data, muted } of [
		{ id: "asset-photo", name: "Photo", data: photo, muted: "false" },
		{ id: "asset-voice", name: "voice.mp3", data: voice, muted: "true" },
	])
		for (let [field, value] of Object.entries({
			type: "asset",
			document: "doc-notes",
			name,
			data,
			muted,
		}))
			replica.set(id, field, value)
	replica.set("board-1", "type", "whiteboard")
	replica.set("board-1", "document", "doc-notes")
	replica.set("board-1", "name", "Sketch")
	replica.set(
		"board-1",
		"shape:a",
		JSON.stringify({
			kind: "rectangle",
			color: "#112233",
			width: 3,
			points: [
				{ x: 0, y: 0 },
				{ x: 20, y: 10 },
			],
			text: "",
			order: "1",
		}),
	)
	replica.set(
		"board-1",
		"shape:b",
		JSON.stringify({
			kind: "text",
			color: "#112233",
			width: 3,
			points: [{ x: 5, y: 5 }],
			text: "Label",
			order: "2",
		}),
	)
	replica.set("theme-1", "type", "theme")
	replica.set("theme-1", "document", "doc-notes")
	replica.set("theme-1", "name", "Paper")
	replica.edit(
		"theme-1",
		"# Paper\n\n```css theme\n.content { font-family: serif; }\n```",
	)
	let source = replica.text("doc-notes")
	let start = source.indexOf("second paragraph")
	let anchors: string[] = []
	let offset = 0
	for (let atom of replica.visible("doc-notes")) {
		let previous = offset
		offset += atom.value.length
		if (offset > start && previous < start + "second paragraph".length)
			anchors.push(atom.id)
	}
	for (let [field, value] of Object.entries({
		type: "comment",
		document: "doc-notes",
		quote: "second paragraph",
		body: "Tighten this",
		author: "Ada",
		resolved: "true",
		anchor: JSON.stringify(anchors),
		source: "body",
		"reply:5:someone": JSON.stringify({
			body: "Done",
			author: "Grace",
			time: 5,
		}),
	}))
		replica.set("comment-1", field, value)
	let media = new Map<string, Uint8Array<ArrayBuffer>>([
		["asset-photo", image],
		["asset-voice", audio],
		["board-1", preview],
	])
	return { document: "doc-notes", replica, media }
}

async function materialize(
	plan: ArchivePlan,
	identities: ReadonlyMap<string, string>,
) {
	let result = new Map<string, Replica>()
	for (let document of plan.documents) {
		let id = identities.get(documentKey(document)) ?? ""
		let replica = new Replica("importer-" + id)
		let { source } = await run(importedSource(plan, document, identities))
		newDocument(replica, id, "Untitled", source)
		let references = new Map<string, string>()
		for (let asset of document.assets)
			references.set(
				asset.path,
				await run(
					blobReference({
						version: 1,
						type: asset.type,
						size: asset.data.length,
						chunks: [{ digest: "c".repeat(42) + "I", size: asset.data.length }],
					}),
				),
			)
		for (let step of await run(
			importSteps(plan, document, identities, references),
		))
			step.build(replica)
		result.set(id, replica)
	}
	return result
}

function fresh(plan: ArchivePlan) {
	return new Map(
		archiveIdentityKeys(plan).map((key, index) => [key, "imported-" + index]),
	)
}
function file(name: string, content: string): ZipEntry {
	return { name, data: encoder.encode(content) }
}
function text(entries: ReadonlyArray<ZipEntry>, name: string) {
	let entry = entries.find(entry => entry.name === name)
	if (!entry) throw new Error("Missing " + name)
	return decoder.decode(entry.data)
}
function run<A, E>(effect: Effect.Effect<A, E>) {
	return Effect.runPromise(effect)
}
