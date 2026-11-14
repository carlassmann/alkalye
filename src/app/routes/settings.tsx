import { createFileRoute } from "@tanstack/react-router"
import { SettingsScreen } from "@/app/features/settings"

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
	component: RouteComponent,
})

function RouteComponent() {
	let search = Route.useSearch()
	return <SettingsScreen search={search} />
}
