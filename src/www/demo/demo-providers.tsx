import { createContext, use, useState, type ReactNode } from "react"
import {
	RouterProvider,
	createMemoryHistory,
	createRootRoute,
	createRouter,
} from "@tanstack/react-router"
import { SidebarProvider } from "@/app/components/ui/sidebar"
import { IntlProvider } from "@/shared/intl/setup"
import { messagesDe } from "@/shared/intl/messages"
import type { LandingLocale } from "#www/landing-content"

export { DemoProviders }

// What the app's widgets expect around them, without an account or the
// page URL: messages, a router and sidebar layout.
function DemoProviders({
	locale,
	children,
}: {
	locale: LandingLocale
	children: ReactNode
}) {
	let [router] = useState(createDemoRouter)
	let app = (
		<DemoContent value={children}>
			<RouterProvider router={router} />
		</DemoContent>
	)
	return locale === "de" ? (
		<IntlProvider messages={messagesDe} locale="de">
			{app}
		</IntlProvider>
	) : (
		<IntlProvider>{app}</IntlProvider>
	)
}

// The router is created once, so the content reaches its root through context.
let DemoContent = createContext<ReactNode>(null)

// The editor keeps find state in the route search and reads sidebar layout.
// A memory router and sidebar context give it both without touching the page URL.
function createDemoRouter() {
	return createRouter({
		routeTree: createRootRoute({ component: DemoRoot }),
		history: createMemoryHistory(),
	})
}

function DemoRoot() {
	return (
		// The app's sidebar state must not shift or change the demo.
		<SidebarProvider
			data-left-sidebar-open={false}
			data-right-sidebar-open={false}
		>
			{use(DemoContent)}
		</SidebarProvider>
	)
}
