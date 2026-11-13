import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { DeferredScreen } from "@/app/components/deferred-screen"
export { Route }
let Route = createFileRoute("/doc/$id/teleprompter")({
	validateSearch: z.object({
		from: z.string().optional(),
		spaceId: z.string().optional(),
		step: z.number().optional(),
	}),
	component: Screen,
})
function Screen() {
	return <DeferredScreen area="doc" />
}
