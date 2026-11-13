import { JazzProvider } from "jazz-tools/react"
import { AuthForm } from "@/app/features/auth"
import { DocumentLibrary } from "@/app/features/documents"
import { IntlProvider } from "@/shared/intl/setup"
import { usePWAProvider } from "@/app/lib/pwa"
import { Toaster } from "sonner"

export { PWA }

let config = {
	serverUrl: "/jazz",
	initial: "device",
	localFirst: "now",
	client: () => import("jazz-tools/local-first"),
} satisfies import("jazz-tools/client").JazzClientConfig

function PWA() {
	return (
		<IntlProvider>
			<Application />
		</IntlProvider>
	)
}

function Application() {
	usePWAProvider()
	return (
		<>
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
				<DocumentLibrary />
			</JazzProvider>
			<Toaster />
		</>
	)
}
