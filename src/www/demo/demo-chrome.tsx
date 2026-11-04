import type { ReactNode } from "react"
import { BotIcon, LaptopIcon, SmartphoneIcon } from "lucide-react"
import type { DemoCollaborator, DemoStageLabels, DemoView } from "./demo-script"

export { DemoChrome, CollaboratorIcon }

function DemoChrome({
	labels,
	view,
	people,
	interactive,
	children,
}: {
	labels: DemoStageLabels
	view: DemoView
	people: DemoCollaborator[]
	interactive: boolean
	children: ReactNode
}) {
	return (
		<div
			data-demo-view={view}
			className="border-border bg-background @container relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden border shadow-2xl shadow-black/10 dark:shadow-black/40"
		>
			<div className="border-border bg-muted/40 grid h-9 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b px-3">
				<span className="flex gap-1.5" aria-hidden>
					<span className="bg-muted-foreground/30 size-2.5 rounded-full" />
					<span className="bg-muted-foreground/30 size-2.5 rounded-full" />
					<span className="bg-muted-foreground/30 size-2.5 rounded-full" />
				</span>
				<p className="text-muted-foreground min-w-0 truncate text-xs">
					<span className="font-mono">{labels.fileName}</span>
					<span key={view} className="animate-in fade-in duration-300">
						{" · "}
						{labels.views[view]}
					</span>
				</p>
				<ul className="flex -space-x-1.5 justify-self-end">
					{people.map(person => (
						<li
							key={person.name}
							title={person.name}
							style={{ backgroundColor: person.color }}
							className="animate-in fade-in zoom-in-50 ring-background flex size-6 items-center justify-center rounded-full text-white ring-2 duration-500"
						>
							<CollaboratorIcon collaborator={person} className="size-3" />
							<span className="sr-only">{person.name}</span>
						</li>
					))}
				</ul>
			</div>
			<div className="relative flex min-h-0 flex-1 flex-col">
				<div className="isolate flex min-h-0 flex-1 flex-col">{children}</div>
				{/* The page scroll drives the demo. Touches and wheel on the views
				    must scroll the page, not the canvas or slides underneath.
				    The editor stays open for visitors to type in. */}
				{!interactive && <div className="absolute inset-0" />}
			</div>
		</div>
	)
}

function CollaboratorIcon({
	collaborator,
	className,
}: {
	collaborator: DemoCollaborator
	className?: string
}) {
	if (collaborator.device === "phone") {
		return <SmartphoneIcon className={className} aria-hidden />
	}
	if (collaborator.device === "agent") {
		return <BotIcon className={className} aria-hidden />
	}
	return <LaptopIcon className={className} aria-hidden />
}
