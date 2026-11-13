import { app } from "@/jazz/schema"
import type { Database } from "@/app/features/documents"
import {
	laserMessageSchema,
	packLaserMessage,
	unpackLaserMessage,
	type LaserMessage,
} from "./laser-schema"

export { createLaserChannel }

function createLaserChannel(
	db: Database,
	docId: string,
	onMessage: (message: LaserMessage) => void,
) {
	let ownerId = db.getAuthState().session?.user
	let source = crypto.randomUUID(),
		id = crypto.randomUUID()
	let sequence = 0,
		closed = false,
		suspended = false,
		inserted = false
	let seen = new Map<string, number>()
	let unsubscribe = db.subscribe(
		app.laser.where({ documentId: docId }),
		rows => {
			if (closed || suspended) return
			for (let row of rows) {
				if (
					row.senderId === source ||
					(seen.get(row.senderId) ?? 0) >= row.sequence
				)
					continue
				seen.set(row.senderId, row.sequence)
				if (Date.now() - row.updatedAt.getTime() > 15_000) continue
				let parsed = laserMessageSchema.safeParse(row.message)
				if (parsed.success) onMessage(unpackLaserMessage(parsed.data))
			}
		},
	)
	function suspend() {
		suspended = true
	}
	function resume() {
		suspended = false
	}
	window.addEventListener("pagehide", suspend)
	window.addEventListener("pageshow", resume)
	return {
		postMessage(message: LaserMessage) {
			if (closed || suspended || !ownerId) return
			let values = {
				ownerId,
				documentId: docId,
				senderId: source,
				sequence: ++sequence,
				message: packLaserMessage(message),
				updatedAt: new Date(),
			}
			if (inserted) void db.update(app.laser, id, values)
			else {
				inserted = true
				void db.insert(app.laser, values, { id })
			}
		},
		close() {
			closed = true
			unsubscribe()
			window.removeEventListener("pagehide", suspend)
			window.removeEventListener("pageshow", resume)
			if (inserted) void db.delete(app.laser, id)
		},
	}
}
