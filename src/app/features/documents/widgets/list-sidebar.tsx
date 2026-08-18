import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
} from "@/app/components/ui/sidebar"
import { ImportDropZone, type ImportedFile } from "@/app/features/import-export"
import { useIntl } from "@/shared/intl/setup"

export { ListSidebar }

function ListSidebar({
	header,
	footer,
	children,
	onImport,
}: {
	header?: React.ReactNode
	footer?: React.ReactNode
	children: React.ReactNode
	onImport?: (files: ImportedFile[]) => Promise<void>
}) {
	let t = useIntl()
	return (
		<Sidebar
			side="left"
			collapsible="offcanvas"
			mobileTitle={t("doc.sidebar.syncedDocuments")}
		>
			<SidebarHeader
				className="border-border flex-row items-center justify-between border-b p-2"
				style={{ height: "48px" }}
			>
				<span className="text-foreground px-2 text-sm font-semibold">
					Alkalye
				</span>
				<div className="flex items-center gap-1">{header}</div>
			</SidebarHeader>

			<SidebarContent className="relative">
				{onImport ? (
					<ImportDropZone onImport={onImport}>{children}</ImportDropZone>
				) : (
					children
				)}
			</SidebarContent>

			<SidebarFooter className="border-border flex flex-row gap-2 border-t">
				{footer}
			</SidebarFooter>
		</Sidebar>
	)
}
