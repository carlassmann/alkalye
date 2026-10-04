import type { Point } from "../../shared/drawing"
import { svg } from "../drawing-svg"
import type { Presence } from "../../shared/model"

interface DrawingPresenceOptions {
	board: SVGSVGElement
	people(): readonly Presence[]
	announce(value: Presence): Promise<unknown>
	boardId: string
	documentId: string
	actor: string
	name: string
	signal: AbortSignal
}

export function drawingPresence(options: DrawingPresenceOptions) {
	let { board, boardId, documentId, actor, name, signal } = options
	let layer = svg("g", { "data-drawing-presence": "" })
	board.append(layer)
	let pointer: Point | undefined
	let lastAnnouncement = 0
	let heartbeat = setInterval(() => {
		announce()
		paint()
	}, 2000)
	signal.addEventListener(
		"abort",
		() => {
			clearInterval(heartbeat)
			pointer = undefined
			announce()
		},
		{ once: true },
	)
	announce()
	return { move, paint }

	function move(point?: Point) {
		pointer = point
		if (!point || performance.now() - lastAnnouncement > 60) announce()
	}
	function announce() {
		lastAnnouncement = performance.now()
		void options
			.announce({
				actor,
				name,
				document: documentId,
				board: boardId,
				boardOpen: !signal.aborted,
				drawingActive: Boolean(pointer),
				cursor: 0,
				slide: 0,
				x: pointer?.x ?? 0,
				y: pointer?.y ?? 0,
				time: Date.now(),
			})
			.catch(() => {})
	}
	function paint() {
		let count = options
			.people()
			.filter(
				person =>
					person.actor !== actor &&
					person.board === boardId &&
					person.boardOpen &&
					Date.now() - person.time < 10000,
			).length
		let status = board.parentElement?.querySelector("[data-drawing-people]")
		if (status)
			status.textContent = count
				? `${count} ${count === 1 ? "other" : "others"} on this whiteboard`
				: ""
		layer.replaceChildren()
		let scale = 1 / Math.max(0.001, Math.abs(board.getScreenCTM()?.a ?? 1))
		for (let person of options.people()) {
			if (
				person.actor === actor ||
				person.board !== boardId ||
				!person.drawingActive ||
				Date.now() - person.time > 10000
			)
				continue
			let cursor = svg("g", {
				transform: `translate(${person.x} ${person.y}) scale(${scale})`,
			})
			let label = svg("text", { x: 20, y: 29 })
			label.textContent = person.name.slice(0, 40)
			cursor.append(
				svg("path", { d: "M0 0 L4 19 L9 13 L17 12 Z" }),
				svg("rect", {
					x: 14,
					y: 15,
					width: label.textContent.length * 7 + 12,
					height: 20,
					rx: 4,
				}),
				label,
			)
			layer.append(cursor)
		}
	}
}
