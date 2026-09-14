import type { ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu"
import { Button } from "@/app/components/ui/button"
import { cn } from "@/app/lib/cn"

export { WorkspaceSelector }

interface WorkspaceSelectorProps {
	label: ReactNode
	icon: ReactNode
	actions?: ReactNode
	children: ReactNode
	triggerTestId?: string
	className?: string
}

function WorkspaceSelector({
	label,
	icon,
	actions,
	children,
	triggerTestId,
	className,
}: WorkspaceSelectorProps) {
	return (
		<DropdownMenu>
			<div className={cn("flex items-center gap-1 border-b p-2", className)}>
				<DropdownMenuTrigger
					render={
						<Button
							variant="ghost"
							className="flex-1 justify-between"
							nativeButton
							data-testid={triggerTestId}
						>
							<span className="inline-flex min-w-0 items-center gap-3">
								{icon}
								<span className="truncate">{label}</span>
							</span>
							<ChevronDown />
						</Button>
					}
				/>
				{actions}
			</div>
			<DropdownMenuContent align="center" sideOffset={4}>
				{children}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
