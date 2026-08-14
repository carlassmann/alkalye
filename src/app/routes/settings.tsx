import { createFileRoute } from "@tanstack/react-router"
import { SettingsScreen, settingsQuery } from "@/app/features/settings"
import { startStartupSpan } from "@/app/lib/reload-diagnostics"

export { Route }

let Route = createFileRoute("/settings")({
	validateSearch: (search: Record<string, unknown>) => ({
		from: typeof search.from === "string" ? search.from : undefined,
	}),
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
