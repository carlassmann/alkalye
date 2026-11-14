import { createFileRoute } from "@tanstack/react-router"
import { ThemeWorkbenchScreen } from "@/app/features/themes"
export { Route }
let Route = createFileRoute("/themes/$id/workbench")({ component: Screen })
function Screen() {
	return <ThemeWorkbenchScreen id={Route.useParams().id} />
}
