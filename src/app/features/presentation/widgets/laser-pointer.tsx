import { useEffect, useRef, useState, type PointerEvent } from "react"
import { useAccount } from "jazz-tools/react"
import {
	Dialog,
	DialogContent,
	DialogTitle,
	DialogClose,
} from "@/app/components/ui/dialog"
import { Button } from "@/app/components/ui/button"
import { X } from "lucide-react"
import { UserAccount } from "@/schema"
import { createLaserChannel } from "../lib/laser-channel"
import {
	createLaserLease,
	laserLayoutKey,
	laserTiming,
	type LaserDisplay,
	type LaserPoint,
} from "../lib/laser-session"
import { isLaserPreview } from "../lib/laser-preview"
import { useIntl } from "@/shared/intl/setup"
import { laserSampleLimit, type LaserMessage } from "../lib/laser-schema"

import { LaserTrail, type LaserTrailController } from "./laser-trail"

export { LaserPreview, LaserReceiver }

type Display = LaserDisplay & { seenAt: number }

function LaserReceiver({
	docId,
	slideNumber,
}: {
	docId: string
	slideNumber: number
}) {
	let me = useAccount(UserAccount)
	let trailRef = useRef<LaserTrailController | null>(null)
	let idRef = useRef(crypto.randomUUID())
	let slideRef = useRef(slideNumber)
	let announceRef = useRef<(() => void) | null>(null)

	useEffect(() => {
		slideRef.current = slideNumber
		trailRef.current?.clear()
		announceRef.current?.()
	}, [slideNumber])

	useEffect(() => {
		// The preview must not announce itself as another projector.
		if (isLaserPreview() || !me.$isLoaded) return
		let leases = createLaserLease()
		let requests = new Set<string>()
		let announcedLayout = ""
		let id = idRef.current
		function hide() {
			trailRef.current?.clear()
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
			if (message.type !== "point" || message.target !== id) return
			let layout = laserLayoutKey(displayLayout())
			if (message.layout !== layout || !leases.accepts(message.lease, layout))
				return
			if (message.slideNumber !== slideRef.current) {
				hide()
				return
			}
			trailRef.current?.add(message)
		}
		let channel = createLaserChannel(me, docId, handleMessage)
		announceRef.current = announce
		announce()
		let heartbeat = window.setInterval(announce, laserTiming.announce)
		window.addEventListener("resize", announce)
		window.addEventListener("pagehide", hide)
		return () => {
			announceRef.current = null
			hide()
			channel.postMessage({ type: "closed", id })
			channel.close()
			clearInterval(heartbeat)
			window.removeEventListener("resize", announce)
			window.removeEventListener("pagehide", hide)
		}
	}, [docId, me])

	return <LaserTrail controllerRef={trailRef} fixed />
}

function LaserPreview({
	docId,
	visible = true,
	dialog = false,
	onClose,
}: {
	docId: string
	visible?: boolean
	dialog?: boolean
	onClose?: () => void
}) {
	let t = useIntl()
	let me = useAccount(UserAccount)
	let [displays, setDisplays] = useState<Display[]>([])
	let [selectedId, setSelectedId] = useState<string | null>(null)
	let [previewSize, setPreviewSize] = useState({ width: 0, height: 0 })
	let channelRef = useRef<ReturnType<typeof createLaserChannel> | null>(null)
	let iframeRef = useRef<HTMLIFrameElement>(null)
	let trailRef = useRef<LaserTrailController | null>(null)
	let pointRef = useRef<LaserPoint | null>(null)
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
		pausePointing()
	}

	function pausePointing() {
		let point = pointRef.current
		if (point) {
			let end = { ...point, visible: false }
			channelRef.current?.postMessage(end)
			trailRef.current?.add(end)
		}
		pointRef.current = null
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
			if (
				pointRef.current &&
				performance.now() - lastSentAt.current >= laserTiming.pointHeartbeat
			) {
				lastSentAt.current = performance.now()
				channel.postMessage(pointRef.current)
				trailRef.current?.add(pointRef.current)
			}
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
		trailRef.current?.clear()
	}, [
		visible,
		dialog,
		target?.id,
		target?.slideNumber,
		target?.width,
		target?.height,
		target?.appearance,
	])

	function observePreview(container: HTMLDivElement | null) {
		if (!container) return
		function measure() {
			if (!container) return
			let width = container.clientWidth
			let height = container.clientHeight
			setPreviewSize(current =>
				current.width === width && current.height === height
					? current
					: { width, height },
			)
		}
		let observer = new ResizeObserver(measure)
		observer.observe(container)
		return () => observer.disconnect()
	}

	function endPointer(event: PointerEvent<HTMLDivElement>) {
		if (activePointer.current !== event.pointerId) return
		if (event.type === "pointerup") pointAt(event)
		stopPointing()
	}

	function pointAt(event: PointerEvent<HTMLDivElement>) {
		if (!target || activePointer.current !== event.pointerId) return
		let previewSlide = iframeRef.current?.contentDocument
			?.querySelector("[data-current-slide]")
			?.getAttribute("data-current-slide")
		if (previewSlide !== String(target.slideNumber)) return stopPointing()
		let bounds = event.currentTarget.getBoundingClientRect()
		let samples = event.nativeEvent.getCoalescedEvents?.() ?? []
		for (let sample of [...samples, event.nativeEvent]) {
			pointAtPosition(bounds, sample.clientX, sample.clientY)
		}
	}

	function pointAtPosition(bounds: DOMRect, clientX: number, clientY: number) {
		if (!target) return
		if (bounds.width <= 0 || bounds.height <= 0) return pausePointing()
		let x = (clientX - bounds.left) / bounds.width
		let y = (clientY - bounds.top) / bounds.height
		if (
			!Number.isFinite(x) ||
			!Number.isFinite(y) ||
			x < 0 ||
			x > 1 ||
			y < 0 ||
			y > 1
		)
			return pausePointing()
		if (!pointRef.current) lastSentAt.current = -Infinity
		let samples = pointRef.current?.samples ?? []
		let previous = samples.at(-1)
		if (!previous || previous.x !== x || previous.y !== y)
			samples = [
				...samples,
				{ index: (previous?.index ?? -1) + 1, x, y },
			].slice(-laserSampleLimit)
		let point: LaserPoint = {
			samples,
			type: "point",
			stroke: pointRef.current?.stroke ?? crypto.randomUUID(),
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
		trailRef.current?.add(point)
	}

	if (!visible) return null

	let preview = (
		<aside
			className={
				dialog
					? "flex min-h-0 flex-1 flex-col justify-center gap-3"
					: "bg-muted/30 flex w-[42%] shrink-0 flex-col gap-2 border-l p-4"
			}
			aria-label={t("presentation.laser.label")}
		>
			<div className="flex items-center justify-between gap-2 text-sm">
				{!dialog && <strong>{t("presentation.laser.preview")}</strong>}
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
				ref={observePreview}
				className={
					dialog
						? "flex max-h-[75svh] w-full items-center justify-center"
						: "flex max-h-[65svh] w-full items-center justify-center"
				}
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
								event.preventDefault()
								event.currentTarget.setPointerCapture(event.pointerId)
								pointAt(event)
							}}
							onPointerMove={pointAt}
							onPointerUp={endPointer}
							onPointerCancel={endPointer}
							onLostPointerCapture={endPointer}
						>
							<LaserTrail controllerRef={trailRef} />
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
	if (!dialog) return preview
	return (
		<Dialog
			open={visible}
			onOpenChange={open => {
				if (!open) onClose?.()
			}}
			disablePointerDismissal
		>
			<DialogContent
				showCloseButton={false}
				style={{
					paddingTop: "max(1rem, env(safe-area-inset-top))",
					paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
					paddingLeft: "max(1rem, env(safe-area-inset-left))",
					paddingRight: "max(1rem, env(safe-area-inset-right))",
				}}
				className="inset-0 top-0 left-0 flex h-dvh max-w-none translate-x-0 flex-col sm:top-0 sm:max-w-none sm:translate-y-0"
			>
				<div className="flex shrink-0 items-center justify-between gap-2">
					<DialogTitle>{t("presentation.laser.preview")}</DialogTitle>
					<DialogClose render={<Button variant="ghost" size="sm" />}>
						<X />
						{t("presentation.laser.notes")}
					</DialogClose>
				</div>
				{preview}
			</DialogContent>
		</Dialog>
	)
}
