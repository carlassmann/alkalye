import type { ComponentProps } from "react"
import { ChevronDown, ChevronRight, Folder } from "lucide-react"
import { cn } from "@/app/lib/cn"

export { SidebarFolderButton }

function SidebarFolderButton({
	path,
	depth,
	isCollapsed,
	count,
	className,
	style,
	...props
}: ComponentProps<"button"> & {
	path: string
	depth: number
	isCollapsed: boolean
	count?: number
}) {
	return (
		<button
			type="button"
			aria-expanded={!isCollapsed}
			title={path}
			className={cn(
				"hover:bg-accent flex w-full items-center gap-1.5 px-2 py-2 text-left",
				className,
			)}
			style={{ paddingLeft: `${8 + depth * 8}px`, ...style }}
			{...props}
		>
			{isCollapsed ? (
				<ChevronRight className="text-muted-foreground size-4 shrink-0" />
			) : (
				<ChevronDown className="text-muted-foreground size-4 shrink-0" />
			)}
			<Folder className="text-muted-foreground size-4 shrink-0" />
			<span className="truncate text-sm font-medium">
				{path.split("/").pop() || path}
			</span>
			{count !== undefined && (
				<span className="text-muted-foreground ml-auto text-xs">{count}</span>
			)}
		</button>
	)
}
