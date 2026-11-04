import type { ReactNode } from "react"
import { cn } from "@/app/lib/cn"
import type { DemoCollaborator, DemoStageLabels, DemoView } from "./demo-script"

export { DemoChrome }

let views: DemoView[] = [
	"editor",
	"preview",
	"slideshow",
	"teleprompter",
	"whiteboard",
]

function DemoChrome({
	labels,
	view,
	people,
	children,
}: {
	labels: DemoStageLabels
	view: DemoView
	people: DemoCollaborator[]
	children: ReactNode
}) {
	return (
		<div
			data-demo-view={view}
			className="border-border bg-background relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden border shadow-2xl shadow-black/10 dark:shadow-black/40"
		>
			<div className="border-border flex h-10 shrink-0 items-center gap-3 border-b px-3">
				<span className="text-muted-foreground min-w-0 truncate font-mono text-xs">
					{labels.fileName}
				</span>
				<ol className="ml-auto flex items-center gap-1">
					{views.map(candidate => (
						<li
							key={candidate}
							aria-current={candidate === view ? "step" : undefined}
							className={cn(
								"px-2 py-0.5 text-xs whitespace-nowrap transition-[color,background-color,opacity] duration-300",
								candidate === view
									? "bg-foreground text-background"
									: "text-muted-foreground max-sm:hidden",
							)}
						>
							{labels.views[candidate]}
						</li>
					))}
				</ol>
				<ul className="flex -space-x-1.5">
					{people.map(person => (
						<li
							key={person.name}
							title={person.name}
							style={{ backgroundColor: person.color }}
							className="animate-in fade-in zoom-in-50 ring-background flex size-6 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-2 duration-500"
						>
							{person.name.slice(0, 1)}
						</li>
					))}
				</ul>
			</div>
			<div className="relative flex min-h-0 flex-1 flex-col">{children}</div>
		</div>
	)
}
