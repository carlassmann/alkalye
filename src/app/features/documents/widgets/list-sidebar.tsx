import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
} from "@/app/components/ui/sidebar"
import { ImportDropZone, type ImportedFile } from "@/app/features/import-export"
import { useIntl } from "@/shared/intl/setup"
import { useLocation } from "@tanstack/react-router"
import { useEffect } from "react"
import { writeStorageMode } from "@/app/lib/storage-mode"
import { StorageModeMenu } from "@/app/components/storage-mode-menu"
import { SidebarSyncStatus } from "@/app/components/sidebar-sync-status"

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
	let location = useLocation()
	let isFilesystem = location.pathname === "/local"
	useEffect(() => {
		writeStorageMode(isFilesystem ? "filesystem" : "synced")
	}, [isFilesystem])
	return (
		<Sidebar
			side="left"
			collapsible="offcanvas"
			mobileTitle={
				isFilesystem ? "Filesystem" : t("doc.sidebar.syncedDocuments")
			}
		>
			<SidebarHeader
				className="border-border flex-row items-center justify-between border-b p-2"
				style={{ height: "48px" }}
			>
				<span className="text-foreground px-2 text-sm font-semibold">
					Alkalye
				</span>
				<div className="flex items-center gap-1">
					{isFilesystem && <StorageModeMenu />}
					{header}
				</div>
			</SidebarHeader>

			<SidebarContent className="relative">
				{onImport ? (
					<ImportDropZone onImport={onImport}>{children}</ImportDropZone>
				) : (
					children
				)}
			</SidebarContent>

			<SidebarFooter className="border-border flex flex-row gap-2 border-t">
				{footer ?? (isFilesystem ? <SidebarSyncStatus /> : null)}
			</SidebarFooter>
		</Sidebar>
	)
}
