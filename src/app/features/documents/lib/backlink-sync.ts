import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Document } from "./schema"
import { Space, UserAccount } from "@/schema"
import { parseWikiLinks } from "@/app/features/editor/lib/wikilink-parser"
import { applyContentDiffWithCommentAnchors } from "@/app/features/comments"
import {
	getBacklinks,
	addBacklink,
	removeBacklink,
} from "@/app/features/editor/lib/frontmatter"
import { co, type ResolveQuery } from "jazz-tools"
import { useAccount, useCoState } from "jazz-tools/react"
import { syncDocumentMetadata } from "./metadata"

export {
	createBacklinkSyncCoordinator,
	backlinkMeResolve,
	backlinkSpaceResolve,
	useBacklinkSync,
	getBacklinkLinkChanges,
	getWikilinkIds,
}

type LoadedDoc = co.loaded<
	typeof Document,
	{ content: true; comments: { $each: true } }
>

// Backlink sync options - when spaceId is provided, only sync within that space
type BacklinkSyncOptions = {
	spaceId?: string
	initialContent?: string
}

type BacklinkLinkChanges = {
	currentLinkIds: Set<string>
	addedIds: string[]
	removedIds: string[]
}

type BacklinkChange = {
	linkedId: string
	operation: "add" | "remove"
}

type BacklinkSyncSession = {
	sourceId: string
	lastSyncedLinkIds: Set<string>
	queuedContent: string | null
	ready: boolean
}

type BacklinkSyncAttempt = {
	sourceId: string
	lastSyncedLinkIds: Set<string>
	content: string
	shouldContinue: () => boolean
}

type BacklinkSyncAttemptResult =
	| { status: "synced"; currentLinkIds: Set<string> }
	| { status: "interrupted" }

type RunBacklinkSyncAttempt = (
	attempt: BacklinkSyncAttempt,
) => Promise<BacklinkSyncAttemptResult>

type CompletedBacklinkSyncAttempt = {
	session: BacklinkSyncSession
	status: "completed" | "failed"
}

let backlinkMeResolve = {
	root: { documents: { $each: true } },
} as const satisfies ResolveQuery<typeof UserAccount>

let backlinkSpaceResolve = {
	documents: { $each: true },
} as const satisfies ResolveQuery<typeof Space>

function useBacklinkSync(
	docId: string,
	readOnly: boolean,
	options: BacklinkSyncOptions = {},
) {
	let { spaceId, initialContent = "" } = options

	let me = useAccount(UserAccount, {
		resolve: backlinkMeResolve,
	})

	let space = useCoState(Space, spaceId, {
		resolve: backlinkSpaceResolve,
	})

	let meRef = useRef(me)
	let spaceRef = useRef(space)
	let spaceIdRef = useRef(spaceId)

	function getDocumentIds(): Set<string> {
		let currentSpace = spaceRef.current
		let currentMe = meRef.current

		if (spaceIdRef.current) {
			if (!currentSpace?.$isLoaded || !currentSpace.documents?.$isLoaded) {
				return new Set()
			}
			return new Set(
				currentSpace.documents.flatMap(d => {
					if (!d?.$isLoaded || d.deletedAt) return []
					return [d.$jazz.id]
				}),
			)
		}

		if (!currentMe.$isLoaded || !currentMe.root?.documents?.$isLoaded) {
			return new Set()
		}
		return new Set(
			currentMe.root.documents.flatMap(d => {
				if (!d?.$isLoaded || d.deletedAt || d.spaceId) return []
				return [d.$jazz.id]
			}),
		)
	}

	let timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	let [coordinator] = useState(() => createBacklinkSyncCoordinator())
	let sessionRef = useRef<BacklinkSyncSession | null>(null)

	let docsReady = spaceId
		? space?.$isLoaded && space.documents?.$isLoaded
		: me.$isLoaded && me.root?.documents?.$isLoaded

	useLayoutEffect(() => {
		meRef.current = me
		spaceRef.current = space
		spaceIdRef.current = spaceId
		let previousSession = sessionRef.current
		let session = coordinator.openSession(docId, initialContent)
		sessionRef.current = session
		coordinator.setReady(session, Boolean(docsReady && !readOnly))
		if (previousSession !== session && timeoutRef.current) {
			clearTimeout(timeoutRef.current)
		}
	}, [
		coordinator,
		docId,
		docsReady,
		initialContent,
		me,
		readOnly,
		space,
		spaceId,
	])

	useEffect(() => {
		return () => {
			let session = sessionRef.current
			if (session) coordinator.closeSession(session)
			if (timeoutRef.current) clearTimeout(timeoutRef.current)
		}
	}, [coordinator])

	async function runBacklinkSyncAttempt(
		attempt: BacklinkSyncAttempt,
	): Promise<BacklinkSyncAttemptResult> {
		let { currentLinkIds, addedIds, removedIds } = getBacklinkLinkChanges(
			attempt.lastSyncedLinkIds,
			attempt.content,
		)
		let docIds = getDocumentIds()
		let changes: BacklinkChange[] = []
		for (let linkedId of addedIds) changes.push({ linkedId, operation: "add" })
		for (let linkedId of removedIds) {
			changes.push({ linkedId, operation: "remove" })
		}

		for (let change of changes) {
			if (!attempt.shouldContinue()) return { status: "interrupted" }
			let { linkedId, operation } = change
			if (!docIds.has(linkedId)) continue
			let linkedDoc = await loadLinkTarget(linkedId)
			if (!attempt.shouldContinue()) return { status: "interrupted" }
			if (!linkedDoc || !canEditDoc(linkedDoc)) continue

			let linkedContent = linkedDoc.content?.toString() ?? ""
			let hasBacklink = getBacklinks(linkedContent).includes(attempt.sourceId)
			if ((operation === "add") === hasBacklink) continue
			let updatedContent =
				operation === "add"
					? addBacklink(linkedContent, attempt.sourceId)
					: removeBacklink(linkedContent, attempt.sourceId)
			if (linkedDoc.content) {
				applyContentDiffWithCommentAnchors(linkedDoc, updatedContent)
			}
			linkedDoc.$jazz.set("updatedAt", new Date())
			syncDocumentMetadata(linkedDoc)
		}

		if (!attempt.shouldContinue()) return { status: "interrupted" }
		return { status: "synced", currentLinkIds }
	}

	useEffect(() => {
		if (!docsReady || readOnly) return
		let session = sessionRef.current
		if (!session || session.sourceId !== docId) return
		void coordinator.run(session, runBacklinkSyncAttempt)
	})

	function sync(content: string) {
		let session = sessionRef.current
		if (!session || session.sourceId !== docId) return
		coordinator.queue(session, content)
		if (timeoutRef.current) clearTimeout(timeoutRef.current)
		timeoutRef.current = setTimeout(
			() => void coordinator.run(session, runBacklinkSyncAttempt),
			400,
		)
	}

	return { syncBacklinks: sync }
}

function getWikilinkIds(content: string): Set<string> {
	return new Set(parseWikiLinks(content).map(l => l.id))
}

function getBacklinkLinkChanges(
	lastSyncedLinkIds: Set<string>,
	content: string,
): BacklinkLinkChanges {
	let currentLinkIds = getWikilinkIds(content)
	return {
		currentLinkIds,
		addedIds: [...currentLinkIds].filter(id => !lastSyncedLinkIds.has(id)),
		removedIds: [...lastSyncedLinkIds].filter(id => !currentLinkIds.has(id)),
	}
}

function createBacklinkSyncCoordinator() {
	let activeSession: BacklinkSyncSession | null = null
	let runningAttempt: Promise<CompletedBacklinkSyncAttempt> | null = null

	function openSession(sourceId: string, initialContent: string) {
		if (activeSession?.sourceId === sourceId) return activeSession
		let session: BacklinkSyncSession = {
			sourceId,
			lastSyncedLinkIds: getWikilinkIds(initialContent),
			queuedContent: null,
			ready: false,
		}
		activeSession = session
		return session
	}

	function closeSession(session: BacklinkSyncSession) {
		if (activeSession !== session) return
		session.ready = false
		session.queuedContent = null
		activeSession = null
	}

	function setReady(session: BacklinkSyncSession, ready: boolean) {
		if (activeSession !== session) return
		session.ready = ready
	}

	function queue(session: BacklinkSyncSession, content: string) {
		if (activeSession !== session) return
		session.queuedContent = content
	}

	function shouldRun(session: BacklinkSyncSession) {
		return (
			activeSession === session &&
			session.ready &&
			session.queuedContent !== null
		)
	}

	async function performAttempt(
		session: BacklinkSyncSession,
		runAttempt: RunBacklinkSyncAttempt,
	) {
		let content = session.queuedContent
		if (content === null) return "completed" as const
		session.queuedContent = null

		try {
			let result = await runAttempt({
				sourceId: session.sourceId,
				lastSyncedLinkIds: session.lastSyncedLinkIds,
				content,
				shouldContinue: () => activeSession === session && session.ready,
			})

			if (activeSession !== session) return "completed" as const
			if (result.status === "interrupted") {
				session.queuedContent ??= content
				return "completed" as const
			}
			session.lastSyncedLinkIds = result.currentLinkIds
			return "completed" as const
		} catch {
			if (activeSession === session) session.queuedContent ??= content
			return "failed" as const
		}
	}

	async function startAttempt(
		session: BacklinkSyncSession,
		runAttempt: RunBacklinkSyncAttempt,
	) {
		let status = await performAttempt(session, runAttempt)
		return { session, status }
	}

	async function run(
		session: BacklinkSyncSession,
		runAttempt: RunBacklinkSyncAttempt,
	) {
		while (shouldRun(session)) {
			let attempt = runningAttempt
			if (!attempt) {
				attempt = startAttempt(session, runAttempt)
				runningAttempt = attempt
			}
			let completed = await attempt
			if (runningAttempt === attempt) runningAttempt = null
			if (completed.session === session && completed.status === "failed") return
		}
	}

	return { openSession, closeSession, setReady, queue, run }
}

async function loadLinkTarget(id: string): Promise<LoadedDoc | null> {
	let doc = await Document.load(id, {
		resolve: { content: true, comments: { $each: true } },
	})
	return doc.$isLoaded ? doc : null
}

function canEditDoc(doc: LoadedDoc): boolean {
	let role = doc.$jazz.owner.myRole?.()
	return role === "admin" || role === "writer"
}
