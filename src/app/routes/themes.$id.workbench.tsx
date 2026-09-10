import { createFileRoute } from "@tanstack/react-router"
import { ThemeWorkbenchScreen } from "@/app/features/themes"

export { Route }

let Route = createFileRoute("/themes/$id/workbench")({
	component: RouteComponent,
})

function RouteComponent() {
	let { id } = Route.useParams()
	return <ThemeWorkbenchScreen id={id} />
}
