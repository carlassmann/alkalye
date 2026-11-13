export type { EditorAsset, SidebarAsset, PrintableAsset }
interface EditorAsset {
	id: string
	name: string
	type: "image" | "video" | "tldraw"
	previewId?: string
	previewUrl?: string
	videoUrl?: string
	video?: { $isLoaded?: boolean; toBlob?: () => Blob | undefined }
	muteAudio?: boolean
}

interface SidebarAsset {
	id: string
	name: string
	type: "image" | "video" | "tldraw"
	imageId?: string
	imageUrl?: string
	lightPreviewId?: string
	lightPreviewUrl?: string
	darkPreviewId?: string
	darkPreviewUrl?: string
	tldrawRevisionId?: string
	getVideoBlob?: () => Blob | undefined
	muteAudio?: boolean
}

interface PrintableAsset {
	id: string
	name: string
	type: "image" | "video" | "tldraw"
	getBlob: () => Promise<Blob | undefined>
}
