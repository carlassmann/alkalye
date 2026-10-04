import * as Effect from "effect/Effect"
import * as Graph from "effect/Graph"
import { DocumentConflict, UndoUnavailable } from "./document-errors"

export interface UndoEntry {
	id: string
	subject: string
	undoOf?: string
	order: number
	local: boolean
	birth: boolean
	active: boolean
	eligible?: boolean
}

export function selectDocumentUndo(
	entries: ReadonlyArray<UndoEntry>,
	subject: string,
	redo: boolean,
) {
	return documentUndoCandidates(entries, subject, redo).pipe(
		Effect.flatMap(candidates =>
			candidates[0]
				? Effect.succeed(candidates[0])
				: Effect.fail(
						new UndoUnavailable({
							reason: "Exhausted",
							message: redo ? "Nothing to redo" : "Nothing to undo",
						}),
					),
		),
	)
}

export function documentUndoCandidates(
	entries: ReadonlyArray<UndoEntry>,
	subject: string,
	redo: boolean,
) {
	return Effect.try({
		try: () => {
			let active = entries.filter(entry => entry.active)
			let nodes = new Map<string, Graph.NodeIndex>()
			let graph = Graph.directed<UndoEntry, undefined>(mutable => {
				for (let entry of active) {
					if (nodes.has(entry.id))
						throw new DocumentConflict({
							message: "Undo history contains a duplicate action",
						})
					nodes.set(entry.id, Graph.addNode(mutable, entry))
				}
				for (let entry of active) {
					let from = entry.undoOf ? nodes.get(entry.undoOf) : undefined
					let to = nodes.get(entry.id)
					if (from !== undefined && to !== undefined)
						Graph.addEdge(mutable, from, to, undefined)
				}
			})
			if (!Graph.isAcyclic(graph))
				throw new DocumentConflict({ message: "Undo history contains a cycle" })
			let normal = active.filter(
				entry =>
					entry.local &&
					entry.subject === subject &&
					!entry.undoOf &&
					!entry.birth,
			)
			let roots = normal.filter(entry => entry.eligible !== false)
			let latestNormal = normal.reduce(
				(latest, entry) => Math.max(latest, entry.order),
				-1,
			)
			let candidates: { root: UndoEntry; tip: UndoEntry; depth: number }[] = []
			let ambiguous = false
			for (let root of roots) {
				let start = nodes.get(root.id)
				if (start === undefined) continue
				let chain = Array.from(
					Graph.entries(Graph.bfs(graph, { start: [start] })),
				)
				if (chain.some(([node]) => Graph.successors(graph, node).length > 1)) {
					ambiguous = true
					continue
				}
				let tip = chain.at(-1)?.[1]
				let depth = chain.length - 1
				if (!tip || tip.subject !== subject || Boolean(depth % 2) !== redo)
					continue
				if (redo && tip.order < latestNormal) continue
				candidates.push({ root, tip, depth })
			}
			candidates.sort((left, right) =>
				redo
					? right.tip.order - left.tip.order
					: right.root.order - left.root.order,
			)
			if (!candidates.length)
				throw new UndoUnavailable({
					reason: ambiguous ? "Superseded" : "Exhausted",
					message: ambiguous
						? "Undo history has an ambiguous compensation chain"
						: redo
							? "Nothing to redo"
							: "Nothing to undo",
				})
			return candidates
		},
		catch: cause =>
			cause instanceof UndoUnavailable || cause instanceof DocumentConflict
				? cause
				: new DocumentConflict({
						message:
							cause instanceof Error ? cause.message : "Invalid undo history",
					}),
	})
}
