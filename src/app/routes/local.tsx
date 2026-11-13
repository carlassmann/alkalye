import { createFileRoute } from "@tanstack/react-router"
import { LocalDocScreen } from "@/app/features/documents"

export { Route }

let Route = createFileRoute("/local")({
	component: LocalDocScreen,
})
