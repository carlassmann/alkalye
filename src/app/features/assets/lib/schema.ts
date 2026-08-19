import { co, z } from "jazz-tools"

export {
	ImageAsset,
	VideoAsset,
	TldrawRevision,
	WhiteboardPresenceFeed,
	TldrawAsset,
	Asset,
}

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
