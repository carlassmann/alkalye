import { useEffect, useState } from "react"
import { useDb } from "jazz-tools/react"
import { app } from "@/jazz/schema"
import type { TextUpdate } from "../lib/codemirror-sync"

export { useDocumentContent }

function useDocumentContent(id: string) {
	let db = useDb()
	let [source] = useState(() => {
		let listeners = new Set<(value: string, update?: TextUpdate) => void>()
		let latest: { value: string; update?: TextUpdate } | undefined
		return {
			publish(value: string, update?: TextUpdate) {
				latest = { value, update }
				for (let listener of listeners) listener(value, update)
			},
			subscribe(listener: (value: string, update?: TextUpdate) => void) {
				listeners.add(listener)
				if (latest) listener(latest.value, latest.update)
				return () => {
					listeners.delete(listener)
				}
			},
		}
	})
	let [snapshot, setSnapshot] = useState<{
		id: string
		content: string | null
		update?: TextUpdate
		error?: Error
	}>()
	useEffect(() => {
		let previous: string | undefined
		let timer: ReturnType<typeof setTimeout> | undefined
		let stop = db.subscribe(
			app.documents.where({ id }).select("content"),
			{
				onUpdate(rows, changes) {
					let content = rows[0]?.content ?? null
					if (content !== null && content === previous) return
					let splices = changes.splices.get(id)?.content
					let update =
						previous !== undefined && splices
							? {
									previous,
									splices: splices.map(splice => {
										if (typeof splice.insert !== "string")
											throw new Error("Expected text splice")
										return { ...splice, insert: splice.insert }
									}),
								}
							: undefined
					if (content !== null) source.publish(content, update)
					clearTimeout(timer)
					if (previous === undefined || content === null)
						setSnapshot({ id, content, update })
					else
						timer = setTimeout(() => setSnapshot({ id, content, update }), 300)
					previous = content ?? undefined
				},
				onError(error) {
					clearTimeout(timer)
					setSnapshot({ id, content: null, error })
				},
			},
			{ splices: ["content"] },
		)
		return () => {
			clearTimeout(timer)
			stop()
		}
	}, [db, id, source])
	if (snapshot?.error) throw snapshot.error
	return snapshot?.id === id ? { ...snapshot, source } : undefined
}
