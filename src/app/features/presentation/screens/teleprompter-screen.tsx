import { Link, useNavigate } from "@tanstack/react-router"
import { useCoState } from "jazz-tools/react"
import { type ResolveQuery, co } from "jazz-tools"
import { FileText } from "lucide-react"
import { Document } from "@/schema"
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
import { parseWikiLinks } from "@/app/features/editor"
import {
	resolveDocTitles,
	useDocTitles,
	type ResolvedDoc,
} from "@/app/features/documents"
import { LaserPreview } from "../widgets/laser-pointer"
import { Teleprompter, groupBySlide } from "../widgets/teleprompter"
import { parsePresentation } from "../lib/presentation"
import { useScreenWakeLock } from "../lib/screen-wake-lock"
import { T, useIntl } from "@/shared/intl/setup"

export { TeleprompterScreen, resolve, loadWikilinkCache }
export type { LoaderData }

let resolve = {
	content: true,
} as const satisfies ResolveQuery<typeof Document>

type LoadedDoc = co.loaded<typeof Document, typeof resolve>

interface LoaderData {
	doc: LoadedDoc | null
	loadingState: "unauthorized" | "unavailable" | null
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

interface TeleprompterScreenProps {
	id: string
	loaderData: LoaderData
}

function TeleprompterScreen({ id, loaderData }: TeleprompterScreenProps) {
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
		doc.presentationLine !== undefined && items[doc.presentationLine]
			? items[doc.presentationLine].slideNumber
			: 0
	let currentSlideIdx = slideGroups.findIndex(
		s => s.slideNumber === currentSlideNumber,
	)

	return (
		<div className="bg-background fixed inset-0 flex flex-col">
			<TopBar
				id={id}
				currentSlideIdx={currentSlideIdx}
				totalSlides={slideGroups.length}
			/>
			<div className="flex min-h-0 flex-1 flex-col md:flex-row">
				<div className="flex min-h-0 min-w-0 flex-1 flex-col">
					<Teleprompter
						items={items}
						wikilinks={wikilinks}
						presentationIndex={doc.presentationLine}
						onIndexChange={index => doc.$jazz.set("presentationLine", index)}
						onExit={() => navigate({ to: "/doc/$id", params: { id } })}
					/>
				</div>
				<LaserPreview key={id} docId={id} />
			</div>
		</div>
	)
}

function TopBar({
	id,
	currentSlideIdx,
	totalSlides,
}: {
	id: string
	currentSlideIdx: number
	totalSlides: number
}) {
	let t = useIntl()
	return (
		<div
			className="border-border relative flex shrink-0 items-center justify-between border-b px-4 py-2"
			style={{
				paddingTop: "max(0.5rem, env(safe-area-inset-top))",
				paddingLeft: "max(1rem, env(safe-area-inset-left))",
				paddingRight: "max(1rem, env(safe-area-inset-right))",
			}}
		>
			<Button
				variant="ghost"
				size="sm"
				nativeButton={false}
				render={<Link to="/doc/$id" params={{ id }} />}
			>
				<T k="presentation.teleprompter.editor" />
			</Button>
			<span className="text-muted-foreground absolute left-1/2 -translate-x-1/2 text-sm">
				{t("presentation.teleprompter.slideIndicator", {
					index: String(currentSlideIdx + 1),
					total: String(totalSlides),
				})}
			</span>
			<Button
				variant="ghost"
				size="sm"
				nativeButton={false}
				render={
					<a
						href={`/doc/${id}/slideshow`}
						target="_blank"
						rel="noopener noreferrer"
					/>
				}
			>
				<T k="presentation.teleprompter.slideshow" />
			</Button>
		</div>
	)
}
