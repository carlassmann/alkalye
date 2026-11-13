import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { DocPreviewScreen } from "@/app/features/documents"
export { Route }
let Route = createFileRoute("/doc/$id/preview")({
	validateSearch: z.object({ from: z.string().optional() }),
	component: Screen,
})
function Screen() {
	let { id } = Route.useParams()
	return <DocPreviewScreen id={id} />
}
