import { useEffect } from "react"
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
} from "@/app/components/ui/sidebar"
import { Button } from "@/app/components/ui/button"
import { cn } from "@/app/lib/cn"
import { useIntl } from "@/shared/intl/setup"

export { DocumentSidebar }

function DocumentSidebar({
	header,
	footer,
	tabs,
	activeTab,
	onTabChange,
	children,
}: {
	header?: React.ReactNode
	footer?: React.ReactNode
	tabs?: { id: string; label: string; count?: number }[]
	activeTab?: string
	onTabChange?: (tab: string) => void
	children: React.ReactNode
}) {
	let t = useIntl()
	useEffect(() => {
		let wrapper = document.querySelector<HTMLElement>(
			'[data-slot="sidebar-wrapper"]',
		)
		let width = activeTab === "comments" ? "22rem" : "14rem"
		if (!wrapper) return
		wrapper.style.setProperty("--right-sidebar-width", width)
		document.documentElement.style.setProperty("--right-sidebar-width", width)
		return () => {
			wrapper.style.setProperty("--right-sidebar-width", "14rem")
			document.documentElement.style.removeProperty("--right-sidebar-width")
		}
	}, [activeTab])

	return (
		<Sidebar
			side="right"
			collapsible="offcanvas"
			mobileTitle={t("editor.toolbar.documentTools")}
		>
			<SidebarHeader className="border-border gap-0 border-b p-0">
				<div
					className="flex flex-row items-center justify-between px-3"
					style={{ height: "48px" }}
				>
					<span className="text-sm font-medium">
						{t("doc.sidebar.document")}
					</span>
					<div className="flex items-center gap-1">{header}</div>
				</div>
				{tabs && activeTab && onTabChange && (
					<div className="grid grid-cols-2 border-t p-1">
						{tabs.map(tab => {
							let selected = activeTab === tab.id
							return (
								<Button
									key={tab.id}
									size="sm"
									variant="ghost"
									onClick={() => onTabChange(tab.id)}
									className={cn(
										"justify-center",
										selected &&
											"bg-foreground text-background pointer-fine:hover:bg-foreground pointer-fine:hover:text-background",
									)}
								>
									{tab.label}
									{tab.count !== undefined && tab.count > 0 && (
										<span
											className={cn(
												"ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded px-1.5 text-[11px] font-semibold",
												selected
													? "bg-background text-foreground"
													: "bg-brand text-white",
											)}
										>
											{tab.count}
										</span>
									)}
								</Button>
							)
						})}
					</div>
				)}
			</SidebarHeader>
			<SidebarContent>{children}</SidebarContent>
			<SidebarFooter className="border-border border-t">{footer}</SidebarFooter>
		</Sidebar>
	)
}
