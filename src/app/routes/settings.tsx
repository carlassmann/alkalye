import { createFileRoute } from "@tanstack/react-router"
import { SettingsScreen, settingsQuery } from "@/app/features/settings"
import { startStartupSpan } from "@/app/lib/reload-diagnostics"

export { Route }

let Route = createFileRoute("/settings")({
	validateSearch: (search: Record<string, unknown>) => {
		let result: {
			from?: string
			oauth?: string
			category?: "general" | "editor" | "connections" | "app"
		} = {}
		if (typeof search.from === "string") result.from = search.from
		if (typeof search.oauth === "string") result.oauth = search.oauth
		if (
			search.category === "general" ||
			search.category === "editor" ||
			search.category === "connections" ||
			search.category === "app"
		) {
			result.category = search.category
		}
		return result
	},
	loader: async ({ context }) => {
		let { me } = context
		if (!me) return { me: null }
		let finishLoad = startStartupSpan("settings-loader")
		let loadedMe = await me.$jazz.ensureLoaded({ resolve: settingsQuery })
		finishLoad({
			loaded: loadedMe.$isLoaded,
			themeCount: loadedMe.root?.themes?.length ?? 0,
		})
		return { me: loadedMe }
	},
	component: RouteComponent,
})

function RouteComponent() {
	let loaderData = Route.useLoaderData()
	let search = Route.useSearch()
	return <SettingsScreen loaderData={loaderData} search={search} />
}
