import { lazy, Suspense, useEffect, useRef, useState } from "react"
import type { LandingLocale } from "#www/landing-content"

export { AlkalyeInAction }

// The stage shares most of its code with the app, so it loads only when the
// visitor scrolls toward it.
let DemoStageRoot = lazy(() =>
	import("./demo-stage").then(module => ({ default: module.DemoStageRoot })),
)

function AlkalyeInAction({ locale }: { locale: LandingLocale }) {
	let placeholder = useRef<HTMLDivElement>(null)
	let [isNear, setIsNear] = useState(false)

	useEffect(() => {
		let element = placeholder.current
		if (!element) return
		let observer = new IntersectionObserver(
			entries => {
				if (entries.some(entry => entry.isIntersecting)) {
					setIsNear(true)
					observer.disconnect()
				}
			},
			{ rootMargin: "100% 0px" },
		)
		observer.observe(element)
		return () => observer.disconnect()
	}, [])

	let frame = <div className="border-border bg-muted/30 h-full w-full border" />
	if (!isNear) {
		return (
			<div ref={placeholder} className="h-full">
				{frame}
			</div>
		)
	}
	return (
		<Suspense fallback={frame}>
			<DemoStageRoot locale={locale} />
		</Suspense>
	)
}
