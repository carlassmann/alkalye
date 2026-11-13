import { useState } from "react"
import { Link, useNavigate } from "@tanstack/react-router"
import { useOne, useDb } from "jazz-tools/react"
import { app } from "@/jazz/schema"
import { useLibrary, useDocumentAccess } from "@/app/features/documents"
import { FileText } from "lucide-react"
import {
	DocumentNotFound,
	DocumentUnauthorized,
} from "@/app/components/error-states"
import {
	Empty,
	EmptyHeader,
	EmptyTitle,
	EmptyDescription,
	EmptyContent,
} from "@/app/components/ui/empty"
import { Button } from "@/app/components/ui/button"
import { useWidePresentation } from "../lib/presentation-layout"
import { LaserPreview } from "../widgets/laser-pointer"
import { Teleprompter, groupBySlide } from "../widgets/teleprompter"
import { TeleprompterTopBar } from "../widgets/teleprompter-top-bar"
import { parsePresentation } from "../lib/presentation"
import { useScreenWakeLock } from "../lib/screen-wake-lock"
import { T } from "@/shared/intl/setup"

export { TeleprompterScreen }
function TeleprompterScreen({ id }: { id: string }) {
	let db = useDb()
	let { documents } = useLibrary()
	let { data: doc, isLoading } = useOne(app.documents.where({ id }))
	let navigate = useNavigate()
	let wide = useWidePresentation()
	let [desktopPreview, setDesktopPreview] = useState(true)
	let [mobilePreview, setMobilePreview] = useState(false)
	let previewVisible = wide ? desktopPreview : mobilePreview
	function setPreviewVisible(visible: boolean) {
		if (wide) setDesktopPreview(visible)
		else setMobilePreview(visible)
	}

	let { canEdit: canEdit } = useDocumentAccess(doc)
	useScreenWakeLock()

	if (isLoading) return <p role="status">Opening document…</p>
	if (!doc || doc.deletedAt) return <DocumentNotFound />
	if (!canEdit) return <DocumentUnauthorized />
	let content = doc.content
	let wikilinks = new Map(
		documents.map(doc => [
			doc.id,
			{
				id: doc.id,
				title: doc.title,
				exists: !doc.deletedAt,
				isPresentation: doc.isPresentation,
			},
		]),
	)
	let items = content ? parsePresentation(content) : []

	if (items.length === 0) {
		return (
			<Empty className="h-screen">
				<EmptyHeader>
					<FileText className="text-muted-foreground size-8" />
					<EmptyTitle>
						<T k="presentation.teleprompter.noSlides" />
					</EmptyTitle>
					<EmptyDescription>
						<T k="presentation.teleprompter.addHeadings" />
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button
						variant="outline"
						nativeButton={false}
						render={<Link to="/doc/$id" params={{ id }} />}
					>
						<T k="presentation.teleprompter.backToEditor" />
					</Button>
				</EmptyContent>
			</Empty>
		)
	}

	let slideGroups = groupBySlide(items)
	let currentSlideNumber =
		doc.presentationLine !== null && items[doc.presentationLine]
			? items[doc.presentationLine].slideNumber
			: 0
	let currentSlideIdx = slideGroups.findIndex(
		s => s.slideNumber === currentSlideNumber,
	)

	return (
		<div className="bg-background fixed inset-0 flex flex-col">
			<TeleprompterTopBar
				editorLink={<Link to="/doc/$id" params={{ id }} />}
				slideshowHref={`/app/doc/${id}/slideshow`}
				wide={wide}
				previewVisible={previewVisible}
				onTogglePreview={() => setPreviewVisible(!previewVisible)}
				currentSlideIdx={currentSlideIdx}
				totalSlides={slideGroups.length}
			/>
			<div className="flex min-h-0 flex-1 flex-col md:flex-row">
				<div className="flex min-h-0 min-w-0 flex-1 flex-col">
					<Teleprompter
						inactive={!wide && mobilePreview}
						items={items}
						wikilinks={wikilinks}
						presentationIndex={doc.presentationLine ?? undefined}
						onIndexChange={index =>
							void db.update(app.documents, id, { presentationLine: index })
						}
						onExit={() => navigate({ to: "/doc/$id", params: { id } })}
					/>
				</div>
				<LaserPreview
					key={id}
					docId={id}
					visible={previewVisible}
					dialog={!wide}
					onClose={() => setMobilePreview(false)}
				/>
			</div>
		</div>
	)
}
