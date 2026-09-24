import { useEffect, useRef, useState, type PointerEvent } from "react"
import { useAccount } from "jazz-tools/react"
import { UserAccount } from "@/schema"
import { createLaserChannel } from "../lib/laser-channel"
import {
	createLaserLease,
	laserLayoutKey,
	laserTiming,
	type LaserDisplay,
} from "../lib/laser-session"
import { isLaserPreview } from "../lib/laser-preview"
import { useIntl } from "@/shared/intl/setup"
import { type LaserMessage } from "../lib/laser-schema"

export { LaserPreview, LaserReceiver }

type Display = Extract<LaserMessage, { type: "display" }> & { seenAt: number }
type Point = Extract<LaserMessage, { type: "point" }>

function LaserReceiver({
	docId,
	slideNumber,
}: {
	docId: string
	slideNumber: number
}) {
	let me = useAccount(UserAccount)
	let dotRef = useRef<HTMLDivElement>(null)
	let idRef = useRef(crypto.randomUUID())
	let slideRef = useRef(slideNumber)
	let announceRef = useRef<(() => void) | null>(null)

	useEffect(() => {
		slideRef.current = slideNumber
		if (dotRef.current) dotRef.current.hidden = true
		announceRef.current?.()
	}, [slideNumber])

	useEffect(() => {
		// The preview must not announce itself as another projector.
		if (isLaserPreview() || !me.$isLoaded) return
		let leases = createLaserLease()
		let requests = new Set<string>()
		let lastPointAt = 0
		let announcedLayout = ""
		let id = idRef.current
		let dot = dotRef.current
		function hide() {
			if (dot && !dot.hidden) dot.hidden = true
		}
		function displayLayout(): Pick<
			LaserDisplay,
			"width" | "height" | "appearance" | "slideNumber"
		> {
			let appearance = document
				.querySelector("[data-mode=slideshow][data-appearance]")
				?.getAttribute("data-appearance")
			return {
				width: window.innerWidth,
				height: window.innerHeight,
				appearance: appearance === "dark" ? "dark" : "light",
				slideNumber: slideRef.current,
			}
		}
		function announce() {
			let layout = displayLayout()
			let layoutKey = laserLayoutKey(layout)
			if (announcedLayout !== layoutKey) hide()
			announcedLayout = layoutKey
			channel.postMessage({
				type: "display",
				id,
				...layout,
				requests: [...requests],
				lease: leases.issue(layoutKey),
			})
		}
		hide()
		function handleMessage(message: LaserMessage) {
			if (message.type === "discover") {
				requests.add(message.request)
				if (requests.size > 16) {
					let oldest = requests.values().next().value
					if (oldest) requests.delete(oldest)
				}
				announce()
			}
			if (message.type !== "point" || message.target !== id || !dot) return
			let layout = laserLayoutKey(displayLayout())
			if (message.layout !== layout || !leases.accepts(message.lease, layout))
				return
			if (!message.visible || message.slideNumber !== slideRef.current) {
				hide()
				return
			}
			lastPointAt = performance.now()
			dot.style.left = `${message.x * 100}%`
			dot.style.top = `${message.y * 100}%`
			dot.hidden = false
		}
		let channel = createLaserChannel(me, docId, handleMessage)
		announceRef.current = announce
		announce()
		let heartbeat = window.setInterval(announce, laserTiming.announce)
		let expiry = window.setInterval(() => {
			if (performance.now() - lastPointAt > laserTiming.pointExpiry) hide()
		}, 100)
		window.addEventListener("resize", announce)
		window.addEventListener("pagehide", hide)
		return () => {
			announceRef.current = null
			hide()
			channel.postMessage({ type: "closed", id })
			channel.close()
			clearInterval(heartbeat)
			clearInterval(expiry)
			window.removeEventListener("resize", announce)
			window.removeEventListener("pagehide", hide)
		}
	}, [docId, me])

	return <div ref={dotRef} hidden data-laser-pointer style={dotStyle} />
}

let dotStyle = {
	position: "fixed",
	pointerEvents: "none",
	zIndex: 100,
	width: 14,
	height: 14,
	borderRadius: "50%",
	background: "#ff304f",
	border: "2px solid white",
	boxShadow: "0 0 8px #ff304f, 0 0 20px #ff304f",
	transform: "translate(-50%, -50%)",
} satisfies React.CSSProperties

function LaserPreview({ docId }: { docId: string }) {
	let t = useIntl()
	let me = useAccount(UserAccount)
	let [displays, setDisplays] = useState<Display[]>([])
	let [selectedId, setSelectedId] = useState<string | null>(null)
	let [previewSize, setPreviewSize] = useState({ width: 0, height: 0 })
	let channelRef = useRef<ReturnType<typeof createLaserChannel> | null>(null)
	let containerRef = useRef<HTMLDivElement>(null)
	let iframeRef = useRef<HTMLIFrameElement>(null)
	let dotRef = useRef<HTMLDivElement>(null)
	let pointRef = useRef<Point | null>(null)
	let activePointer = useRef<number | null>(null)
	let lastSentAt = useRef(0)
	let target =
		displays.find(display => display.id === selectedId) ??
		(selectedId === null && displays.length === 1 ? displays[0] : undefined)

	let scale = target
		? Math.min(
				previewSize.width / target.width,
				previewSize.height / target.height,
			)
		: 0

	function stopPointing() {
		activePointer.current = null
		let point = pointRef.current
		if (point) channelRef.current?.postMessage({ ...point, visible: false })
		pointRef.current = null
		if (dotRef.current) dotRef.current.hidden = true
	}

	useEffect(() => {
		if (!me.$isLoaded) return
		let connected = new Map<string, Display>()
		let request = crypto.randomUUID()
		function refresh() {
			let now = performance.now()
			for (let [id, display] of connected) {
				if (now - display.seenAt > laserTiming.disconnect) connected.delete(id)
			}
			let available = [...connected.values()]
			setDisplays(available)
			if (available.length === 1)
				setSelectedId(current => (current === null ? available[0].id : current))
		}
		function handleMessage(message: LaserMessage) {
			if (message.type === "display") {
				if (!connected.has(message.id) && !message.requests.includes(request))
					return
				let point = pointRef.current
				if (
					point?.target === message.id &&
					point.layout === laserLayoutKey(message)
				)
					pointRef.current = { ...point, lease: message.lease }
				connected.set(message.id, { ...message, seenAt: performance.now() })
				refresh()
			}
			if (message.type === "closed") {
				connected.delete(message.id)
				refresh()
			}
		}
		let channel = createLaserChannel(me, docId, handleMessage)
		channelRef.current = channel
		channel.postMessage({ type: "discover", request })
		let expiry = window.setInterval(refresh, 500)
		let discovery = window.setInterval(() => {
			if (!pointRef.current) channel.postMessage({ type: "discover", request })
		}, 2000)
		let heartbeat = window.setInterval(() => {
			if (pointRef.current) channel.postMessage(pointRef.current)
		}, laserTiming.pointHeartbeat)
		function stop() {
			stopPointing()
		}
		window.addEventListener("blur", stop)
		document.addEventListener("visibilitychange", stop)
		return () => {
			stop()
			channel.close()
			channelRef.current = null
			clearInterval(expiry)
			clearInterval(discovery)
			clearInterval(heartbeat)
			window.removeEventListener("blur", stop)
			document.removeEventListener("visibilitychange", stop)
		}
	}, [docId, me])

	useEffect(() => {
		stopPointing()
	}, [
		target?.id,
		target?.slideNumber,
		target?.width,
		target?.height,
		target?.appearance,
	])

	useEffect(() => {
		let container = containerRef.current
		if (!container) return
		let observer = new ResizeObserver(() =>
			setPreviewSize({
				width: container.clientWidth,
				height: container.clientHeight,
			}),
		)
		observer.observe(container)
		return () => observer.disconnect()
	}, [])

	function endPointer(event: PointerEvent<HTMLDivElement>) {
		if (activePointer.current === event.pointerId) stopPointing()
	}

	function pointAt(event: PointerEvent<HTMLDivElement>) {
		if (!target || activePointer.current !== event.pointerId) return
		let previewSlide = iframeRef.current?.contentDocument
			?.querySelector("[data-current-slide]")
			?.getAttribute("data-current-slide")
		if (previewSlide !== String(target.slideNumber)) return stopPointing()
		let bounds = event.currentTarget.getBoundingClientRect()
		let x = (event.clientX - bounds.left) / bounds.width
		let y = (event.clientY - bounds.top) / bounds.height
		if (x < 0 || x > 1 || y < 0 || y > 1) return stopPointing()
		let point: Point = {
			type: "point",
			target: target.id,
			lease: target.lease,
			layout: laserLayoutKey(target),
			slideNumber: target.slideNumber,
			x,
			y,
			visible: true,
		}
		pointRef.current = point
		if (performance.now() - lastSentAt.current >= laserTiming.pointThrottle) {
			channelRef.current?.postMessage(point)
			lastSentAt.current = performance.now()
		}
		let dot = dotRef.current
		if (dot) {
			dot.hidden = false
			dot.style.left = `${x * 100}%`
			dot.style.top = `${y * 100}%`
		}
	}

	return (
		<aside
			className="bg-muted/30 order-first flex shrink-0 flex-col gap-2 border-b p-3 md:order-last md:w-[42%] md:border-b-0 md:border-l md:p-4"
			aria-label={t("presentation.laser.label")}
		>
			<div className="flex items-center justify-between gap-2 text-sm">
				<strong>{t("presentation.laser.preview")}</strong>
				{(displays.length > 1 || (!target && displays.length > 0)) && (
					<select
						aria-label={t("presentation.laser.target")}
						value={target?.id ?? ""}
						onChange={event => {
							stopPointing()
							setSelectedId(event.target.value)
						}}
					>
						<option value="">{t("presentation.laser.choose")}</option>
						{displays.map((display, index) => (
							<option key={display.id} value={display.id}>
								{t("presentation.laser.display", {
									number: String(index + 1),
									width: String(display.width),
									height: String(display.height),
								})}
							</option>
						))}
					</select>
				)}
			</div>
			<div
				ref={containerRef}
				className="flex max-h-[30svh] w-full items-center justify-center md:max-h-[65svh]"
				style={{
					aspectRatio: target
						? `${target.width} / ${target.height}`
						: undefined,
				}}
			>
				{target ? (
					<div
						className="ring-border relative overflow-hidden rounded ring-1"
						style={{
							width: target.width * scale,
							height: target.height * scale,
						}}
					>
						<iframe
							ref={iframeRef}
							title={t("presentation.laser.preview")}
							src={`/app/doc/${docId}/slideshow?laserPreview=true&laserAppearance=${target.appearance}`}
							tabIndex={-1}
							aria-hidden="true"
							className="pointer-events-none absolute top-0 left-0 origin-top-left border-0"
							style={{
								width: target.width,
								height: target.height,
								transform: `scale(${scale})`,
							}}
						/>
						<div
							role="img"
							data-laser-surface
							aria-label={t("presentation.laser.instructions")}
							className="absolute inset-0 touch-none select-none"
							style={{ cursor: "crosshair" }}
							onPointerDown={event => {
								if (
									!event.isPrimary ||
									(event.pointerType === "mouse" && event.button !== 0)
								)
									return
								activePointer.current = event.pointerId
								lastSentAt.current = -Infinity
								event.preventDefault()
								event.currentTarget.setPointerCapture(event.pointerId)
								pointAt(event)
							}}
							onPointerMove={pointAt}
							onPointerUp={endPointer}
							onPointerCancel={endPointer}
							onLostPointerCapture={endPointer}
						>
							<div
								ref={dotRef}
								hidden
								style={{
									...dotStyle,
									position: "absolute",
									width: 10,
									height: 10,
								}}
							/>
						</div>
					</div>
				) : (
					<p className="text-muted-foreground py-2 text-sm">
						{displays.length
							? t("presentation.laser.chooseHint")
							: t("presentation.laser.connectHint")}
					</p>
				)}
			</div>
			{target && (
				<p className="text-muted-foreground text-xs">
					{t("presentation.laser.instructions")}
				</p>
			)}
		</aside>
	)
}
