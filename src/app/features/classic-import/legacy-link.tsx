import { useEffect, useState } from "react"
import { useJazzSession } from "jazz-tools/react"
import { Button } from "@/app/components/ui/button"
import { resolveLegacyLink, legacyLinkTarget } from "./legacy-links"
export { ClassicLegacyLink }

function ClassicLegacyLink({ children }: { children: React.ReactNode }) {
	let { exportDeviceKey } = useJazzSession()
	let target = legacyLinkTarget(window.location.pathname)
	let [error, setError] = useState("")
	let [attempt, setAttempt] = useState(0)
	useEffect(() => {
		if (!legacyLinkTarget(window.location.pathname)) return
		let controller = new AbortController()
		async function resolve() {
			try {
				let path = await resolveLegacyLink(
					window.location.pathname,
					exportDeviceKey(),
					controller.signal,
				)
				if (path)
					window.location.replace(
						path + window.location.search + window.location.hash,
					)
				else
					setError(
						"This Classic link has not migrated yet, or you no longer have access. Ask its owner or an editor to open Alkalye.",
					)
			} catch (error) {
				if (!controller.signal.aborted)
					setError(
						error instanceof Error
							? error.message
							: "Could not open Classic link",
					)
			}
		}
		void resolve()
		window.addEventListener("classic-import-complete", resolve)
		return () => {
			controller.abort()
			window.removeEventListener("classic-import-complete", resolve)
		}
	}, [exportDeviceKey, target?.classicId, target?.kind, attempt])
	if (!target) return children
	return (
		<div role="status" className="p-6 text-sm">
			<p>{error || "Opening Classic link…"}</p>
			{error && (
				<Button
					variant="outline"
					onClick={() => {
						setError("")
						setAttempt(attempt + 1)
					}}
				>
					Retry
				</Button>
			)}
		</div>
	)
}
