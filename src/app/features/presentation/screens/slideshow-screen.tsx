import { useNavigate } from "@tanstack/react-router"
import { useCoState } from "jazz-tools/react"
import { type ResolveQuery, co } from "jazz-tools"
import { Document } from "@/schema"
import {
	DocumentNotFound,
	DocumentUnauthorized,
} from "@/app/components/error-states"
import { parseWikiLinks } from "@/app/features/editor"
import {
	resolveDocTitles,
	useDocTitles,
	type ResolvedDoc,
} from "@/app/features/documents"
import { canEdit } from "@/app/features/sharing"
import { Slideshow, type Slide } from "../widgets/slideshow"
import { parsePresentation, type PresentationItem } from "../lib/presentation"
import { useScreenWakeLock } from "../lib/screen-wake-lock"
import { assetPreviewResolve } from "@/app/features/assets"

export { SlideshowScreen, resolve, loadWikilinkCache }
export type { LoaderData }

let resolve = {
	content: true,
	assets: {
		$each: assetPreviewResolve,
	},
} as const satisfies ResolveQuery<typeof Document>

type LoadedDoc = co.loaded<typeof Document, typeof resolve>

interface LoaderData {
	doc: LoadedDoc | null
	loadingState: string | null
	wikilinkCache: Map<string, ResolvedDoc>
}

async function loadWikilinkCache(
	doc: LoadedDoc,
): Promise<Map<string, ResolvedDoc>> {
	let content = doc.content?.toString() ?? ""
	let wikilinks = parseWikiLinks(content)
	let wikilinkIds = wikilinks.map(w => w.id)
	return resolveDocTitles(wikilinkIds)
}

interface SlideshowScreenProps {
	id: string
	loaderData: LoaderData
}

function SlideshowScreen({ id, loaderData }: SlideshowScreenProps) {
	let navigate = useNavigate()

	useScreenWakeLock()

	let subscribedDoc = useCoState(Document, id, { resolve })

	let content =
		(subscribedDoc.$isLoaded
			? subscribedDoc
			: loaderData.doc
		)?.content?.toString() ?? ""
	let wikilinkIds = parseWikiLinks(content).map(w => w.id)
	let wikilinks = useDocTitles(wikilinkIds, loaderData.wikilinkCache)

	if (!loaderData.doc) {
		if (loaderData.loadingState === "unauthorized")
			return <DocumentUnauthorized />
		return <DocumentNotFound />
	}

	if (
		!subscribedDoc.$isLoaded &&
		subscribedDoc.$jazz.loadingState !== "loading"
	) {
		if (subscribedDoc.$jazz.loadingState === "unauthorized")
			return <DocumentUnauthorized />
		return <DocumentNotFound />
	}

	let doc = subscribedDoc.$isLoaded ? subscribedDoc : loaderData.doc
	let items = content ? parsePresentation(content) : []
	let slides = getSlides(items)

	let currentSlideNumber =
		doc.presentationLine !== undefined && items[doc.presentationLine]
			? items[doc.presentationLine].slideNumber
			: 1

	let assets = doc.assets?.$isLoaded
		? doc.assets.filter(asset => asset?.$isLoaded)
		: []
	let canEditDoc = canEdit(doc)

	return (
		<Slideshow
			content={content}
			slides={slides}
			assets={assets}
			wikilinks={wikilinks}
			currentSlideNumber={currentSlideNumber}
			highlightRange={doc.highlightRange ?? null}
			onSlideChange={canEditDoc ? makeSlideChange(doc, items) : undefined}
			onExit={
				canEditDoc
					? () => navigate({ to: "/doc/$id", params: { id } })
					: undefined
			}
			onGoToTeleprompter={
				canEditDoc
					? () => navigate({ to: "/doc/$id/teleprompter", params: { id } })
					: undefined
			}
		/>
	)
}

function makeSlideChange(doc: LoadedDoc, items: PresentationItem[]) {
	return function handleSlideChange(slideNumber: number) {
		let idx = items.findIndex(
			i => i.slideNumber === slideNumber && i.type === "block",
		)
		if (idx >= 0) {
			doc.$jazz.set("presentationLine", idx)
		}
	}
}

function getSlides(items: PresentationItem[]): Slide[] {
	let slideMap = new Map<number, Slide["blocks"]>()
	for (let item of items) {
		if (item.type === "block") {
			let blocks = slideMap.get(item.slideNumber) ?? []
			blocks.push(item.block)
			slideMap.set(item.slideNumber, blocks)
		}
	}
	return Array.from(slideMap.entries())
		.sort((a, b) => a[0] - b[0])
		.map(([slideNumber, blocks]) => ({ slideNumber, blocks }))
}
