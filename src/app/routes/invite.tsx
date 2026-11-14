import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { InviteScreen } from "@/app/features/sharing"
export { Route }
let Route = createFileRoute("/invite")({
	validateSearch: z.object({
		from: z.string().optional(),
		spaceId: z.string().optional(),
		step: z.number().optional(),
	}),
	component: Screen,
})
function Screen() {
	return <InviteScreen />
}
