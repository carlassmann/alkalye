import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { DocScreen } from "@/app/features/documents"
export { Route }
let Route = createFileRoute("/spaces/$spaceId/doc/$id/")({
	validateSearch: z.object({
		from: z.string().optional(),
		spaceId: z.string().optional(),
		step: z.number().optional(),
	}),
	component: Screen,
})
function Screen() {
	let { spaceId, id } = Route.useParams()
	return <DocScreen id={id} spaceId={spaceId} />
}
