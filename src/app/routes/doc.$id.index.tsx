import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { DocScreen } from "@/app/features/documents"
export { Route }
let Route = createFileRoute("/doc/$id/")({
	validateSearch: z.object({
		find: z.boolean().optional(),
		q: z.string().optional(),
		case: z.boolean().optional(),
		fuzzy: z.boolean().optional(),
	}),
	component: Screen,
})
function Screen() {
	let { id } = Route.useParams()
	return <DocScreen id={id} />
}
