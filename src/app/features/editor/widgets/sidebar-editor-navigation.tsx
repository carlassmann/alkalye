import type { RefObject } from "react"
import { Command, ListTree, Search } from "lucide-react"
import {
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarSeparator,
} from "@/app/components/ui/sidebar"
import { useIntl } from "@/shared/intl/setup"
import type { MarkdownEditorRef } from "./editor"

export { SidebarEditorNavigation }

interface SidebarEditorNavigationProps {
	editor: RefObject<MarkdownEditorRef | null>
	onOpen: (open: () => void) => void
}

function SidebarEditorNavigation({
	editor,
	onOpen,
}: SidebarEditorNavigationProps) {
	let t = useIntl()

	return (
		<>
			<SidebarMenuItem>
				<SidebarMenuButton
					onClick={() => onOpen(() => editor.current?.openFind())}
					nativeButton
				>
					<Search className="size-4" />
					{t("doc.find")}
				</SidebarMenuButton>
			</SidebarMenuItem>
			<SidebarMenuItem>
				<SidebarMenuButton
					onClick={() => onOpen(() => editor.current?.openCommandPalette())}
					nativeButton
				>
					<Command className="size-4" />
					{t("editor.navigation.commandPalette")}
				</SidebarMenuButton>
			</SidebarMenuItem>
			<SidebarMenuItem>
				<SidebarMenuButton
					onClick={() => onOpen(() => editor.current?.openOutline())}
					nativeButton
				>
					<ListTree className="size-4" />
					{t("editor.navigation.documentOutline")}
				</SidebarMenuButton>
			</SidebarMenuItem>
			<SidebarSeparator />
		</>
	)
}
