import { useEffect, useState } from "react"
import { useDb } from "jazz-tools/react"
import { app } from "@/jazz/schema"
import type { TextUpdate } from "../lib/codemirror-sync"

export { useDocumentContent }

function useDocumentContent(id: string) {
	let db = useDb()
	let [snapshot, setSnapshot] = useState<{
		id: string
		content: string | null
		update?: TextUpdate
		error?: Error
	}>()
	useEffect(() => {
		let previous: string | undefined
		return db.subscribe(
			app.documents.where({ id }).select("content"),
			{
				onUpdate(rows, changes) {
					let content = rows[0]?.content ?? null
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
					setSnapshot({ id, content, update })
					previous = content ?? undefined
				},
				onError(error) {
					setSnapshot({ id, content: null, error })
				},
			},
			{ splices: ["content"] },
		)
	}, [db, id])
	if (snapshot?.error) throw snapshot.error
	return snapshot?.id === id ? snapshot : undefined
}
