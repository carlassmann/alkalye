import { useEffect, useRef, useState } from "react"
import { BatteryFullIcon, SignalIcon, WifiIcon } from "lucide-react"
import type { LandingLocale } from "#www/landing-content"
import {
	parsePhoneMessage,
	stageMessageFor,
	type DemoPhoneScreen,
	type PhoneMessage,
} from "./demo-phone-protocol"

export { DemoPhone }

// An iPhone at its real size in CSS pixels, scaled to fit the stage.
let screenWidth = 390
let screenHeight = 844
let bezel = 14
let deviceWidth = screenWidth + bezel * 2
let deviceHeight = screenHeight + bezel * 2
let statusBarHeight = 54

function DemoPhone({
	locale,
	screen,
	onMessage,
}: {
	locale: LandingLocale
	screen: DemoPhoneScreen
	onMessage: (message: PhoneMessage) => void
}) {
	let slot = useRef<HTMLDivElement>(null)
	let frame = useRef<HTMLIFrameElement>(null)
	let [scale, setScale] = useState(0)
	let [isReady, setIsReady] = useState(false)

	useEffect(() => {
		let element = slot.current
		if (!element) return
		let observer = new ResizeObserver(() => {
			setScale(element.clientHeight / deviceHeight)
		})
		observer.observe(element)
		return () => observer.disconnect()
	}, [])

	useEffect(() => {
		function receive(event: MessageEvent) {
			if (event.source !== frame.current?.contentWindow) return
			let message = parsePhoneMessage(event.data)
			if (!message) return
			if (message.type === "ready") setIsReady(true)
			onMessage(message)
		}
		window.addEventListener("message", receive)
		return () => window.removeEventListener("message", receive)
	}, [onMessage])

	useEffect(() => {
		if (!isReady) return
		frame.current?.contentWindow?.postMessage(
			stageMessageFor(locale, screen),
			window.location.origin,
		)
	}, [isReady, locale, screen])

	return (
		<div
			ref={slot}
			className="relative h-full"
			style={{ aspectRatio: `${deviceWidth} / ${deviceHeight}` }}
		>
			<div
				className="absolute top-0 left-0 origin-top-left rounded-[68px] bg-neutral-900 shadow-2xl ring-1 shadow-black/30 ring-neutral-600"
				style={{
					width: deviceWidth,
					height: deviceHeight,
					padding: bezel,
					transform: `scale(${scale})`,
				}}
			>
				<div className="bg-background text-foreground relative flex h-full flex-col overflow-hidden rounded-[54px]">
					<StatusBar />
					<iframe
						ref={frame}
						src="/demo/phone"
						title="Alkalye"
						className="block border-0"
						style={{
							width: screenWidth,
							height: screenHeight - statusBarHeight,
						}}
					/>
					<span className="bg-foreground/80 pointer-events-none absolute bottom-2 left-1/2 h-[5px] w-[134px] -translate-x-1/2 rounded-full" />
				</div>
			</div>
		</div>
	)
}

function StatusBar() {
	return (
		<div
			className="relative flex shrink-0 items-center justify-between px-9 text-[17px] font-semibold"
			style={{ height: statusBarHeight }}
			aria-hidden
		>
			<span>9:41</span>
			<span className="absolute top-[11px] left-1/2 h-[37px] w-[125px] -translate-x-1/2 rounded-full bg-black" />
			<span className="flex items-center gap-1.5">
				<SignalIcon className="size-[18px]" />
				<WifiIcon className="size-[18px]" />
				<BatteryFullIcon className="size-6" />
			</span>
		</div>
	)
}
