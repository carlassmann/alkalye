import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "motion/react"

export { SplashScreen, SplashScreenStatic, useSplashDelay }

declare global {
	interface Window {
		__pageLoadTime?: number
		__alkalyeReady?: boolean
		__alkalyeReadyAt?: number
		__alkalyeReadyRoute?: string
		__alkalyeStartupTraceId?: string
	}
}

function useSplashDelay(minDurationMs = 1000) {
	let [ready, setReady] = useState(() => {
		let loadTime = window.__pageLoadTime ?? Date.now()
		let elapsed = Date.now() - loadTime
		return elapsed >= minDurationMs
	})

	useEffect(() => {
		if (ready) return

		let loadTime = window.__pageLoadTime ?? Date.now()
		let elapsed = Date.now() - loadTime
		let remaining = Math.max(0, minDurationMs - elapsed)

		let timer = setTimeout(() => setReady(true), remaining)
		return () => clearTimeout(timer)
	}, [minDurationMs, ready])

	return ready
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
	return (
		<AnimatePresence>
			{show && (
				<motion.div
					className="bg-background fixed inset-0 z-50 flex items-center justify-center"
					initial={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					transition={{ duration: 0.3, ease: "easeOut" }}
				>
					<motion.div
						exit={{ scale: 0.9, opacity: 0 }}
						transition={{ duration: 0.3, ease: "easeOut" }}
					>
						<SplashIcon />
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>
	)
}

function SplashIcon() {
	return (
		<div className="text-foreground bg-background flex aspect-square size-48 flex-col items-center justify-center rounded-3xl font-mono text-[36px] leading-none font-bold tracking-tighter">
			Alkalye
		</div>
	)
}
