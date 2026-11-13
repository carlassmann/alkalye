import { z } from "zod"
import { EditorSettings } from "@/jazz/value-types"
export { importItemSchema, proofSchema, classicIdSchema }
export type { ImportItem, ClassicProof }

let classicIdSchema = z.string().regex(/^co_z[1-9A-HJ-NP-Za-km-z]+$/)
let date = z.coerce.date()
let bytes = z.object({
	base64: z.string().optional(),
	uploadId: z.string().optional(),
	sha256: z.string().regex(/^[0-9a-f]{64}$/),
})
let version = z.object({
	classicId: z.string(),
	content: z.string(),
	authorId: z.string(),
	authorName: z.string().optional(),
	createdAt: date,
})
let comment = z.object({
	classicId: classicIdSchema,
	authorId: z.string(),
	anchor: z.object({
		quote: z.string(),
		contextBefore: z.string(),
		contextAfter: z.string(),
		start: z.number().optional(),
		end: z.number().optional(),
	}),
	createdAt: date,
	updatedAt: date,
	resolvedAt: date.optional(),
	deletedAt: date.optional(),
	replies: z.array(
		z.object({
			classicId: classicIdSchema,
			authorId: z.string(),
			authorName: z.string().optional(),
			body: z.string(),
			createdAt: date,
			updatedAt: date.optional(),
			deletedAt: date.optional(),
		}),
	),
})
let revision = z.object({
	classicId: classicIdSchema,
	snapshot: bytes,
	lightPreview: bytes,
	darkPreview: bytes,
	createdAt: date,
})
let asset = z.object({
	classicId: classicIdSchema,
	type: z.enum(["image", "video", "tldraw"]),
	name: z.string(),
	data: bytes.optional(),
	mimeType: z.string().optional(),
	muteAudio: z.boolean().optional(),
	width: z.number().int().optional(),
	height: z.number().int().optional(),
	revisionId: classicIdSchema.optional(),
	revisions: z.array(revision),
	createdAt: date,
})
let importItemSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("document"),
		classicId: classicIdSchema,
		content: z.string(),
		title: z.string(),
		spaceId: classicIdSchema.optional(),
		tags: z.array(z.string()),
		pinned: z.boolean(),
		path: z.string().optional(),
		archived: z.boolean(),
		isPresentation: z.boolean(),
		commentsDisabled: z.boolean(),
		presentationLine: z.number().int().optional(),
		highlightRange: z.json().optional(),
		createdAt: date,
		updatedAt: date,
		deletedAt: date.optional(),
		versions: z.array(version).max(200),
		comments: z.array(comment),
		assets: z.array(asset),
	}),
	z.object({
		kind: z.literal("space"),
		classicId: classicIdSchema,
		name: z.string(),
		avatar: bytes.optional(),
		createdAt: date,
		updatedAt: date,
	}),
	z.object({
		kind: z.literal("account"),
		classicId: classicIdSchema,
		name: z.string(),
		language: z.enum(["en", "de"]),
		editor: EditorSettings,
		defaultPreviewTheme: classicIdSchema.optional(),
		defaultSlideshowTheme: classicIdSchema.optional(),
		syntaxTheme: z.string().optional(),
	}),
	z.object({
		kind: z.literal("theme"),
		classicId: classicIdSchema,
		name: z.string(),
		author: z.string().optional(),
		description: z.string().optional(),
		type: z.enum(["preview", "slideshow", "both"]),
		css: z.string(),
		template: z.string().optional(),
		slideTemplate: z.string().optional(),
		sourceDocId: classicIdSchema.optional(),
		presets: z.json().optional(),
		thumbnail: bytes.optional(),
		thumbnailDataUrl: z.string().optional(),
		assets: z.array(
			z.object({
				classicId: classicIdSchema,
				name: z.string(),
				mimeType: z.string(),
				data: bytes,
				createdAt: date,
			}),
		),
		createdAt: date,
		updatedAt: date,
	}),
])
let proofSchema = z.object({
	challengeId: z.uuid(),
	classicId: classicIdSchema,
	agentId: z.templateLiteral(["sealer_z", z.string(), "/signer_z", z.string()]),
	signature: z.templateLiteral(["signature_z", z.string()]),
})
type ImportItem = z.infer<typeof importItemSchema>
type ClassicProof = z.infer<typeof proofSchema>
