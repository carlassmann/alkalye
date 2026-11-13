import { ClassicMigration } from "./features/classic-import/migration-notice"
import { AccountRoutingContext } from "./lib/account-routing"
import { useEffect, useState } from "react"
import { JazzProvider, useSession, useSyncStatus } from "jazz-tools/react"
import { createRouter, RouterProvider } from "@tanstack/react-router"
import { AuthForm, markAccountBackedUp } from "@/app/features/auth"
import { LibraryProvider, useLibrary, app } from "@/app/features/documents"
import { IntlProvider } from "@/shared/intl/setup"
import { messagesDe } from "@/shared/intl/messages"
import { PWAContext, usePWAProvider, PWAInstallHint } from "@/app/lib/pwa"
import { Toaster } from "sonner"
import { routeTree } from "./routeTree.gen"

export { PWA }

let config = {
	serverUrl: "/jazz",
	initial: "device",
	localFirst: "now",
	client: () => import("jazz-tools/local-first"),
} satisfies import("jazz-tools/client").JazzClientConfig

let router = createRouter({
	basepath: "/app",
	routeTree,
	context: { ownerId: null },
	defaultPreload: "intent",
})
declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router
	}
}

function PWA() {
	return (
		<IntlProvider>
			<JazzProvider
				config={config}
				signedOut={
					<div className="mx-auto max-w-md p-8">
						<h1 className="mb-6 text-2xl">Alkalye</h1>
						<AuthForm />
					</div>
				}
				loading={<p role="status">Opening your library…</p>}
			>
				<ClassicMigration>
					<AccountApp />
				</ClassicMigration>
			</JazzProvider>
		</IntlProvider>
	)
}
function AccountApp() {
	let user = useSession()?.user
	return (
		<LibraryProvider key={user}>
			<Application />
		</LibraryProvider>
	)
}
function Application() {
	let { ownerId, settings } = useLibrary()
	let locale = settings?.language ?? "en"
	return locale === "de" ? (
		<IntlProvider locale="de" messages={messagesDe}>
			<AppRouter ownerId={ownerId} />
		</IntlProvider>
	) : (
		<IntlProvider>
			<AppRouter ownerId={ownerId} />
		</IntlProvider>
	)
}
let routedOwnerId: string | null = null
function AppRouter({ ownerId }: { ownerId: string }) {
	let pwa = usePWAProvider()
	let { db } = useLibrary()
	let sync = useSyncStatus()
	let [ready, setReady] = useState(false)
	useEffect(() => {
		let restoring = sessionStorage.getItem("alkalye-restoring-account")
		if (ready || (restoring && sync.link.state !== "connected")) return
		let cancelled = false
		async function routeAccount() {
			let documents = restoring
				? await db.all(app.documents.where({ ownerId }), { tier: "remote" })
				: []
			if (cancelled) return
			router.update({ context: { ownerId } })
			let acceptingInvite = window.location.pathname.endsWith("/invite")
			let switched = routedOwnerId !== null && routedOwnerId !== ownerId
			let requestedId = sessionStorage.getItem("alkalye-requested-document")
			if (restoring) {
				sessionStorage.removeItem("alkalye-restoring-account")
				sessionStorage.removeItem("alkalye-requested-document")
				markAccountBackedUp(ownerId)
				let requested = documents.find(
					doc => doc.id === requestedId && !doc.deletedAt,
				)
				let latest = documents
					.filter(doc => !doc.deletedAt)
					.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]
				let target = requested ?? latest
				router.clearCache()
				if (acceptingInvite)
					await router.navigate({
						to: "/invite",
						hash: window.location.hash.slice(1),
						replace: true,
					})
				else if (target)
					await router.navigate({
						to: "/doc/$id",
						params: { id: target.id },
						replace: true,
					})
				else await router.navigate({ to: "/", replace: true })
			} else if (switched) {
				router.clearCache()
				if (!acceptingInvite && !window.location.pathname.endsWith("/settings"))
					await router.navigate({ to: "/", replace: true })
			}
			routedOwnerId = ownerId
			if (!cancelled) setReady(true)
		}
		void routeAccount()
		return () => {
			cancelled = true
		}
	}, [db, ownerId, sync.link.state, ready])

	return (
		<PWAContext.Provider value={pwa}>
			<AccountRoutingContext.Provider value={ready}>
				<RouterProvider router={router} context={{ ownerId }} />
			</AccountRoutingContext.Provider>
			<PWAInstallHint />
			<Toaster />
		</PWAContext.Provider>
	)
}
