import type { ReactNode } from "react"
import { cn } from "@/app/lib/cn"

export { SidebarFileRowContent }

interface SidebarFileRowContentProps {
	title: ReactNode
	metadata?: ReactNode
	description?: ReactNode
	leading?: ReactNode
	trailing?: ReactNode
	className?: string
}

function SidebarFileRowContent({
	title,
	metadata,
	description,
	leading,
	trailing,
	className,
}: SidebarFileRowContentProps) {
	return (
		<div className={cn("flex min-w-0 flex-1 items-center gap-2", className)}>
			{leading}
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				{metadata && (
					<div className="flex items-center gap-1.5">{metadata}</div>
				)}
				<span className="truncate text-sm font-medium">{title}</span>
				{description}
			</div>
			{trailing}
		</div>
	)
}
