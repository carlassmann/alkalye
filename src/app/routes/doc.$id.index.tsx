import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { Document } from "@/schema"
import { DocScreen, loaderResolve } from "@/app/features/documents"
import { startStartupSpan } from "@/app/lib/reload-diagnostics"

export { Route }

let findSearchSchema = z.object({
	find: z.boolean().optional(),
	q: z.string().optional(),
	case: z.boolean().optional(),
	fuzzy: z.boolean().optional(),
})

let Route = createFileRoute("/doc/$id/")({
	validateSearch: findSearchSchema,
	loader: async ({ params }) => {
		// Block navigation only on what the editor needs to paint; asset
		// binaries stream in afterwards via the screen's deep subscription.
		let finishLoad = startStartupSpan("personal-document-loader")
		let doc = await Document.load(params.id, { resolve: loaderResolve })
		finishLoad({
			loaded: doc.$isLoaded,
			loadingState: doc.$jazz.loadingState,
			contentCharacters: doc.$isLoaded ? doc.content.toString().length : 0,
		})
		if (!doc.$isLoaded) {
			return { doc: null, loadingState: doc.$jazz.loadingState }
		}
		return { doc, loadingState: null }
	},
	component: RouteComponent,
})

function RouteComponent() {
	let { id } = Route.useParams()
	let loaderData = Route.useLoaderData()
	return <DocScreen id={id} loaderData={loaderData} />
}
