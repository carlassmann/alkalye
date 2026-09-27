import { useEffect } from "react"

export { SplashScreen, SplashScreenStatic }

declare global {
	interface Window {
		__pageLoadTime?: number
		__alkalyeReady?: boolean
		__alkalyeReadyAt?: number
		__alkalyeReadyRoute?: string
		__alkalyeStartupTraceId?: string
		__alkalyeStartupTraceRecord?: (
			event: string,
			details?: Record<string, unknown>,
		) => void
		__alkalyeStartupTraceFlush?: () => void
		__alkalyeStartupTraceClear?: () => void
		__alkalyeStartupTraceHasCurrentEvent?: (event: string) => boolean
	}
}

function SplashScreenStatic() {
	useEffect(() => {
		document.getElementById("splash")?.remove()
	}, [])

	return (
		<div className="bg-background fixed inset-0 z-50 flex items-center justify-center">
			<SplashIcon />
		</div>
	)
}

function SplashScreen({ show }: { show: boolean }) {
	useEffect(() => {
		document.getElementById("splash")?.remove()
	}, [])

	return show ? <SplashScreenStatic /> : null
}

function SplashIcon() {
	return (
		<div className="text-foreground bg-background flex aspect-square size-48 flex-col items-center justify-center rounded-3xl font-mono text-[36px] leading-none font-bold tracking-tighter">
			Alkalye
		</div>
	)
}
