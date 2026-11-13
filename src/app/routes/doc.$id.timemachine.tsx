import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { TimeMachineScreen } from "@/app/features/time-machine"
export { Route }
let Route = createFileRoute("/doc/$id/timemachine")({
	validateSearch: z.object({
		from: z.string().optional(),
		spaceId: z.string().optional(),
		edit: z.number().int().optional(),
		mode: z.enum(["days", "edits"]).optional(),
	}),
	component: Screen,
})
function Screen() {
	let { id } = Route.useParams()
	let search = Route.useSearch()
	return <TimeMachineScreen id={id} search={search} />
}
