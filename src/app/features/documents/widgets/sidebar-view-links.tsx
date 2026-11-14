import { Link } from "@tanstack/react-router"
import { type LibraryDocument } from "../lib/library"
import { SidebarMenuButton, SidebarMenuItem } from "@/app/components/ui/sidebar"
import { Eye } from "lucide-react"
import { useIntl } from "@/shared/intl/setup"

export { SidebarViewLinks }

type LoadedDocument = LibraryDocument

interface SidebarViewLinksProps {
	doc: LoadedDocument
}

function SidebarViewLinks({ doc }: SidebarViewLinksProps) {
	let t = useIntl()
	let docId = doc.id
	return (
		<SidebarMenuItem>
			<SidebarMenuButton
				render={
					<Link
						to="/doc/$id/preview"
						params={{ id: docId }}
						search={{ from: undefined }}
					/>
				}
			>
				<Eye className="size-4" />
				{t("doc.preview")}
			</SidebarMenuButton>
		</SidebarMenuItem>
	)
}
