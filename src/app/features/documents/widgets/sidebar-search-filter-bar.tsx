import { IconTransition } from "@/app/components/ui/icon-transition"
import { Button } from "@/app/components/ui/button"
import { Input } from "@/app/components/ui/input"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu"
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/app/components/ui/tooltip"
import { useIntl } from "@/shared/intl/setup"
import { cn } from "@/app/lib/cn"
import {
	FileText,
	Folder,
	List,
	Presentation,
	Search,
	SlidersHorizontal,
	Trash2,
} from "lucide-react"

export { SidebarSearchFilterBar }
export type { SortMode, TypeFilter, CommonTypeFilter }

type SortMode = "latest" | "alphabetical"
type CommonTypeFilter = "all" | "document" | "presentation"
type TypeFilter = CommonTypeFilter | "deleted"

interface SidebarSearchFilterBarProps {
	search: string
	onSearchChange: (value: string) => void
	sort: SortMode
	onSortChange: (value: SortMode) => void
	typeFilter: TypeFilter
	onTypeChange: (value: CommonTypeFilter) => void
	onDeletedSelect?: () => void
	viewMode?: "folders" | "flat"
	onViewModeChange?: (value: "folders" | "flat") => void
	deletedCount?: number
	searchTestId?: string
	searchLabel?: string
	searchPlaceholder?: string
	filterLabel?: string
	className?: string
}

function SidebarSearchFilterBar({
	search,
	onSearchChange,
	sort,
	onSortChange,
	typeFilter,
	onTypeChange,
	onDeletedSelect,
	viewMode,
	onViewModeChange,
	deletedCount,
	searchTestId,
	searchLabel,
	searchPlaceholder,
	filterLabel,
	className,
}: SidebarSearchFilterBarProps) {
	let t = useIntl()
	let hasNonDefaultFilters = sort !== "latest" || typeFilter !== "all"

	return (
		<div
			className={cn(
				"border-border flex items-center gap-1 border-b p-2",
				className,
			)}
		>
			<div className="relative flex-1">
				<Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
				<Input
					data-testid={searchTestId}
					aria-label={searchLabel}
					placeholder={searchPlaceholder ?? t("doc.find")}
					value={search}
					onChange={event => onSearchChange(event.target.value)}
					className="h-10 pl-8 pointer-fine:h-9"
				/>
			</div>
			{viewMode && onViewModeChange && (
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								size="icon-sm"
								variant="ghost"
								aria-label={
									viewMode === "folders"
										? t("doc.sidebar.switchToFlatView")
										: t("doc.sidebar.switchToFolderView")
								}
								onClick={() =>
									onViewModeChange(viewMode === "folders" ? "flat" : "folders")
								}
							>
								<IconTransition
									active={viewMode === "folders" ? "on" : "off"}
									icons={{
										on: <Folder className="size-4" />,
										off: <List className="size-4" />,
									}}
									className="size-4"
								/>
							</Button>
						}
					/>
					<TooltipContent side="bottom">
						{viewMode === "folders"
							? t("doc.sidebar.switchToFlatView")
							: t("doc.sidebar.switchToFolderView")}
					</TooltipContent>
				</Tooltip>
			)}
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							size="icon-sm"
							variant={hasNonDefaultFilters ? "secondary" : "ghost"}
							aria-label={
								filterLabel ??
								`${t("doc.sidebar.sort")} ${t("doc.sidebar.type")}`
							}
						>
							<SlidersHorizontal className="size-4" />
						</Button>
					}
				/>
				<DropdownMenuContent align="end" className="w-48">
					<div className="px-2 py-1.5 text-xs font-medium">
						{t("doc.sidebar.sort")}
					</div>
					<DropdownMenuItem
						onClick={() => onSortChange("latest")}
						className={sort === "latest" ? "bg-accent" : ""}
					>
						{t("doc.sidebar.sortLatest")}
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={() => onSortChange("alphabetical")}
						className={sort === "alphabetical" ? "bg-accent" : ""}
					>
						{t("doc.sidebar.sortAlphabetical")}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<div className="px-2 py-1.5 text-xs font-medium">
						{t("doc.sidebar.type")}
					</div>
					<DropdownMenuItem
						onClick={() => onTypeChange("all")}
						className={typeFilter === "all" ? "bg-accent" : ""}
					>
						{t("doc.sidebar.typeAll")}
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={() => onTypeChange("document")}
						className={typeFilter === "document" ? "bg-accent" : ""}
					>
						<FileText className="size-4" />
						{t("doc.sidebar.typeDocuments")}
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={() => onTypeChange("presentation")}
						className={typeFilter === "presentation" ? "bg-accent" : ""}
					>
						<Presentation className="size-4" />
						{t("doc.sidebar.typePresentations")}
					</DropdownMenuItem>
					{onDeletedSelect && (
						<DropdownMenuItem
							onClick={onDeletedSelect}
							className={typeFilter === "deleted" ? "bg-accent" : ""}
						>
							<Trash2 className="size-4" />
							{t("doc.sidebar.typeDeleted")}
							{deletedCount && deletedCount > 0 ? ` (${deletedCount})` : ""}
						</DropdownMenuItem>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	)
}
