import { co, z } from "jazz-tools-classic"
export { UserAccount, Document, Space, Theme, TldrawRevision }

let ImageAsset = co.map({
	type: z.literal("image"),
	name: z.string(),
	image: co.image(),
	createdAt: z.date(),
})

let VideoAsset = co.map({
	type: z.literal("video"),
	name: z.string(),
	video: co.fileStream(),
	mimeType: z.string(),
	muteAudio: z.boolean().optional(),
	createdAt: z.date(),
})

let TldrawRevision = co.map({
	snapshot: co.fileStream(),
	lightPreview: co.image(),
	darkPreview: co.image(),
	createdAt: z.date(),
})

let WhiteboardPresenceFeed = co.feed(
	z.object({
		open: z.boolean(),
	}),
)

let TldrawAsset = co.map({
	version: z.literal(1).optional(),
	type: z.literal("tldraw"),
	name: z.string(),
	revision: TldrawRevision,
	presence: co.optional(WhiteboardPresenceFeed),
	createdAt: z.date(),
})

let Asset = co.discriminatedUnion("type", [ImageAsset, VideoAsset, TldrawAsset])

let CursorEntry = z.object({
	position: z.number(),
	selectionEnd: z.number().optional(),
})

let CursorFeed = co.feed(CursorEntry)

let HighlightRange = z.object({
	start: z.number(),
	end: z.number(),
})

let CommentTextPosition = z.string()

let CommentAnchor = z.object({
	start: CommentTextPosition.optional(),
	end: CommentTextPosition.optional(),
	quote: z.string(),
	originalQuote: z.string().optional(),
	contextBefore: z.string(),
	contextAfter: z.string(),
	collapsed: z.boolean().optional(),
})

let CommentReply = co.map({
	body: z.string(),
	authorName: z.string().optional(),
	createdAt: z.date(),
	updatedAt: z.date().optional(),
	deletedAt: z.date().optional(),
})

let CommentThread = co.map({
	anchor: CommentAnchor,
	replies: co.list(CommentReply),
	resolvedAt: z.date().optional(),
	deletedAt: z.date().optional(),
	createdAt: z.date(),
	updatedAt: z.date(),
})

let ArchivedDocumentContent = co.map({
	content: co.plainText(),
	successor: co.optional(co.plainText()),
	cutoverFrontier: z.record(z.string(), z.number()),
	reconciledFrontier: z.record(z.string(), z.number()).optional(),
	successorSeedFrontier: z.record(z.string(), z.number()).optional(),
	successorReconciledFrontier: z.record(z.string(), z.number()).optional(),
	replaced: z.boolean().optional(),
	cutoverAt: z.date(),
	successorId: z.string(),
})

let Document = co.map({
	version: z.literal(1),
	content: co.plainText(),
	archivedContent: co.optional(co.list(ArchivedDocumentContent)),
	title: z.string().optional(),
	pinned: z.boolean().optional(),
	path: z.string().optional(),
	tags: z.array(z.string()).optional(),
	isPresentation: z.boolean().optional(),
	contentUpdatedAt: z.date().optional(),
	metadataUpdatedAt: z.date().optional(),
	assets: co.optional(co.list(Asset)),
	cursors: co.optional(CursorFeed),
	comments: co.optional(co.list(CommentThread)),
	commentsDisabled: z.boolean().optional(),
	deletedAt: z.date().optional(),
	presentationLine: z.number().optional(),
	highlightRange: HighlightRange.optional(),
	spaceId: z.string().optional(),
	createdAt: z.date(),
	updatedAt: z.date(),
})

let Space = co.map({
	name: z.string(),
	avatar: co.optional(co.image()),
	documents: co.list(Document),
	createdAt: z.date(),
	updatedAt: z.date(),
})

// Theme types: 'preview' for document preview, 'slideshow' for presentations, 'both' for both
let ThemeType = z.enum(["preview", "slideshow", "both"])

// Color preset for slideshow themes

// Asset stored within a theme (fonts, images)
let ThemeAsset = co.map({
	name: z.string(),
	mimeType: z.string(),
	data: co.fileStream(),
	createdAt: z.date(),
})

// Theme schema for custom themes
let Theme = co.map({
	version: z.literal(1),
	name: z.string(),
	author: z.string().optional(),
	description: z.string().optional(),
	type: ThemeType,
	css: co.plainText(),
	template: co.optional(co.plainText()),
	slideTemplate: co.optional(co.plainText()),
	sourceDocId: z.string().optional(),
	presets: z.string().optional(),
	assets: co.optional(co.list(ThemeAsset)),
	thumbnail: co.optional(co.image()),
	thumbnailDataUrl: z.string().optional(),
	createdAt: z.date(),
	updatedAt: z.date(),
})

let StatsBadgeUnit = z.enum(["words", "sentences", "tasks"])

let EditorSettings = z.object({
	lineWidth: z.number(),
	lineHeight: z.number(),
	letterSpacing: z.number(),
	fontSize: z.number(),
	strikethroughDoneTasks: z.boolean(),
	fadeDoneTasks: z.boolean(),
	highlightCurrentLine: z.boolean(),
	autoSortTasks: z.boolean(),
	spellcheck: z.boolean().optional(),
	spellcheckLanguage: z.enum(["", "en", "de"]).optional(),
	smartPairs: z.boolean().optional(),
	markerWrapping: z.boolean().optional(),
	tabIndent: z.boolean().optional(),
	smartPaste: z.boolean().optional(),
	autocomplete: z.boolean().optional(),
	showStatsBadge: z.boolean(),
	statsBadgeUnit: StatsBadgeUnit,
})

let Settings = co.map({
	editor: EditorSettings,
	defaultPreviewTheme: z.string().optional(),
	defaultSlideshowTheme: z.string().optional(),
	syntaxTheme: z.string().optional(),
})

let UserRoot = co.map({
	documents: co.list(Document),
	inactiveDocuments: co.optional(co.list(Document)),
	spaces: co.optional(co.list(Space)),
	settings: co.optional(Settings),
	themes: co.optional(co.list(Theme)),
	language: z.enum(["de", "en"]).optional(),
})
let UserAccount = co.account({
	profile: co.profile({ name: z.string() }),
	root: UserRoot,
})
