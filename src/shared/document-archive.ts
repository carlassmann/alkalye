import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type { Replica } from "./crdt"
import { assetReferences } from "./authoring"
import { commentRange, selectionAnchor } from "./documents"
import {
	canonicalDocumentSource,
	documentMetadata,
	metadataSource,
	relocatedRange,
} from "./document-metadata"
import { blobContentType, maximumDocumentBlobBytes } from "./document-blobs"
import { maximumActionText } from "./document-actions"
import { drawingOrder, drawingShapes } from "./drawing"
import type { Shape } from "./drawing"
import { importDrawing } from "./drawing-import"
import { compileTheme, frontmatter, withFrontmatter } from "./markdown"
import type { Operation } from "./model"
import {
	commentSidecar,
	decodedPath,
	importedCommentAnchor,
	mediaType,
	portableComments,
	rewrite,
} from "./portable"
import {
	archiveLinkPath,
	relativeLinkPath,
	wikiReplacements,
} from "./portable-links"
import type { ZipEntry } from "./zip"
import { maximumArchiveBytes, maximumArchiveEntries } from "./zip"

export class ArchiveInvalid extends Schema.TaggedError<ArchiveInvalid>()(
	"ArchiveInvalid",
	{ message: Schema.String },
) {}

// A document and everything it owns, read from one restored checkpoint so the
// archive never mixes states. `media` holds attachment bytes and whiteboard
// previews keyed by their record identity.
export interface ArchiveSnapshot {
	readonly document: string
	readonly replica: Replica
	readonly folder?: string
	readonly media: ReadonlyMap<string, Uint8Array<ArrayBuffer>>
}
export interface ArchiveContents {
	readonly assets: ReadonlyArray<{ id: string; reference: string }>
	readonly whiteboards: ReadonlyArray<string>
	readonly comments: ReadonlyArray<string>
	readonly themes: ReadonlyArray<string>
	readonly selectedTheme?: string
}
export interface ArchivePlan {
	readonly documents: ReadonlyArray<ImportedDocument>
}
export interface ImportedDocument {
	readonly path: string
	readonly original: string
	readonly title: string
	readonly folder: string
	readonly assets: ReadonlyArray<ImportedAsset>
	readonly comments: ReadonlyArray<ImportedComment>
	readonly themes: ReadonlyArray<ImportedTheme>
	readonly selectedTheme?: string
	readonly drawing?: ReadonlyArray<Shape>
	readonly drawingAsset?: string
	readonly id?: string
}
export interface ImportedAsset {
	readonly path: string
	readonly id?: string
	readonly name: string
	readonly type: string
	readonly muted: boolean
	readonly data: Uint8Array<ArrayBuffer>
	readonly destinations: ReadonlyArray<string>
	readonly shapes?: ReadonlyArray<Shape>
}
export interface ImportedTheme {
	readonly path: string
	readonly name: string
	readonly source: string
}
export interface ImportedComment {
	readonly quote: string
	readonly body: string
	readonly author: string
	readonly resolved: boolean
	readonly selectionStart?: number
	readonly contextBefore?: string
	readonly contextAfter?: string
	readonly orphaned: boolean
	readonly replies: Readonly<Record<string, string>>
}
export interface ImportStep {
	readonly label: string
	readonly build: (staged: Replica) => (Operation | null)[]
}

export let archiveFormat = "alkalye-portable-v1"
let ManifestSchema = Schema.Struct({
	format: Schema.Literal("alkalye-portable-v1"),
	documents: Schema.Array(
		Schema.Struct({
			path: Schema.String,
			id: Schema.optionalKey(Schema.String),
			folder: Schema.optionalKey(Schema.String),
			theme: Schema.optionalKey(Schema.String),
			themes: Schema.optionalKey(Schema.Array(Schema.String)),
			drawing: Schema.optionalKey(Schema.String),
			drawingAsset: Schema.optionalKey(Schema.String),
		}),
	),
	themes: Schema.Array(
		Schema.Struct({ path: Schema.String, name: Schema.String }),
	),
})
type Manifest = typeof ManifestSchema.Type
let AssetMetadataSchema = Schema.Array(
	Schema.Struct({
		path: Schema.String,
		id: Schema.optionalKey(Schema.String),
		name: Schema.String,
		type: Schema.String,
		muted: Schema.Literals(["true", "false"]),
	}),
)
let ReplySchema = Schema.Struct({
	body: Schema.String,
	author: Schema.String,
	time: Schema.Finite,
})
let operationBudget = 900
let textBudget = 180_000
let commentSourceLimit = 64_000

export function archiveContents(
	replica: Pick<Replica, "text" | "fields" | "records">,
	document: string,
): ArchiveContents {
	let source = replica.text(document)
	let referenced = assetReferences(source)
	let belongs = (record: { id: string; fields: Record<string, string> }) =>
		record.fields.document === document || referenced.has(record.id)
	let whiteboards = replica
		.records("whiteboard")
		.filter(belongs)
		.map(record => record.id)
	let board = replica.fields(document).whiteboard
	if (
		board &&
		replica.fields(board).type === "whiteboard" &&
		!whiteboards.includes(board)
	)
		whiteboards.push(board)
	let header = frontmatter(source).values
	let requested = header["theme-id"] || header.theme || ""
	let themes = replica.records("theme")
	let selected =
		themes.find(theme => theme.id === requested) ??
		themes.find(theme => requested && theme.fields.name === requested)
	return {
		assets: replica
			.records("asset")
			.filter(belongs)
			.map(record => ({ id: record.id, reference: record.fields.data ?? "" })),
		whiteboards,
		comments: replica
			.records("comment")
			.filter(record => record.fields.document === document)
			.map(record => record.id),
		themes: themes
			.filter(theme => theme.fields.document === document || theme === selected)
			.map(theme => theme.id),
		...(selected ? { selectedTheme: selected.id } : {}),
	}
}

export function isPlainDocument(contents: ArchiveContents) {
	return (
		!contents.assets.length &&
		!contents.whiteboards.length &&
		!contents.comments.length &&
		!contents.themes.length
	)
}

// Markdown for a single download: wiki links name their targets by title
// because identities mean nothing outside this account.
export function portableMarkdown(
	replica: Pick<Replica, "text" | "fields">,
	document: string,
	titles: ReadonlyMap<string, string>,
) {
	let source = canonicalDocumentSource(
		replica.text(document),
		replica.fields(document),
	)
	return rewrite(
		source,
		wikiReplacements(source, token => titles.get(token)),
	).text
}

export function exportArchive(
	snapshots: ReadonlyArray<ArchiveSnapshot>,
	titles: ReadonlyMap<string, string> = new Map(),
) {
	return Effect.gen(function* () {
		let encoder = new TextEncoder()
		let entries: ZipEntry[] = []
		let manifest: {
			format: string
			documents: Manifest["documents"][number][]
			themes: { path: string; name: string }[]
		} = { format: archiveFormat, documents: [], themes: [] }
		let places = archiveLayout(snapshots)
		let themePaths = new Map<string, string>()
		let usedThemePaths = new Set<string>()
		for (let snapshot of snapshots) {
			let { replica, document, media } = snapshot
			let place = places.get(document)
			if (!place)
				return yield* new ArchiveInvalid({ message: "Missing document path" })
			let contents = archiveContents(replica, document)
			let stored = replica.text(document)
			let original = canonicalDocumentSource(stored, replica.fields(document))
			let metadata = documentMetadata(original)
			let pairs = wikiReplacements(original, token => {
				let target = places.get(token)
				return target ? archiveLinkPath(target.file) : titles.get(token)
			})
			let usedAssets = new Set<string>()
			let assetMetadata: (typeof AssetMetadataSchema.Type)[number][] = []
			let drawingAsset: string | undefined
			for (let asset of contents.assets) {
				let fields = replica.fields(asset.id)
				let bytes = media.get(asset.id)
				if (!bytes)
					return yield* new ArchiveInvalid({
						message:
							"Attachment bytes are unavailable: " + (fields.name || asset.id),
					})
				let type =
					blobContentType(asset.reference) ?? mediaType(fields.name ?? "")
				let file = uniqueName(
					assetFilename(fields.name || "attachment", type),
					usedAssets,
				)
				let path = place.directory + "assets/" + file
				pairs.push(["asset:" + asset.id, "assets/" + file])
				entries.push({ name: path, data: bytes })
				assetMetadata.push({
					path,
					id: asset.id,
					name: fields.name || file,
					type,
					muted: fields.muted === "true" ? "true" : "false",
				})
			}
			for (let board of contents.whiteboards) {
				let fields = replica.fields(board)
				let bytes = media.get(board)
				if (!bytes)
					return yield* new ArchiveInvalid({
						message: "Whiteboard preview is unavailable",
					})
				let file = uniqueName(
					assetFilename(fields.name || "Whiteboard", "image/svg+xml"),
					usedAssets,
				)
				let path = place.directory + "assets/" + file
				pairs.push(["asset:" + board, "assets/" + file])
				entries.push({ name: path, data: bytes })
				entries.push(
					json(path + ".alkalye-drawing.json", {
						format: "alkalye-drawing-v1",
						shapes: [...drawingShapes(fields).values()].map(shape => ({
							kind: shape.kind,
							color: shape.color,
							width: shape.width,
							points: shape.points,
							text: shape.text,
							...(shape.fill ? { fill: shape.fill } : {}),
						})),
					}),
				)
				assetMetadata.push({
					path,
					id: board,
					name: fields.name || "Whiteboard",
					type: "image/svg+xml",
					muted: "false",
				})
				if (board === replica.fields(document).whiteboard) drawingAsset = path
			}
			let rewritten = rewrite(original, pairs)
			let source = rewritten.text
			let themes: string[] = []
			let selectedTheme: string | undefined
			for (let id of contents.themes) {
				let name = replica.fields(id).name || "Theme"
				let themeSource = replica.text(id)
				let key = name + "\u0000" + themeSource
				let path = themePaths.get(key)
				if (!path) {
					path = uniqueName(
						"themes/" + safeFilename(name) + ".theme.md",
						usedThemePaths,
					)
					themePaths.set(key, path)
					entries.push({ name: path, data: encoder.encode(themeSource) })
					manifest.themes.push({ path, name })
				}
				themes.push(path)
				if (id === contents.selectedTheme) {
					selectedTheme = path
					if (frontmatter(source).values["theme-id"])
						source = withFrontmatter(source, {
							"theme-id": undefined,
							theme: name,
						})
				}
			}
			entries.push({ name: place.file, data: encoder.encode(source) })
			let comments = contents.comments.map(id => {
				let fields = replica.fields(id)
				let range = commentRange(replica, document, fields)
				if (range && stored !== original)
					range = relocatedRange(stored, original, range)
				let relocated =
					range &&
					relocatedRange(rewritten.text, source, {
						start: rewritten.offset(range.start),
						end: rewritten.offset(range.end),
					})
				return {
					id,
					quote: fields.quote ?? "",
					body: fields.body ?? "",
					author: fields.author ?? "",
					resolved: fields.resolved ?? "false",
					...Object.fromEntries(
						Object.entries(fields).filter(([key]) => key.startsWith("reply:")),
					),
					...(relocated
						? { selectionStart: relocated.start, selectionEnd: relocated.end }
						: {}),
				}
			})
			let stem = place.file.replace(/\.md$/, "")
			if (comments.length)
				entries.push(
					json(stem + ".comments.json", commentSidecar(source, comments)),
				)
			if (assetMetadata.length)
				entries.push(json(stem + ".assets.json", assetMetadata))
			manifest.documents.push({
				path: place.file,
				id: document,
				folder: metadata.path,
				...(selectedTheme ? { theme: selectedTheme } : {}),
				...(themes.length ? { themes } : {}),
				...(drawingAsset ? { drawingAsset } : {}),
			})
		}
		entries.push(json("alkalye.json", manifest))
		return entries
		function json(name: string, value: unknown) {
			return { name, data: encoder.encode(JSON.stringify(value, null, 2)) }
		}
	})
}

// Documents with attachments get their own folder so `assets/` stays theirs,
// matching the layout the original application exported.
function archiveLayout(snapshots: ReadonlyArray<ArchiveSnapshot>) {
	let used = new Set<string>()
	let places = new Map<string, { file: string; directory: string }>()
	for (let { document, replica, folder } of snapshots) {
		let metadata = documentMetadata(
			canonicalDocumentSource(replica.text(document), replica.fields(document)),
		)
		let contents = archiveContents(replica, document)
		let parent = [folder ?? "", ...metadata.path.split("/")]
			.filter(Boolean)
			.map(safeFilename)
			.join("/")
		let title = safeFilename(metadata.title)
		let name = title
		for (let suffix = 2; used.has(join(parent, name).toLowerCase()); suffix++)
			name = title + "-" + suffix
		used.add(join(parent, name).toLowerCase())
		let bundled = contents.assets.length > 0 || contents.whiteboards.length > 0
		let directory = bundled
			? join(parent, name) + "/"
			: parent
				? parent + "/"
				: ""
		places.set(document, { file: directory + name + ".md", directory })
	}
	return places
}

export function parseArchive(entries: ReadonlyArray<ZipEntry>) {
	return Effect.gen(function* () {
		let files = new Map<string, ZipEntry>()
		let size = 0
		for (let entry of entries) {
			if (isIgnored(entry.name)) continue
			if (
				files.has(entry.name) ||
				entry.name.startsWith("/") ||
				entry.name.includes("\\") ||
				entry.name
					.split("/")
					.some(part => !part || part === "." || part === "..")
			)
				return yield* invalid("Unsafe or duplicate archive path: " + entry.name)
			size += entry.data.byteLength
			if (size > maximumArchiveBytes || files.size >= maximumArchiveEntries)
				return yield* invalid("Archive exceeds its import limit")
			files.set(entry.name, entry)
		}
		let manifestEntry = files.get("alkalye.json")
		let manifest: Manifest = manifestEntry
			? yield* decodeJson(manifestEntry, ManifestSchema)
			: { format: "alkalye-portable-v1", documents: [], themes: [] }
		let markdown = [...files.values()].filter(
			entry =>
				/\.(md|markdown|txt)$/i.test(entry.name) &&
				!entry.name.endsWith(".theme.md"),
		)
		let documents: ImportedDocument[] = []
		let identities = new Set<string>()
		for (let entry of markdown) {
			let path = entry.name
			let declared = manifest.documents.find(document => document.path === path)
			if (declared?.id) {
				if (identities.has(declared.id))
					return yield* invalid("Duplicate archive document identity")
				identities.add(declared.id)
			}
			let original = yield* text(entry)
			if (original.length > maximumActionText)
				return yield* invalid(path + " is larger than 200,000 characters")
			let base = path.slice(0, path.lastIndexOf("/") + 1)
			let filename = (path.split("/").at(-1) ?? "").replace(
				/\.(md|markdown|txt)$/i,
				"",
			)
			let derived = documentMetadata(original)
			let title =
				derived.title === "Untitled" ? filename || "Untitled" : derived.title
			let folderParts = base.split("/").filter(Boolean)
			if (folderParts.at(-1)?.toLowerCase() === filename.toLowerCase())
				folderParts.pop()
			let assets = yield* documentAssets(files, markdown, path, original)
			if (
				assets.reduce((total, asset) => total + asset.data.byteLength, 0) >
				maximumDocumentBlobBytes
			)
				return yield* invalid(
					path + " has attachments beyond the storage limit",
				)
			let themes: ImportedTheme[] = []
			for (let themePath of new Set([
				...(declared?.themes ?? []),
				...(declared?.theme ? [declared.theme] : []),
			])) {
				let themeEntry = files.get(themePath)
				if (!themeEntry)
					return yield* invalid("Missing document theme: " + themePath)
				let source = yield* text(themeEntry)
				if (source.length > maximumActionText)
					return yield* invalid(
						themePath + " is larger than 200,000 characters",
					)
				yield* Effect.try({
					try: () => compileTheme(source),
					catch: () =>
						new ArchiveInvalid({ message: "Invalid theme: " + themePath }),
				})
				themes.push({
					path: themePath,
					name:
						manifest.themes.find(theme => theme.path === themePath)?.name ||
						"Theme",
					source,
				})
			}
			let drawingPath =
				declared?.drawing ??
				path.replace(/\.(md|markdown|txt)$/i, ".alkalye-drawing.json")
			let drawingEntry = files.get(drawingPath)
			if (declared?.drawing && !drawingEntry)
				return yield* invalid("Missing document drawing")
			let commentsEntry = files.get(
				path.replace(/\.(md|markdown|txt)$/i, ".comments.json"),
			)
			documents.push({
				path,
				original,
				title,
				folder: declared?.folder ?? folderParts.join("/"),
				assets,
				comments: commentsEntry ? yield* documentComments(commentsEntry) : [],
				themes,
				...(declared?.id ? { id: declared.id } : {}),
				...(declared?.theme ? { selectedTheme: declared.theme } : {}),
				...(drawingEntry ? { drawing: yield* drawing(drawingEntry) } : {}),
				...(declared?.drawingAsset
					? { drawingAsset: declared.drawingAsset }
					: {}),
			})
		}
		if (!documents.length)
			return yield* invalid("The archive contains no Markdown documents")
		for (let declared of manifest.documents)
			if (!documents.some(document => document.path === declared.path))
				return yield* invalid("Missing declared document: " + declared.path)
		let plan: ArchivePlan = { documents }
		return plan
	})
}

export function archiveIdentityKeys(plan: ArchivePlan) {
	return plan.documents.flatMap(document => [
		documentKey(document),
		...document.assets.map(asset => assetKey(document, asset)),
		...document.themes.map(theme => themeKey(document, theme)),
		...document.comments.map((_comment, index) => commentKey(document, index)),
		...(document.drawing ? [drawingKey(document)] : []),
	])
}
export function documentKey(document: ImportedDocument) {
	return "document:" + document.path
}

// The Markdown as it will be created: links point at fresh identities and
// frontmatter carries the folder and title the archive implied.
export function importedSource(
	plan: ArchivePlan,
	document: ImportedDocument,
	identities: ReadonlyMap<string, string>,
) {
	return Effect.gen(function* () {
		let pairs: [string, string][] = [["\r\n", "\n"]]
		let normalized = document.original.replaceAll("\r\n", "\n")
		pairs.push(
			...wikiReplacements(normalized, token => {
				let target = wikiTarget(plan, document, token)
				return target && identities.get(documentKey(target))
			}),
		)
		for (let asset of document.assets) {
			let id = yield* identity(identities, assetKey(document, asset))
			for (let destination of asset.destinations)
				pairs.push(["](" + destination + ")", "](asset:" + id + ")"])
		}
		let rewritten = rewrite(document.original, pairs)
		let source = rewritten.text
		let theme = document.themes.find(
			theme => theme.path === document.selectedTheme,
		)
		if (theme)
			source = withFrontmatter(source, {
				"theme-id": yield* identity(identities, themeKey(document, theme)),
				theme: undefined,
			})
		let header = frontmatter(source).data
		if (!Object.hasOwn(header, "path") && document.folder)
			source = metadataSource(source, { path: document.folder })
		if (documentMetadata(source).title !== document.title)
			source = metadataSource(source, { title: document.title })
		if (source.length > maximumActionText)
			return yield* invalid(
				document.path + " is larger than 200,000 characters",
			)
		return { source, pairs, rewritten: rewritten.text }
	})
}

// Everything after creation, split so each action stays within the server's
// operation and text limits. Every step is pure; retrying one replays the
// same intent against the current staged replica.
export function importSteps(
	plan: ArchivePlan,
	document: ImportedDocument,
	identities: ReadonlyMap<string, string>,
	references: ReadonlyMap<string, string>,
) {
	return Effect.gen(function* () {
		let id = yield* identity(identities, documentKey(document))
		let { source, pairs, rewritten } = yield* importedSource(
			plan,
			document,
			identities,
		)
		let records: { cost: number; text: number; build: ImportStep["build"] }[] =
			[]
		for (let asset of document.assets) {
			let target = yield* identity(identities, assetKey(document, asset))
			let shapes = asset.shapes
			if (shapes) {
				records.push({
					cost: 3,
					text: 0,
					build: staged => [
						staged.set(target, "type", "whiteboard"),
						staged.set(target, "document", id),
						staged.set(target, "name", asset.name),
						...(asset.path === document.drawingAsset
							? [staged.set(id, "whiteboard", target)]
							: []),
					],
				})
				records.push(...shapeRecords(target, shapes))
				continue
			}
			let reference = references.get(asset.path)
			if (!reference)
				return yield* invalid("Attachment was not stored: " + asset.path)
			records.push({
				cost: 5,
				text: 0,
				build: staged => [
					staged.set(target, "type", "asset"),
					staged.set(target, "document", id),
					staged.set(target, "name", asset.name),
					staged.set(target, "data", reference),
					...(asset.muted ? [staged.set(target, "muted", "true")] : []),
				],
			})
		}
		if (document.drawing) {
			let board = yield* identity(identities, drawingKey(document))
			records.push({
				cost: 4,
				text: 0,
				build: staged => [
					staged.set(board, "type", "whiteboard"),
					staged.set(board, "document", id),
					staged.set(board, "name", "Whiteboard"),
					staged.set(id, "whiteboard", board),
				],
			})
			records.push(...shapeRecords(board, document.drawing))
		}
		for (let theme of document.themes) {
			let target = yield* identity(identities, themeKey(document, theme))
			records.push({
				cost: 4,
				text: theme.source.length,
				build: staged => [
					staged.set(target, "type", "theme"),
					staged.set(target, "document", id),
					staged.set(target, "name", theme.name),
					staged.edit(target, theme.source),
				],
			})
		}
		for (let [index, comment] of document.comments.entries()) {
			let target = yield* identity(identities, commentKey(document, index))
			let anchor = importedCommentAnchor(document.original, pairs, {
				quote: comment.quote,
				selectionStart: comment.selectionStart,
				contextBefore: comment.contextBefore,
				contextAfter: comment.contextAfter,
				orphaned: comment.orphaned,
			})
			let range =
				anchor.start >= 0
					? relocatedRange(rewritten, source, {
							start: anchor.start,
							end: anchor.start + anchor.quote.length,
						})
					: undefined
			records.push({
				cost: 8 + Object.keys(comment.replies).length,
				text: 0,
				build: staged => {
					let captured = range
						? selectionAnchor(
								staged.visible(id),
								staged.text(id),
								anchor.quote,
								range.start,
							)
						: undefined
					return [
						staged.set(target, "type", "comment"),
						staged.set(target, "document", id),
						staged.set(target, "quote", anchor.quote),
						staged.set(target, "body", comment.body),
						staged.set(target, "author", comment.author),
						staged.set(target, "resolved", String(comment.resolved)),
						staged.set(target, "anchor", captured?.anchor ?? "[]"),
						staged.set(target, "source", captured?.source ?? "body"),
						...Object.entries(comment.replies).map(([field, value]) =>
							staged.set(target, field, value),
						),
					]
				},
			})
		}
		let steps: ImportStep[] = []
		let batch: typeof records = []
		let cost = 0,
			characters = 0
		for (let record of records) {
			if (
				batch.length &&
				(cost + record.cost > operationBudget ||
					characters + record.text > textBudget)
			) {
				steps.push(step(batch, steps.length))
				batch = []
				cost = 0
				characters = 0
			}
			batch.push(record)
			cost += record.cost
			characters += record.text
		}
		if (batch.length) steps.push(step(batch, steps.length))
		return steps
		function step(batch: typeof records, index: number): ImportStep {
			return {
				label: index ? "Import document contents" : "Import document",
				build: staged => batch.flatMap(record => record.build(staged)),
			}
		}
	})
}

function shapeRecords(board: string, shapes: ReadonlyArray<Shape>) {
	return shapes.map((shape, index) => ({
		cost: 1,
		text: 0,
		build: (staged: Replica) => [
			staged.set(
				board,
				"shape:imported-" + String(index).padStart(6, "0"),
				JSON.stringify({
					...shape,
					order: drawingOrder(staged.clock + 1, staged.actor, index),
				}),
			),
		],
	}))
}

function documentAssets(
	files: ReadonlyMap<string, ZipEntry>,
	markdown: ReadonlyArray<ZipEntry>,
	path: string,
	source: string,
) {
	return Effect.gen(function* () {
		let base = path.slice(0, path.lastIndexOf("/") + 1)
		let metadataEntry = files.get(
			path.replace(/\.(md|markdown|txt)$/i, ".assets.json"),
		)
		let metadata = metadataEntry
			? yield* decodeJson(metadataEntry, AssetMetadataSchema)
			: []
		let destinations = new Map<string, string[]>()
		for (let match of source.matchAll(/!\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
			let destination = match[1] ?? ""
			let target = destination.trim().replace(/\s+"[^"]*"$/, "")
			target = target.replace(/^<(.*)>$/, "$1")
			if (/^[a-z][\w+.-]*:|^\/\/|^#/i.test(target)) continue
			let resolved = resolveArchivePath(base, target)
			if (!files.has(resolved)) continue
			destinations.set(resolved, [
				...(destinations.get(resolved) ?? []),
				destination,
			])
		}
		let ownsFolder =
			base !== "" &&
			markdown.filter(
				entry => entry.name.slice(0, entry.name.lastIndexOf("/") + 1) === base,
			).length === 1
		let assets: ImportedAsset[] = []
		for (let entry of files.values()) {
			if (
				!destinations.has(entry.name) &&
				!(ownsFolder && entry.name.startsWith(base + "assets/"))
			)
				continue
			if (/\.(json|md|markdown|txt)$/i.test(entry.name)) continue
			let declared = metadata.find(value => value.path === entry.name)
			let drawingEntry = files.get(entry.name + ".alkalye-drawing.json")
			let tldraw = /\.tldr$/i.test(entry.name) ? entry : undefined
			let sidecar = drawingEntry ?? tldraw
			assets.push({
				path: entry.name,
				name: declared?.name || entry.name.split("/").at(-1) || "Attachment",
				type: declared?.type || mediaType(entry.name),
				muted: declared?.muted === "true",
				data: entry.data,
				destinations: [...new Set(destinations.get(entry.name) ?? [])],
				...(declared?.id ? { id: declared.id } : {}),
				...(sidecar ? { shapes: yield* drawing(sidecar) } : {}),
			})
		}
		return assets
	})
}

function documentComments(entry: ZipEntry) {
	return Effect.gen(function* () {
		let value = yield* decodeJson(entry, Schema.Unknown)
		let comments = yield* Effect.try({
			try: () => portableComments(value),
			catch: () =>
				new ArchiveInvalid({ message: "Invalid comments: " + entry.name }),
		})
		let result: ImportedComment[] = []
		for (let comment of comments) {
			let replies: Record<string, string> = {}
			for (let [key, reply] of Object.entries(comment)) {
				if (!/^reply:\d+:[\w-]+$/.test(key) || typeof reply !== "string")
					continue
				let decoded = yield* Schema.decodeUnknownEffect(
					Schema.fromJsonString(ReplySchema),
				)(reply).pipe(
					Effect.mapError(
						() =>
							new ArchiveInvalid({ message: "Invalid reply: " + entry.name }),
					),
				)
				replies[key] = JSON.stringify(decoded)
			}
			let quote = optionalString(comment.quote) ?? ""
			if (quote.length > commentSourceLimit)
				return yield* invalid("A comment quote is too long: " + entry.name)
			result.push({
				quote,
				body: optionalString(comment.body) ?? "",
				author: optionalString(comment.author) ?? "",
				resolved: comment.resolved === "true" || comment.resolved === true,
				orphaned: comment.orphaned === true,
				replies,
				...(typeof comment.selectionStart === "number"
					? { selectionStart: comment.selectionStart }
					: {}),
				...(typeof comment.contextBefore === "string"
					? { contextBefore: comment.contextBefore }
					: {}),
				...(typeof comment.contextAfter === "string"
					? { contextAfter: comment.contextAfter }
					: {}),
			})
		}
		return result
	})
}

function drawing(entry: ZipEntry) {
	return decodeJson(entry, Schema.Unknown).pipe(
		Effect.flatMap(value =>
			Effect.try({
				try: () => importDrawing(value),
				catch: error =>
					new ArchiveInvalid({
						message:
							(error instanceof Error ? error.message : "Invalid drawing") +
							": " +
							entry.name,
					}),
			}),
		),
	)
}

function wikiTarget(
	plan: ArchivePlan,
	document: ImportedDocument,
	token: string,
) {
	let parent = archiveLinkPath(document.path).split("/").slice(0, -1).join("/")
	let absolute = token.startsWith("/") ? token.slice(1) : undefined
	return (
		plan.documents.find(value => value.id === token) ??
		plan.documents.find(
			value => archiveLinkPath(value.path) === (absolute ?? token),
		) ??
		(absolute === undefined
			? plan.documents.find(
					value =>
						archiveLinkPath(value.path) === relativeLinkPath(parent, token),
				)
			: undefined) ??
		plan.documents.find(value => value.title === token)
	)
}

export function resolveArchivePath(base: string, path: string) {
	return decodedPath(
		new URL(
			path,
			"https://archive.invalid/" +
				base.split("/").map(encodeURIComponent).join("/"),
		).pathname.slice(1),
	)
}
export function safeFilename(value: string) {
	return (
		value
			.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
			.replace(/^\.+/, "")
			.trim()
			.slice(0, 120) || "Untitled"
	)
}
export function archiveDate(time: number) {
	return new Date(time).toISOString().slice(0, 10)
}

function assetFilename(name: string, type: string) {
	let file = name.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^[.-]+/, "")
	file = file.slice(0, 100) || "attachment"
	if (!/\.[\w]{1,8}$/.test(file)) file += extension(type)
	return file
}
function extension(type: string) {
	return (
		{
			"image/png": ".png",
			"image/jpeg": ".jpg",
			"image/gif": ".gif",
			"image/webp": ".webp",
			"image/avif": ".avif",
			"image/svg+xml": ".svg",
			"video/webm": ".webm",
			"video/mp4": ".mp4",
			"video/quicktime": ".mov",
			"audio/mpeg": ".mp3",
			"audio/ogg": ".ogg",
			"audio/wav": ".wav",
			"application/pdf": ".pdf",
		}[type] ?? ".bin"
	)
}
function uniqueName(name: string, used: Set<string>) {
	let dot = name.lastIndexOf(".")
	let stem = dot > name.lastIndexOf("/") + 1 ? name.slice(0, dot) : name
	let suffix = name.slice(stem.length)
	let candidate = name
	for (let index = 2; used.has(candidate.toLowerCase()); index++)
		candidate = stem + "-" + index + suffix
	used.add(candidate.toLowerCase())
	return candidate
}
function join(parent: string, name: string) {
	return parent ? parent + "/" + name : name
}
function isIgnored(name: string) {
	return (
		name.endsWith("/") ||
		name.startsWith("__MACOSX/") ||
		name.split("/").some(part => part === ".DS_Store")
	)
}
function text(entry: ZipEntry) {
	return Effect.try({
		try: () => new TextDecoder("utf-8", { fatal: true }).decode(entry.data),
		catch: () =>
			new ArchiveInvalid({ message: entry.name + " is not UTF-8 text" }),
	})
}
function decodeJson<S extends Schema.Top>(entry: ZipEntry, schema: S) {
	return text(entry).pipe(
		Effect.flatMap(source =>
			Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(source),
		),
		Effect.mapError(
			() => new ArchiveInvalid({ message: "Invalid " + entry.name }),
		),
	)
}
function identity(identities: ReadonlyMap<string, string>, key: string) {
	let value = identities.get(key)
	return value
		? Effect.succeed(value)
		: invalid("Missing imported identity for " + key)
}
function optionalString(value: unknown) {
	return typeof value === "string" ? value : undefined
}
function invalid(message: string) {
	return Effect.fail(new ArchiveInvalid({ message }))
}
function assetKey(document: ImportedDocument, asset: ImportedAsset) {
	return "asset:" + document.path + "\u0000" + asset.path
}
function themeKey(document: ImportedDocument, theme: ImportedTheme) {
	return "theme:" + document.path + "\u0000" + theme.path
}
function commentKey(document: ImportedDocument, index: number) {
	return "comment:" + document.path + "\u0000" + index
}
function drawingKey(document: ImportedDocument) {
	return "drawing:" + document.path
}
