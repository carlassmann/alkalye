import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { NewDocScreen } from "@/app/features/documents"
export { Route }
let Route = createFileRoute("/new")({
	validateSearch: z.object({ spaceId: z.string().optional() }),
	component: Screen,
})
function Screen() {
	return <NewDocScreen />
}
