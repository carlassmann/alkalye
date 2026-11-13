import { type LibraryDocument, canEdit } from "@/app/features/documents"
import { Link } from "@tanstack/react-router"
import { SidebarMenuButton, SidebarMenuItem } from "@/app/components/ui/sidebar"
import { Presentation, ScrollText } from "lucide-react"
import { getPresentationMode } from "../lib/presentation"
import { T } from "@/shared/intl/setup"

export { SidebarPresentationLinks }

type LoadedDocument = LibraryDocument & { content: string }

interface SidebarPresentationLinksProps {
	doc: LoadedDocument
}

function SidebarPresentationLinks({ doc }: SidebarPresentationLinksProps) {
	let docId = doc.id
	let content = doc.content
	let isPresentation = getPresentationMode(content)
	let readOnly = !canEdit(doc)

	if (!isPresentation) return null

	return (
		<>
			<SidebarMenuItem>
				<SidebarMenuButton
					render={<Link to="/doc/$id/slideshow" params={{ id: docId }} />}
				>
					<Presentation className="size-4" />
					<T k="presentation.slideshow.label" />
				</SidebarMenuButton>
			</SidebarMenuItem>
			<SidebarMenuItem>
				{readOnly ? (
					<SidebarMenuButton disabled>
						<ScrollText className="size-4" />
						<T k="presentation.teleprompter.label" />
					</SidebarMenuButton>
				) : (
					<SidebarMenuButton
						render={<Link to="/doc/$id/teleprompter" params={{ id: docId }} />}
					>
						<ScrollText className="size-4" />
						<T k="presentation.teleprompter.label" />
					</SidebarMenuButton>
				)}
			</SidebarMenuItem>
		</>
	)
}
