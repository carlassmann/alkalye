import * as Effect from "effect/Effect"
import { Replica } from "./crdt"
import { applyAction, validateAction } from "./document-actions"
import type { CommittedAction, DocumentAction } from "./document-actions"
import {
	sourceMetadataFields,
	canonicalDocumentSource,
	relocatedRange,
} from "./document-metadata"
import { commentRange } from "./documents"
import type { Operation } from "./model"

export interface LocalDocumentMoment {
	readonly source: "local"
	readonly position: number
	readonly subject: string
	readonly action: DocumentAction
}

export type DocumentMoment =
	| LocalDocumentMoment
	| {
			readonly source?: undefined
			readonly position: number
			readonly action: CommittedAction
	  }

export function historicalDocument(
	document: string,
	moments: readonly DocumentMoment[],
	position: number,
) {
	return Effect.gen(function* () {
		let replica = new Replica("document-history")
		let previous = 0
		for (let moment of moments) {
			if (moment.position > position) break
			if (moment.position <= previous || moment.action.document !== document)
				return yield* Effect.fail(new Error("Document history is out of order"))
			if (moment.source === "local")
				replica.apply(yield* validateAction(replica, moment.action))
			else yield* applyAction(replica, moment.action)
			if (!previous && replica.fields(document).type !== "document")
				return yield* Effect.fail(
					new Error("The document creation is not downloaded"),
				)
			previous = moment.position
		}
		if (previous !== position)
			return yield* Effect.fail(new Error("This moment is not downloaded"))
		return replica
	})
}

export function restoreDocumentState(
	current: Replica,
	historical: Replica,
	document: string,
) {
	let changes: (Operation | null)[] = []
	let targets = new Set([
		...current.checkpoint().targets.map(target => target.id),
		...historical.checkpoint().targets.map(target => target.id),
	])
	let ranges = new Map(
		historical
			.records("comment")
			.map(comment => [
				comment.id,
				commentRange(historical, document, comment.fields),
			]),
	)
	for (let target of targets) {
		let before = historical.fields(target)
		let after = current.fields(target)
		if (target !== document) {
			if (after.document && after.document !== document) continue
			if (before.document !== document && after.document !== document) continue
			if (!before.type || before.type === "deleted") {
				if (after.type !== "deleted")
					changes.push(current.set(target, "type", "deleted"))
				continue
			}
		}
		for (let field of new Set([
			...Object.keys(before),
			...Object.keys(after),
		])) {
			if (
				field === "document" ||
				field.startsWith("access:") ||
				(target === document &&
					(field === "type" ||
						field === "metadata" ||
						sourceMetadataFields.includes(field)))
			)
				continue
			let value = before[field] ?? ""
			if (value !== after[field])
				changes.push(current.set(target, field, value))
		}
		changes.push(
			current.edit(
				target,
				target === document
					? canonicalDocumentSource(
							historical.text(document),
							historical.fields(document),
						)
					: historical.text(target),
			),
		)
	}
	let atoms = current.visible(document)
	for (let [id, range] of ranges) {
		if (!range || current.fields(id).document !== document) continue
		let bounds =
			historical.text(document) === current.text(document)
				? range
				: relocatedRange(
						historical.text(document),
						current.text(document),
						range,
					)
		if (!bounds) continue
		let offset = 0
		let anchor = atoms
			.filter(atom => {
				let start = offset
				offset += atom.value.length
				return offset > bounds.start && start < bounds.end
			})
			.map(atom => atom.id)
		let value = JSON.stringify(anchor)
		if (current.fields(id).anchor !== value)
			changes.push(current.set(id, "anchor", value))
	}
	return changes
}
