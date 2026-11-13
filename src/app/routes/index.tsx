import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { HomeScreen } from "@/app/features/documents"
export { Route }
let Route = createFileRoute("/")({
	validateSearch: z.object({ personal: z.boolean().optional() }),
	component: Screen,
})
function Screen() {
	return <HomeScreen />
}
