import type { ReactNode } from "react"
import { cn } from "@/app/lib/cn"
import type {
	DemoCollaborator,
	DemoConnection,
	DemoStageLabels,
	DemoView,
} from "./demo-script"

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
	connection,
	children,
}: {
	labels: DemoStageLabels
	view: DemoView
	people: DemoCollaborator[]
	connection: DemoConnection | null
	children: ReactNode
}) {
	return (
		<div
			data-demo-view={view}
			className="border-border bg-background @container relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden border shadow-2xl shadow-black/10 dark:shadow-black/40"
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
									: "text-muted-foreground @max-xl:hidden",
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
							className={cn(
								"animate-in fade-in zoom-in-50 ring-background flex size-6 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-2 transition-[filter,opacity] duration-500",
								isOffline(connection, person) && "opacity-40 grayscale",
							)}
						>
							{person.name.slice(0, 1)}
						</li>
					))}
				</ul>
			</div>
			<div className="relative flex min-h-0 flex-1 flex-col">
				<div className="isolate flex min-h-0 flex-1 flex-col">{children}</div>
				{/* The page scroll drives the demo. Touches and wheel on the stage
				    must scroll the page, not the editor or canvas underneath. */}
				<div className="absolute inset-0" />
				{connection && (
					<ConnectionBadge connection={connection} labels={labels} />
				)}
			</div>
		</div>
	)
}

function ConnectionBadge({
	connection,
	labels,
}: {
	connection: DemoConnection
	labels: DemoStageLabels
}) {
	let { collaborator, state } = connection
	let label = state === "offline" ? labels.offline : labels.synced
	return (
		<p
			key={state}
			role="status"
			className={cn(
				"animate-in fade-in slide-in-from-top-1 absolute top-3 right-3 flex items-center gap-2 border px-2.5 py-1 text-xs shadow-sm duration-300",
				state === "offline"
					? "border-border bg-muted text-muted-foreground"
					: "border-transparent bg-emerald-600 text-white",
			)}
		>
			<span
				className={cn(
					"size-2 rounded-full",
					state === "offline" ? "border-[1.5px] border-current" : "bg-white",
				)}
			/>
			{label.replace("{name}", collaborator.name)}
		</p>
	)
}

function isOffline(
	connection: DemoConnection | null,
	person: DemoCollaborator,
): boolean {
	return (
		connection?.state === "offline" &&
		connection.collaborator.name === person.name
	)
}
