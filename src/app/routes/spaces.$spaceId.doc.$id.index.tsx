import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { Document, Space } from "@/schema"
import {
	SpaceDocScreen,
	spaceLoaderResolve,
	loaderResolve,
	settingsResolve,
} from "@/app/features/documents"
import { startStartupSpan } from "@/app/lib/reload-diagnostics"

export { Route }

let findSearchSchema = z.object({
	find: z.boolean().optional(),
	q: z.string().optional(),
	case: z.boolean().optional(),
	fuzzy: z.boolean().optional(),
})

let Route = createFileRoute("/spaces/$spaceId/doc/$id/")({
	validateSearch: findSearchSchema,
	loader: async ({ params, context }) => {
		// Block navigation only on the space's document list and the opened
		// document; the other documents' contents stream in afterwards via the
		// screen's deep subscription.
		let finishCoreLoad = startStartupSpan("space-document-loader")
		let [space, doc] = await Promise.all([
			Space.load(params.spaceId, { resolve: spaceLoaderResolve }),
			Document.load(params.id, { resolve: loaderResolve }),
		])
		finishCoreLoad({
			spaceLoaded: space.$isLoaded,
			documentLoaded: doc.$isLoaded,
			spaceDocumentCount: space.$isLoaded ? (space.documents?.length ?? 0) : 0,
			contentCharacters: doc.$isLoaded ? doc.content.toString().length : 0,
		})

		if (!space.$isLoaded) {
			return {
				space: null,
				doc: null,
				loadingState: space.$jazz.loadingState,
				me: null,
			}
		}

		if (!doc.$isLoaded) {
			return {
				space,
				doc: null,
				loadingState: doc.$jazz.loadingState,
				me: null,
			}
		}

		let finishSettings = startStartupSpan("space-settings-load")
		let me = context.me
			? await context.me.$jazz.ensureLoaded({ resolve: settingsResolve })
			: null
		finishSettings({ loaded: Boolean(me?.$isLoaded) })

		return { space, doc, loadingState: null, me }
	},
	component: RouteComponent,
})

function RouteComponent() {
	let { spaceId, id } = Route.useParams()
	let loaderData = Route.useLoaderData()
	return <SpaceDocScreen spaceId={spaceId} id={id} loaderData={loaderData} />
}
