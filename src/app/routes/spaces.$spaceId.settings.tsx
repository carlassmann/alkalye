import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { SpaceSettingsScreen } from "@/app/features/spaces"
export { Route }
let Route = createFileRoute("/spaces/$spaceId/settings")({
	validateSearch: z.object({
		from: z.string().optional(),
		spaceId: z.string().optional(),
		step: z.number().optional(),
	}),
	component: Screen,
})
function Screen() {
	let { spaceId } = Route.useParams()
	return <SpaceSettingsScreen spaceId={spaceId} />
}
