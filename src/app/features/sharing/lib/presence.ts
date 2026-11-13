import { useEffect, useRef, useState } from "react"
import { useAll } from "jazz-tools/react"
import { z } from "zod"
import { app } from "@/jazz/schema"
import { useLibrary, type LibraryDocument } from "@/app/features/documents"
import type { MarkdownEditorRef } from "@/app/features/editor"
import {
	getColorForId,
	remoteCursorsExtension,
	setRemoteCursorsEffect,
	type RemoteCursor,
} from "./remote-cursors"
export { usePresence }
let cursorSchema = z.object({
	position: z.number(),
	selectionEnd: z.number().optional(),
	name: z.string(),
})
function usePresence({
	doc,
	editorRef,
}: {
	doc: LibraryDocument
	editorRef: React.RefObject<MarkdownEditorRef | null>
}) {
	let { db, ownerId, profile } = useLibrary()
	let [deviceId] = useState(() => crypto.randomUUID())
	let rowId = useRef<string | null>(null)
	let position = useRef({ position: 0, selectionEnd: 0 })
	let { data: rows = [] } = useAll(app.presence.where({ documentId: doc.id }))
	let [now, setNow] = useState(() => Date.now())
	useEffect(() => {
		let write = db.insert(app.presence, {
			documentId: doc.id,
			accountId: ownerId,
			deviceId,
			updatedAt: new Date(),
		})
		rowId.current = write.value.id
		let interval = setInterval(() => {
			setNow(Date.now())
			void db.update(app.presence, write.value.id, {
				cursor: { ...position.current, name: profile?.name ?? "Anonymous" },
				updatedAt: new Date(),
			})
		}, 2000)
		return () => {
			clearInterval(interval)
			rowId.current = null
			void db.delete(app.presence, write.value.id)
		}
	}, [db, doc.id, ownerId, deviceId, profile?.name])
	useEffect(() => {
		let latest = new Map<string, RemoteCursor>()
		for (let row of [...rows].sort(
			(a, b) => a.updatedAt.getTime() - b.updatedAt.getTime(),
		)) {
			if (row.deviceId === deviceId || now - row.updatedAt.getTime() > 10000)
				continue
			let parsed = cursorSchema.safeParse(row.cursor)
			if (!parsed.success) continue
			latest.set(row.accountId, {
				id: row.accountId,
				sessionId: row.deviceId,
				name: parsed.data.name,
				color: getColorForId(row.accountId),
				position: parsed.data.position,
				selectionEnd: parsed.data.selectionEnd,
			})
		}
		editorRef.current
			?.getEditor()
			?.dispatch({ effects: setRemoteCursorsEffect.of([...latest.values()]) })
	}, [rows, deviceId, now, editorRef])
	function updateCursor(from: number, to: number) {
		position.current = { position: from, selectionEnd: to }
		if (rowId.current)
			void db.update(app.presence, rowId.current, {
				cursor: { ...position.current, name: profile?.name ?? "Anonymous" },
				updatedAt: new Date(),
			})
	}
	return { updateCursor, extension: remoteCursorsExtension }
}
