import { StrictMode, useEffect } from "react"
import { JazzReactProvider, useAccount } from "jazz-tools/react"
import { co } from "jazz-tools"
import { createRouter, RouterProvider } from "@tanstack/react-router"
import { PUBLIC_JAZZ_SYNC_SERVER } from "astro:env/client"
import { Toaster } from "sonner"
import { routeTree } from "#app/routeTree.gen"
import { UserAccount, migrateAnonymousData } from "@/schema"
import {
	SplashScreen,
	SplashScreenStatic,
	useSplashDelay,
} from "@/app/features/onboarding"
import { PWAContext, usePWAProvider, PWAInstallHint } from "@/app/lib/pwa"
import { BackupSubscriber, SpacesBackupSubscriber } from "@/app/features/backup"
import { useCleanupDeleted } from "@/app/features/documents"
import { connectLocalJazzPoke } from "@/app/lib/local-jazz-poke"
import { installRecoveryConsole } from "@/app/features/recovery"
import { init } from "@plausible-analytics/tracker"
import { IntlProvider } from "@/shared/intl/setup"
import { messagesDe } from "@/shared/intl/messages"
import { recordStartupTraceOnce } from "@/app/lib/reload-diagnostics"
import { finishBrowserStartupInstrumentation } from "@/app/lib/browser-startup-instrumentation"

export { PWA, buildSyncConfig }

init({ domain: "alkalye.com" })
let appBundleEvaluatedAt = performance.now()
let jazzProviderStartedAt = performance.now()
recordStartupTraceOnce("app-bundle-evaluated")

let router = createRouter({
	basepath: "/app",
	routeTree,
	context: { me: null },
	defaultPreload: false,
	defaultStaleTime: 0,
	defaultGcTime: 0,
})

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router
	}
}

type JazzSyncProps = Parameters<typeof JazzReactProvider>[0]["sync"]
type JazzSyncConfig = NonNullable<JazzSyncProps>
type SyncPeer = JazzSyncConfig["peer"]

function buildSyncConfig(): JazzSyncConfig {
	let syncServer = PUBLIC_JAZZ_SYNC_SERVER
	if (!isSyncPeer(syncServer)) {
		throw new Error("PUBLIC_JAZZ_SYNC_SERVER must be a ws:// or wss:// URL")
	}

	let syncConfig: JazzSyncConfig = {
		peer: syncServer,
		when: "always",
	}

	return syncConfig
}

function PWA() {
	recordStartupTraceOnce("jazz-provider-started")
	recordStartupTraceOnce("react-root-rendering")
	return (
		<StrictMode>
			<JazzReactProvider
				AccountSchema={UserAccount}
				sync={buildSyncConfig()}
				onAnonymousAccountDiscarded={migrateAnonymousData}
				fallback={<SplashScreenStatic />}
			>
				<RouterWithJazz />
			</JazzReactProvider>
		</StrictMode>
	)
}

function isSyncPeer(value: string | undefined): value is SyncPeer {
	if (!value) return false
	return value.startsWith("ws://") || value.startsWith("wss://")
}

function ContextPWAProvider({ children }: { children: React.ReactNode }) {
	let pwa = usePWAProvider()
	return <PWAContext.Provider value={pwa}>{children}</PWAContext.Provider>
}

function RouterWithJazz() {
	let me = useAccount(UserAccount, { resolve: { root: true } })
	let splashReady = useSplashDelay(700)
	let showSplash = me.$jazz.loadingState === "loading" || !splashReady
	let requestedLocale = getRequestedLocale()

	useCleanupDeleted()

	useEffect(() => {
		recordStartupTraceOnce("react-mounted")
		recordStartupTraceOnce("jazz-context-ready", {
			durationMs: elapsedSince(jazzProviderStartedAt),
		})
		finishBrowserStartupInstrumentation()
		navigator.storage?.estimate().then(estimate => {
			recordStartupTraceOnce("browser-storage-estimated", {
				usageMegabytes: bytesToMegabytes(estimate.usage),
				quotaMegabytes: bytesToMegabytes(estimate.quota),
			})
		})
	}, [])

	useEffect(() => {
		if (!me.$isLoaded) return
		recordStartupTraceOnce("jazz-account-root-loaded", {
			loadingState: me.$jazz.loadingState,
			hasRoot: Boolean(me.root),
			durationMs: elapsedSince(appBundleEvaluatedAt),
		})
	}, [me])

	useEffect(() => {
		if (!me.$isLoaded || !requestedLocale) return
		if (me.root?.language !== requestedLocale) {
			me.root?.$jazz.set("language", requestedLocale)
		}
		clearRequestedLocale()
	}, [me, requestedLocale])

	let locale = me.$isLoaded
		? (requestedLocale ?? me.root?.language ?? "en")
		: (requestedLocale ?? "en")

	let content = (
		<>
			<Toaster />
			<PWAInstallHint />
			<LocalJazzPoke />
			<RecoveryConsole />
			<BackupSubscriber />
			<SpacesBackupSubscriber />
			<SplashScreen show={showSplash} />
			{/* Mount the router only once the account root is resolved: loaders
			    read context.me at navigation time and never re-run when it
			    changes, so an early navigation with me=null would render an
			    empty screen forever. */}
			{me.$isLoaded && <TracedRouterProvider me={me} />}
		</>
	)

	let intlWrapped = <ContextPWAProvider>{content}</ContextPWAProvider>

	return locale === "de" ? (
		<IntlProvider messages={messagesDe} locale="de">
			{intlWrapped}
		</IntlProvider>
	) : (
		<IntlProvider>{intlWrapped}</IntlProvider>
	)
}

function TracedRouterProvider({
	me,
}: {
	me: co.loaded<typeof UserAccount, { root: true }>
}) {
	useEffect(() => {
		recordStartupTraceOnce("router-mounted", { path: window.location.pathname })
	}, [])

	return <RouterProvider router={router} context={{ me }} />
}

function LocalJazzPoke() {
	let me = useAccount(UserAccount)

	useEffect(() => {
		if (!me.$isLoaded) return
		return connectLocalJazzPoke(me)
	}, [me])

	return null
}

function RecoveryConsole() {
	let me = useAccount(UserAccount)

	useEffect(() => {
		if (!me.$isLoaded) return
		installRecoveryConsole()
	}, [me])

	return null
}

function getRequestedLocale(): "de" | "en" | null {
	if (typeof window === "undefined") return null
	let locale = new URLSearchParams(window.location.search).get("lang")
	if (locale === "de" || locale === "en") return locale
	return null
}

function clearRequestedLocale() {
	let url = new URL(window.location.href)
	url.searchParams.delete("lang")
	window.history.replaceState(window.history.state, "", url)
}

function bytesToMegabytes(bytes: number | undefined): number {
	if (!bytes) return 0
	return Math.round((bytes / 1024 / 1024) * 10) / 10
}

function elapsedSince(startedAt: number): number {
	return Math.round((performance.now() - startedAt) * 10) / 10
}
