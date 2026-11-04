import { lazy, Suspense } from "react"
import type { LandingLocale } from "#www/landing-content"
import { demoIntroText, type DemoStageLabels } from "./demo-script"

export { AlkalyeInAction }

// The stage shares most of its code with the app, so the hero shows the
// static intro document until that code arrives.
let DemoStageRoot = lazy(() =>
	import("./demo-stage").then(module => ({ default: module.DemoStageRoot })),
)

function AlkalyeInAction({
	locale,
	labels,
}: {
	locale: LandingLocale
	labels: DemoStageLabels
}) {
	return (
		<Suspense fallback={<IntroDocumentFrame locale={locale} />}>
			<DemoStageRoot locale={locale} labels={labels} />
		</Suspense>
	)
}

function IntroDocumentFrame({ locale }: { locale: LandingLocale }) {
	return (
		<div className="border-border bg-background h-full w-full overflow-hidden border shadow-2xl shadow-black/10 dark:shadow-black/40">
			<div className="border-border h-10 border-b" />
			<pre className="px-6 py-8 font-mono text-[15px] leading-7 whitespace-pre-wrap [tab-size:4]">
				<code>{demoIntroText(locale)}</code>
			</pre>
		</div>
	)
}
