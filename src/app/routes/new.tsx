import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { newDocLoader } from "@/app/features/documents"

export { Route }

let Route = createFileRoute("/new")({
	validateSearch: z.object({
		spaceId: z.string().optional(),
	}),
	loaderDeps: ({ search }) => ({ spaceId: search.spaceId }),
	shouldReload: ({ cause }) => cause !== "preload",
	loader: ({ context, deps, cause }) => {
		if (cause === "preload") return
		return newDocLoader({ context, spaceId: deps.spaceId })
	},
})
