import type { ReactNode } from "react"
import { cn } from "@/app/lib/cn"

export { IconTransition }

function IconTransition({
	active,
	icons,
	className,
}: {
	active: string
	icons: Record<string, ReactNode>
	className?: string
}) {
	return (
		<span
			aria-hidden="true"
			className={cn("icon-transition grid size-4 shrink-0", className)}
		>
			{Object.entries(icons).map(([name, icon]) => (
				<span
					key={name}
					data-visible={name === active}
					className="icon-transition-item col-start-1 row-start-1 flex items-center justify-center"
				>
					{icon}
				</span>
			))}
		</span>
	)
}
