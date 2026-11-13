import { isLaserPreview } from "../lib/laser-preview"
import { useNavigate } from "@tanstack/react-router"
import { useOne, useDb } from "jazz-tools/react"
import { app } from "@/jazz/schema"
import { useLibrary, useDocumentAssets } from "@/app/features/documents"
import { DocumentNotFound } from "@/app/components/error-states"
import { LaserReceiver } from "../widgets/laser-pointer"
import { Slideshow, getSlides } from "../widgets/slideshow"
import { useResolvedTheme } from "@/app/components/appearance"
import { parsePresentation, parsePresentationTheme } from "../lib/presentation"
import { useScreenWakeLock } from "../lib/screen-wake-lock"
export { SlideshowScreen }

function SlideshowScreen({ id }: { id: string }) {
	let navigate = useNavigate(),
		db = useDb()
	let { documents, ownerId, grants } = useLibrary()
	let { data: doc, isLoading } = useOne(app.documents.where({ id }))
	let appearance = useResolvedTheme()
	let assets = useDocumentAssets(
		id,
		parsePresentationTheme(doc?.content ?? "") ?? appearance,
	)
	useScreenWakeLock()
	if (isLoading) return <p role="status">Opening document…</p>
	if (!doc || doc.deletedAt) return <DocumentNotFound />
	let content = doc.content
	let wikilinks = new Map(
		documents.map(doc => [
			doc.id,
			{
				title: doc.title,
				exists: !doc.deletedAt,
				isPresentation: doc.isPresentation,
			},
		]),
	)
	let items = content ? parsePresentation(content) : []
	let slides = getSlides(items)
	let currentSlideNumber =
		doc.presentationLine !== null && items[doc.presentationLine]
			? items[doc.presentationLine].slideNumber
			: 1
	let canEditDoc =
		doc.ownerId === ownerId ||
		grants.some(grant => grant.documentId === id && grant.role !== "reader")
	let previewAppearance = isLaserPreview()
		? new URLSearchParams(window.location.search).get("laserAppearance")
		: null
	return (
		<>
			<LaserReceiver docId={id} slideNumber={currentSlideNumber} />
			<Slideshow
				appearanceOverride={
					previewAppearance === "dark" || previewAppearance === "light"
						? previewAppearance
						: undefined
				}
				content={content}
				assets={assets}
				slides={slides}
				wikilinks={wikilinks}
				currentSlideNumber={currentSlideNumber}
				onSlideChange={
					canEditDoc
						? slideNumber => {
								let idx = items.findIndex(
									item =>
										item.slideNumber === slideNumber && item.type === "block",
								)
								if (idx >= 0)
									void db.update(app.documents, id, { presentationLine: idx })
							}
						: undefined
				}
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
		</>
	)
}
