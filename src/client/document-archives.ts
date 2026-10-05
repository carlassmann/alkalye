import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import type * as Context from "effect/Context"
import { Replica } from "../shared/crdt"
import {
	ArchiveInvalid,
	archiveContents,
	archiveDate,
	archiveIdentityKeys,
	documentKey,
	exportArchive,
	importSteps,
	importedSource,
	isPlainDocument,
	parseArchive,
	portableMarkdown,
	safeFilename,
} from "../shared/document-archive"
import type { ArchivePlan, ArchiveSnapshot } from "../shared/document-archive"
import { themeFromArchive } from "../shared/theme-archive"
import { unzip, zip } from "../shared/zip"
import type { ZipEntry } from "../shared/zip"
import type { BrowserLibrary } from "./browser-library"
import { showProgress } from "./components/progress"
import { drawingSvg } from "./document-media"

type Library = Context.Service.Shape<typeof BrowserLibrary>
type OpenedDocument = Effect.Success<ReturnType<Library["open"]>>
export interface ExportedFile {
	readonly name: string
	readonly blob: Blob
}

// One document downloads as Markdown when it owns nothing else; otherwise it
// becomes a ZIP so attachments, drawings, themes and comments travel with it.
export function exportDocument(
	opened: OpenedDocument,
	document: string,
	titles: ReadonlyMap<string, string>,
) {
	return Effect.gen(function* () {
		let snapshot = yield* archiveSnapshot(opened, document)
		let title = safeFilename(snapshot.replica.metadata(document).title)
		if (isPlainDocument(archiveContents(snapshot.replica, document))) {
			let file: ExportedFile = {
				name: title + ".md",
				blob: new Blob([portableMarkdown(snapshot.replica, document, titles)], {
					type: "text/markdown;charset=utf-8",
				}),
			}
			return file
		}
		return archiveFile(title, yield* exportArchive([snapshot], titles))
	})
}

// "Save as" writes the Markdown source alone, as the original application did.
export function exportMarkdown(
	opened: OpenedDocument,
	document: string,
	titles: ReadonlyMap<string, string>,
): ExportedFile {
	let replica = new Replica("archive-reader")
	replica.restore(opened.session.replica.checkpoint())
	return {
		name: safeFilename(replica.metadata(document).title) + ".md",
		blob: new Blob([portableMarkdown(replica, document, titles)], {
			type: "text/markdown;charset=utf-8",
		}),
	}
}

// A backup packages each document's current snapshot and attachment bytes.
// It never downloads or replays history.
export function exportLibrary(
	library: Library,
	documents: ReadonlyArray<{ document: string; folder?: string }>,
	name: string,
) {
	return Effect.gen(function* () {
		let titles = libraryTitles(library)
		let progress = showProgress("Backing up", documents.length)
		let completed = 0
		let snapshots = yield* Effect.forEach(
			documents,
			({ document, folder }) =>
				Effect.scoped(
					library
						.open(document)
						.pipe(
							Effect.flatMap(opened =>
								archiveSnapshot(opened, document, folder),
							),
						),
				).pipe(
					Effect.tap(snapshot =>
						Effect.sync(() =>
							progress.update(
								snapshot.replica.metadata(document).title,
								++completed,
							),
						),
					),
				),
			{ concurrency: 2 },
		).pipe(Effect.ensuring(Effect.sync(() => progress.finish())))
		return archiveFile(
			safeFilename(name) + " " + archiveDate(Date.now()),
			yield* exportArchive(snapshots, titles),
		)
	})
}

export interface ImportOptions {
	readonly workspace?: string
	readonly importTheme: (
		source: string,
		name: string,
	) => Effect.Effect<void, unknown>
}

// Selected files form one archive, so Markdown files chosen together keep
// their wiki links, comment sidecars and relative images.
export function importFiles(
	library: Library,
	files: ReadonlyArray<File>,
	options: ImportOptions,
) {
	return Effect.gen(function* () {
		let loose: ZipEntry[] = []
		let created: string[] = []
		for (let file of files) {
			let data = new Uint8Array(
				yield* Effect.tryPromise(() => file.arrayBuffer()),
			)
			let name = file.webkitRelativePath || file.name
			if (/\.zip$/i.test(name)) {
				let entries = yield* Effect.tryPromise({
					try: () => unzip(data),
					catch: error =>
						new ArchiveInvalid({
							message:
								error instanceof Error ? error.message : "Invalid ZIP archive",
						}),
				})
				let theme = themeFromArchive(entries)
				if (theme) {
					yield* options.importTheme(theme, name.replace(/\.zip$/i, ""))
					continue
				}
				created.push(
					...(yield* importPlan(
						library,
						yield* parseArchive(entries),
						options.workspace,
					)),
				)
			} else if (/\.theme\.md$/i.test(name))
				yield* options.importTheme(
					new TextDecoder().decode(data),
					name.replace(/\.theme\.md$/i, ""),
				)
			else if (/\.(alkalye-drawing\.json|tldr)$/i.test(name))
				loose.push(...drawingDocument(name, data))
			else loose.push({ name, data })
		}
		if (loose.length)
			created.push(
				...(yield* importPlan(
					library,
					yield* parseArchive(loose),
					options.workspace,
				)),
			)
		return created
	})
}

export function importPlan(
	library: Library,
	plan: ArchivePlan,
	workspace?: string,
) {
	return Effect.gen(function* () {
		let drawings = plan.documents.flatMap(document =>
			[
				document.drawing,
				...document.assets.map(asset => asset.drawing),
			].flatMap(drawing =>
				drawing?.kind === "tldraw" || drawing?.kind === "register"
					? [drawing.file]
					: [],
			),
		)
		if (drawings.length) {
			let { checkBoardFile } = yield* Effect.tryPromise(
				() => import("./whiteboard-store"),
			)
			yield* Effect.try(() => drawings.forEach(checkBoardFile))
		}
		let random = yield* Crypto.Crypto
		let identities = new Map<string, string>()
		for (let key of archiveIdentityKeys(plan))
			identities.set(key, yield* random.randomUUIDv4)
		let progress = showProgress("Importing", plan.documents.length)
		let created: string[] = []
		yield* Effect.gen(function* () {
			for (let document of plan.documents) {
				progress.update(document.title, created.length)
				let id = identities.get(documentKey(document)) ?? ""
				let { source } = yield* importedSource(plan, document, identities)
				yield* library.create(source, workspace, id)
				yield* Effect.scoped(
					Effect.gen(function* () {
						let opened = yield* library.open(id)
						let references = new Map<string, string>()
						for (let asset of document.assets)
							if (!asset.drawing)
								references.set(
									asset.path,
									yield* opened.blobs.store(
										new Blob([asset.data], { type: asset.type }),
									),
								)
						for (let step of yield* importSteps(
							plan,
							document,
							identities,
							references,
						))
							yield* opened.session.change(step.label, step.build)
					}),
				)
				created.push(id)
			}
		}).pipe(Effect.ensuring(Effect.sync(() => progress.finish())))
		return created
	})
}

export function downloadFile(file: ExportedFile) {
	return Effect.acquireUseRelease(
		Effect.sync(() => URL.createObjectURL(file.blob)),
		url =>
			Effect.sync(() => {
				let link = document.createElement("a")
				link.href = url
				link.download = file.name
				link.click()
			}).pipe(Effect.andThen(Effect.sleep("1 second"))),
		url => Effect.sync(() => URL.revokeObjectURL(url)),
	)
}

export function libraryTitles(library: Library) {
	return new Map(
		library.state
			.current()
			.library.documents.map(entry => [entry.document, entry.metadata.title]),
	)
}

function archiveSnapshot(
	opened: OpenedDocument,
	document: string,
	folder?: string,
) {
	return Effect.gen(function* () {
		let replica = new Replica("archive-reader")
		replica.restore(opened.session.replica.checkpoint())
		let contents = archiveContents(replica, document)
		let media = new Map<string, Uint8Array<ArrayBuffer>>()
		yield* Effect.forEach(
			contents.assets,
			asset =>
				opened.blobs.read(asset.reference).pipe(
					Effect.flatMap(blob => Effect.tryPromise(() => blob.arrayBuffer())),
					Effect.map(buffer => {
						media.set(asset.id, new Uint8Array(buffer))
					}),
				),
			{ concurrency: 4, discard: true },
		)
		for (let board of contents.whiteboards) {
			let svg = yield* drawingSvg(replica.fields(board))
			media.set(board, new TextEncoder().encode(svg))
		}
		let snapshot: ArchiveSnapshot = {
			document,
			replica,
			media,
			...(folder ? { folder } : {}),
		}
		return snapshot
	})
}

function archiveFile(name: string, entries: ZipEntry[]): ExportedFile {
	return {
		name: name + ".zip",
		blob: new Blob([zip(entries)], { type: "application/zip" }),
	}
}

function drawingDocument(name: string, data: Uint8Array<ArrayBuffer>) {
	let title = safeFilename(
		(name.split("/").at(-1) ?? "Whiteboard").replace(
			/\.(alkalye-drawing\.json|tldr)$/i,
			"",
		),
	)
	let encoder = new TextEncoder()
	let image = title + "/assets/" + title.replace(/[^\p{L}\p{N}._-]+/gu, "-")
	return [
		{
			name: title + "/" + title + ".md",
			data: encoder.encode(
				"# " +
					title +
					"\n\n![" +
					title +
					"](assets/" +
					image.split("/").at(-1) +
					".svg)\n",
			),
		},
		{
			name: image + ".svg",
			data: encoder.encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
		},
		{
			name:
				image +
				(/\.tldr$/i.test(name) ? ".svg.tldr" : ".svg.alkalye-drawing.json"),
			data,
		},
	]
}
