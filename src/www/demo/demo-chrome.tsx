import type { ReactNode } from "react"
import { BotIcon, LaptopIcon, SmartphoneIcon, UserIcon } from "lucide-react"
import { cn } from "@/app/lib/cn"
import type { DemoCollaborator, DemoStageLabels, DemoView } from "./demo-script"

export { DemoChrome, CollaboratorIcon }

function DemoChrome({
	labels,
	view,
	people,
	interactive,
	hint,
	onActivate,
	onLeave,
	children,
}: {
	labels: DemoStageLabels
	view: DemoView
	people: DemoCollaborator[]
	interactive: boolean
	hint: string | null
	// Clicking a locked view hands it to the visitor.
	onActivate: () => void
	onLeave: () => void
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
				<div
					className="isolate flex min-h-0 flex-1 flex-col"
					onMouseLeave={onLeave}
				>
					{children}
				</div>
				{/* The page scroll drives the demo. Touches and wheel on the views
				    must scroll the page, not the canvas or slides underneath,
				    until the visitor clicks in. */}
				{!interactive && (
					<button
						type="button"
						aria-label={hint ?? labels.views[view]}
						className="absolute inset-0 cursor-pointer"
						onClick={onActivate}
					/>
				)}
				{hint && (
					<p
						key={hint}
						className={cn(
							"bg-foreground text-background animate-in fade-in slide-in-from-bottom-2 fill-mode-backwards pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap shadow-lg delay-700 duration-500",
							hintPlacement[view],
						)}
					>
						{hint}
					</p>
				)}
			</div>
		</div>
	)
}

// Clear of the whiteboard tools and the time machine slider.
let hintPlacement: Record<DemoView, string> = {
	editor: "bottom-4",
	review: "bottom-4",
	whiteboard: "top-4",
	timemachine: "bottom-24",
	present: "bottom-4",
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
	if (collaborator.device === "visitor") {
		return <UserIcon className={className} aria-hidden />
	}
	return <LaptopIcon className={className} aria-hidden />
}
