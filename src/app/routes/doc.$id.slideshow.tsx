import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { SlideshowScreen } from "@/app/features/presentation"
export { Route }
let Route = createFileRoute("/doc/$id/slideshow")({
	validateSearch: z.object({
		from: z.string().optional(),
		spaceId: z.string().optional(),
		step: z.number().optional(),
	}),
	component: Screen,
})
function Screen() {
	let { id } = Route.useParams()
	return <SlideshowScreen id={id} />
}
