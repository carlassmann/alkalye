import { useCallback, useEffect, useRef } from "react"
import { useAccount } from "jazz-tools/react"
import { Group, co } from "jazz-tools"
import { CursorFeed, Document, UserAccount } from "@/schema"
import type { MarkdownEditorRef } from "@/app/features/editor"
import { useIntl } from "@/shared/intl/setup"
import {
	getColorForId,
	remoteCursorsExtension,
	setRemoteCursorsEffect,
	type RemoteCursor,
} from "./remote-cursors"

export { usePresence }

let STALE_CURSOR_MS = 10_000

type CursorDoc = {
	$isLoaded: boolean
	cursors?: {
		$isLoaded: boolean
		perSession: Record<
			string,
			| {
					value: { position: number; selectionEnd?: number } | null
					madeAt: Date
					by: {
						$jazz: { id: string }
						profile?: { $isLoaded: boolean; name: string }
					} | null
			  }
			| undefined
		>
	}
} | null

type UsePresenceOptions = {
	doc: co.loaded<typeof Document, { content: true; cursors: true }> | null
	editorRef: React.RefObject<MarkdownEditorRef | null>
	enabled?: boolean
}

function usePresence({ doc, editorRef, enabled = true }: UsePresenceOptions) {
	let t = useIntl()
	let me = useAccount(UserAccount, { resolve: { profile: true } })
	let updateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	let lastPositionRef = useRef<{ pos: number; selEnd?: number } | null>(null)

	let mySessionId = me.$isLoaded ? me.$jazz.sessionID : null

	let ensureCursorFeed = useCallback(() => {
		if (!doc?.$isLoaded) return null

		let docGroup = doc.$jazz.owner
		if (!(docGroup instanceof Group)) return null

		if (!doc.cursors) {
			doc.$jazz.set("cursors", CursorFeed.create([], { owner: docGroup }))
		}

		return doc.cursors
	}, [doc])

	let updateCursor = useCallback(
		(position: number, selectionEnd?: number) => {
			if (!enabled || !mySessionId) return

			let last = lastPositionRef.current
			if (last && last.pos === position && last.selEnd === selectionEnd) {
				return
			}
			lastPositionRef.current = { pos: position, selEnd: selectionEnd }

			if (updateTimeoutRef.current) {
				clearTimeout(updateTimeoutRef.current)
			}

			updateTimeoutRef.current = setTimeout(() => {
				let feed = ensureCursorFeed()
				if (!feed || !feed.$isLoaded) return

				feed.$jazz.push({
					position,
					selectionEnd,
				})
			}, 30)
		},
		[enabled, mySessionId, ensureCursorFeed],
	)

	let remoteCursors = computeRemoteCursors(
		doc as unknown as CursorDoc,
		mySessionId ?? null,
		t("common.anonymous"),
	)

	useEffect(() => {
		let view = editorRef.current?.getEditor()
		if (!view) return
		view.dispatch({ effects: setRemoteCursorsEffect.of(remoteCursors) })
	}, [editorRef, remoteCursors])

	useEffect(() => {
		return () => {
			if (updateTimeoutRef.current) {
				clearTimeout(updateTimeoutRef.current)
			}
		}
	}, [])

	return {
		updateCursor,
		extension: remoteCursorsExtension,
	}
}

function computeRemoteCursors(
	doc: CursorDoc,
	mySessionId: string | null,
	anonymousLabel = "Anonymous",
): RemoteCursor[] {
	if (!doc?.$isLoaded || !doc.cursors || !doc.cursors.$isLoaded || !mySessionId)
		return []

	let now = Date.now()
	let latestByUser = new Map<
		string,
		{
			sessionId: string
			entry: NonNullable<(typeof doc.cursors.perSession)[string]>
		}
	>()

	for (let [sessionId, entry] of Object.entries(doc.cursors.perSession)) {
		if (sessionId === mySessionId) continue
		if (!entry || !entry.value) continue

		let age = now - entry.madeAt.getTime()
		if (age > STALE_CURSOR_MS) continue

		let userId = entry.by?.$jazz.id ?? sessionId
		let existing = latestByUser.get(userId)
		if (!existing || entry.madeAt.getTime() > existing.entry.madeAt.getTime()) {
			latestByUser.set(userId, { sessionId, entry })
		}
	}

	let cursors: RemoteCursor[] = []
	for (let [userId, { sessionId, entry }] of latestByUser) {
		let name = anonymousLabel
		if (entry.by?.profile?.$isLoaded) {
			name = entry.by.profile.name
		}

		cursors.push({
			id: userId,
			sessionId,
			name,
			color: getColorForId(userId),
			position: entry.value!.position,
			selectionEnd: entry.value!.selectionEnd,
		})
	}

	return cursors
}
