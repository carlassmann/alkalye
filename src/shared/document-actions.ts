import * as Effect from "effect/Effect"
import * as Crypto from "effect/Crypto"
import * as Option from "effect/Option"
import { DocumentConflict, UndoUnavailable } from "./document-errors"
import { assetReferences } from "./authoring"
import { sourceMetadataFields } from "./document-metadata"
import { requiredBlobChunks } from "./document-blobs"
import * as Schema from "effect/Schema"
import { encode } from "./base64"
import { Replica } from "./crdt"
import {
	IdentifierSchema,
	AtomSchema,
	DeletionRunSchema,
	OperationEnvelopeSchema,
	TextOperationIdSchema,
	compactOperation,
	parseOperation,
} from "./model"
import type { Operation } from "./model"

export let maximumActionChanges = 1024
export let maximumActionText = 2_000_000
export let maximumActionIdentityCharacters = 4_000_000
let AtomIdentitySchema = Schema.String.check(Schema.isMaxLength(160))
let FieldNameSchema = Schema.String.check(Schema.isMaxLength(256))
let ContentSchema = Schema.String.check(Schema.isMaxLength(maximumActionText))
let FieldSchema = Schema.Struct({
	target: IdentifierSchema,
	field: FieldNameSchema,
	value: ContentSchema,
})
let BeforeFieldSchema = Schema.Struct({
	...FieldSchema.fields,
	contributor: Schema.optional(TextOperationIdSchema),
})
let GuardSchema = Schema.Struct({
	target: IdentifierSchema,
	state: Schema.String.check(Schema.isPattern(/^[\w-]{43}$/)),
})
let BoundedAtomSchema = Schema.Struct({
	...AtomSchema.fields,
	id: AtomIdentitySchema,
	after: AtomIdentitySchema,
	value: ContentSchema,
	order: Schema.optional(
		Schema.Array(AtomIdentitySchema).check(
			Schema.isMaxLength(maximumActionText),
		),
	),
	deleted: Schema.optional(
		Schema.Array(AtomIdentitySchema).check(
			Schema.isMaxLength(maximumActionText),
		),
	),
})
let BoundedOperationSchema = Schema.Struct({
	...OperationEnvelopeSchema.fields,
	id: Schema.String.check(Schema.isMaxLength(128)),
	actor: Schema.String.check(Schema.isMaxLength(100)),
	author: Schema.String.check(Schema.isMaxLength(256)),
	field: FieldNameSchema,
	value: ContentSchema,
	insert: Schema.Array(BoundedAtomSchema).check(
		Schema.isMaxLength(maximumActionText),
	),
	remove: Schema.Array(
		Schema.Union([AtomIdentitySchema, DeletionRunSchema]),
	).check(Schema.isMaxLength(maximumActionText)),
})
let BoundedChangesSchema = Schema.NonEmptyArray(BoundedOperationSchema).check(
	Schema.isMaxLength(maximumActionChanges),
	Schema.makeFilter(
		changes => {
			let inserted = 0,
				removed = 0,
				identities = 0,
				identityCharacters = 0
			for (let change of changes) {
				identityCharacters += change.restores?.length ?? 0
				inserted += change.value.length
				for (let atom of change.insert) {
					inserted += Math.max(1, atom.value.length)
					identities +=
						2 + (atom.order?.length ?? 0) + (atom.deleted?.length ?? 0)
					identityCharacters += atom.id.length + atom.after.length
					for (let id of atom.order ?? []) identityCharacters += id.length
					for (let id of atom.deleted ?? []) identityCharacters += id.length
				}
				for (let atom of change.remove) {
					let id = typeof atom === "string" ? atom : atom.id
					if (id.length > 160) return false
					identityCharacters += id.length
					removed += typeof atom === "string" ? 1 : atom.count
				}
				if (
					inserted > maximumActionText ||
					removed > maximumActionText ||
					identities > maximumActionText ||
					identityCharacters > maximumActionIdentityCharacters
				)
					return false
			}
			return true
		},
		{ message: "Split large changes into smaller actions" },
	),
)
export let ActionIdSchema = Schema.NonEmptyString.check(Schema.isMaxLength(128))
let ActionFields = {
	id: ActionIdSchema,
	document: IdentifierSchema,
	actor: IdentifierSchema,
	label: Schema.NonEmptyString.check(Schema.isMaxLength(256)),
	changes: BoundedChangesSchema,
	undoOf: Schema.optional(ActionIdSchema),
}
export let DocumentActionSchema = Schema.Struct({
	...ActionFields,
	guards: Schema.Array(GuardSchema).check(
		Schema.isMaxLength(maximumActionChanges),
	),
	accessGuards: Schema.Array(
		Schema.Struct({
			field: Schema.String.check(Schema.isMaxLength(256)),
			observed: Schema.String.check(Schema.isMaxLength(128)),
		}),
	).check(Schema.isMaxLength(maximumActionChanges)),
}).check(
	Schema.makeFilter(
		action => {
			let targets = new Set(action.changes.map(change => change.target))
			return (
				(!action.guards.length || !!action.undoOf) &&
				new Set(action.guards.map(guard => guard.target)).size ===
					action.guards.length &&
				action.guards.every(guard => targets.has(guard.target))
			)
		},
		{ message: "Undo guards must identify distinct changed targets" },
	),
)
export type DocumentAction = typeof DocumentActionSchema.Type
export let ActionProvenanceSchema = Schema.Struct({
	retained: Schema.optional(
		Schema.Array(
			Schema.Struct({
				target: IdentifierSchema,
				field: FieldNameSchema,
				id: ActionIdSchema,
			}),
		).check(
			Schema.isMaxLength(maximumActionText),
			Schema.makeFilter(
				fields =>
					fields.reduce(
						(size, field) =>
							size + field.target.length + field.field.length + field.id.length,
						0,
					) <= maximumActionIdentityCharacters &&
					new Set(fields.map(fieldKey)).size === fields.length,
				{
					message:
						"Split restorations with large record provenance into smaller actions",
				},
			),
		),
	),
	before: Schema.Array(BeforeFieldSchema).check(
		Schema.isMaxLength(maximumActionChanges),
		Schema.makeFilter(
			fields =>
				fields.reduce((size, field) => size + field.value.length, 0) <=
					maximumActionText &&
				fields.reduce(
					(size, field) => size + (field.contributor?.length ?? 0),
					0,
				) <= maximumActionIdentityCharacters,
			{
				message: "Split changes with large before-images into smaller actions",
			},
		),
	),
})
let ProvenancedActionSchema = Schema.Struct({
	...ActionFields,
	...ActionProvenanceSchema.fields,
	subject: IdentifierSchema,
})
export let PreparedActionSchema = ProvenancedActionSchema.pipe(
	Schema.brand("PreparedDocumentAction"),
)
export type PreparedAction = typeof PreparedActionSchema.Type
export let CommittedActionSchema = ProvenancedActionSchema.pipe(
	Schema.brand("CommittedDocumentAction"),
)
export type CommittedAction = typeof CommittedActionSchema.Type
export let DocumentSnapshotSchema = Schema.Struct({
	format: Schema.Literal("document-state-v1"),
	document: IdentifierSchema,
	log: IdentifierSchema,
	position: Schema.Natural,
	state: Schema.String,
})
export type DocumentSnapshot = typeof DocumentSnapshotSchema.Type
export let ActionChainSchema = Schema.Struct({
	document: IdentifierSchema,
	from: ActionIdSchema,
	latest: ActionIdSchema,
	position: Schema.Natural,
	depth: Schema.Natural,
	log: IdentifierSchema,
})
export type ActionChain = typeof ActionChainSchema.Type
export let LocalDocumentCreationSchema = Schema.Struct({
	workspace: IdentifierSchema,
	workspaceOwner: Schema.optional(IdentifierSchema),
	subject: IdentifierSchema,
	action: DocumentActionSchema,
})
export type LocalDocumentCreation = typeof LocalDocumentCreationSchema.Type
export let DocumentPublicationSchema = Schema.Struct({
	log: IdentifierSchema,
	initial: Schema.Struct({
		position: Schema.Natural.check(Schema.isGreaterThan(0)),
		action: CommittedActionSchema,
	}),
})
export type DocumentPublication = typeof DocumentPublicationSchema.Type
export {
	DocumentConflict,
	DocumentHistoryUnavailable,
	ResourceUnavailable,
	PermissionDenied,
	AccessConflict,
} from "./document-errors"

export function buildAction(
	replica: Pick<Replica, "actor" | "forkEffect" | "register">,
	document: string,
	label: string,
	build: (staged: Replica) => (Operation | null)[],
	actor = replica.actor,
) {
	return buildOptionalAction(replica, document, label, build, actor).pipe(
		Effect.flatMap(
			Option.match({
				onNone: () =>
					Effect.fail(
						new DocumentConflict({ message: "An action must contain changes" }),
					),
				onSome: Effect.succeed,
			}),
		),
	)
}
export function buildOptionalAction(
	replica: Pick<Replica, "actor" | "forkEffect" | "register">,
	document: string,
	label: string,
	build: (staged: Replica) => (Operation | null)[],
	actor = replica.actor,
) {
	return replica.forkEffect(actor).pipe(
		Effect.mapError(cause => new DocumentConflict({ message: cause.message })),
		Effect.flatMap(staged =>
			attempt(() => {
				let changes = build(staged)
					.filter(change => change !== null)
					.map(compactOperation)
				let last = changes.at(-1)
				if (!last) return Option.none<DocumentAction>()
				return Option.some(
					Schema.decodeUnknownSync(DocumentActionSchema)({
						id: last.id,
						document,
						actor,
						label,
						changes,
						guards: [],
						accessGuards: [
							...new Set(
								changes
									.filter(
										change =>
											change.target === document &&
											change.field.startsWith("access:"),
									)
									.map(change => change.field),
							),
						].map(field => ({
							field,
							observed: replica.register(document, field)?.id ?? "",
						})),
					}),
				)
			}),
		),
	)
}

export function applyAction(replica: Replica, action: CommittedAction) {
	return validateAction(replica, action).pipe(
		Effect.map(changes => replica.apply(changes)),
	)
}

export function validateAction(
	replica: Pick<Replica, "register" | "textOperationTarget">,
	action: Pick<
		CommittedAction,
		"id" | "document" | "actor" | "changes" | "undoOf"
	>,
) {
	return attempt(() => {
		let changes = actionOperations(action)
		if (changes.some(change => change.restores && !action.undoOf))
			throw new Error("Register restoration requires a document compensation")
		for (let change of changes)
			if (
				change.kind === "cancel" &&
				(!action.undoOf ||
					replica.textOperationTarget(change.value) !== change.target)
			)
				throw new Error(
					"Cancellation requires an accepted document contribution and undoOf",
				)
		let children = new Map<
			string,
			{ previous: string; winner: { id: string; value: string } | undefined }
		>()
		for (let change of changes) {
			if (change.target === action.document) continue
			let child = children.get(change.target)
			if (!child) {
				let previous = replica.register(change.target, "document")
				child = { previous: previous?.value ?? "", winner: previous }
				children.set(change.target, child)
			}
			if (
				change.kind === "set" &&
				change.field === "document" &&
				(!child.winner || change.id > child.winner.id)
			)
				child.winner = change
		}
		for (let child of children.values()) {
			if (
				(child.previous && child.previous !== action.document) ||
				child.winner?.value !== action.document
			)
				throw new Error("A document action cannot mutate another document")
		}
		return changes
	}).pipe(Effect.tap(() => requiredBlobChunks(action)))
}

export function undoAction(
	replica: Replica,
	action: PreparedAction | CommittedAction,
	actor = replica.actor,
) {
	return buildAction(
		replica,
		action.document,
		("Undo " + action.label).slice(0, 256),
		staged => compensatingChanges(replica, action, staged),
		actor,
	).pipe(Effect.map(undo => ({ ...undo, undoOf: action.id })))
}

export function restoreSnapshot(
	snapshot: DocumentSnapshot,
	actor: string,
	cooperative = false,
) {
	return Effect.gen(function* () {
		let value = yield* attempt(() => JSON.parse(snapshot.state))
		let replica = yield* Replica.fromCheckpointEffect(
			value,
			actor,
			"Writer",
			cooperative,
		).pipe(
			Effect.mapError(
				cause => new DocumentConflict({ message: cause.message }),
			),
		)
		yield* attempt(() => {
			for (let target of replica.targetIds())
				if (
					target !== snapshot.document &&
					replica.fields(target).document !== snapshot.document
				)
					throw new Error("Snapshot contains another document")
		})
		return replica
	})
}

export function admitClocks(
	frontier: number,
	changes: ReadonlyArray<Operation>,
) {
	for (let [index, change] of changes.entries())
		if (change.clock > frontier + index + 1)
			throw new Error("Operation clock exceeds the document frontier")
	return changes.reduce(
		(clock, change) => Math.max(clock, change.clock),
		frontier,
	)
}

export function validateActionIdentity(action: DocumentAction) {
	return attempt(() => actionOperations(action))
}

function actionOperations(
	action: Pick<DocumentAction, "id" | "actor" | "changes">,
) {
	let changes = action.changes.map(parseOperation)
	if (
		changes.at(-1)?.id !== action.id ||
		changes.some(change => change.actor !== action.actor) ||
		new Set(changes.map(change => change.id)).size !== changes.length
	)
		throw new Error("Action identity must match its operations")
	return changes
}

export function prepareAction(
	replica: Replica,
	proposal: DocumentAction,
	subject: string,
) {
	return validateAction(replica, proposal).pipe(
		Effect.flatMap(changes =>
			attempt(() =>
				Schema.decodeUnknownSync(PreparedActionSchema)({
					...proposal,
					subject,
					...actionProvenance(replica, changes, proposal.document),
				}),
			),
		),
	)
}

function actionProvenance(
	replica: Replica,
	changes: ReadonlyArray<Operation>,
	document: string,
) {
	return {
		retained: retainedRegisters(replica, changes, document),
		before: changes
			.filter(change => change.kind === "set")
			.map(change => ({
				target: change.target,
				field: change.field,
				value: replica.fields(change.target)[change.field] ?? "",
				...(replica.contributor(change.target, change.field)
					? { contributor: replica.contributor(change.target, change.field) }
					: {}),
			})),
	}
}

export function committedAction(
	replica: Replica,
	proposal: DocumentAction,
	subject: string,
	original?: CommittedAction,
	frontier = replica.clock,
) {
	return Effect.gen(function* () {
		yield* attempt(() =>
			Schema.decodeUnknownSync(DocumentActionSchema)(proposal),
		)
		for (let guard of proposal.guards)
			if ((yield* targetState(replica, guard.target)) !== guard.state)
				return yield* Effect.fail(
					new UndoUnavailable({
						reason: "Stale",
						message: "Document changed while undo was pending",
					}),
				)
		if (proposal.undoOf) {
			if (
				!original ||
				original.id !== proposal.undoOf ||
				original.document !== proposal.document
			)
				return yield* Effect.fail(
					new DocumentConflict({
						message: "Undo must reference a committed action in this document",
					}),
				)
			let expected = yield* undoAction(replica, original, proposal.actor)
			if (semanticChanges(proposal) !== semanticChanges(expected))
				return yield* Effect.fail(
					new UndoUnavailable({
						reason: "Stale",
						message:
							"Document changed while undo was pending; derive a new compensation",
					}),
				)
		}
		return yield* attempt(() => {
			let changes = proposal.changes.map(parseOperation)
			admitClocks(frontier, changes)
			for (let change of changes) {
				if (change.restores && !proposal.undoOf)
					throw new Error("Register restoration requires undoOf")
				if (change.kind === "cancel" && !proposal.undoOf)
					throw new Error("Cancellation requires undoOf")
				if (
					change.kind === "text" &&
					change.clock <= replica.textMigrationFloor(change.target)
				)
					throw new Error("New text actions must exceed the migration floor")
				if (
					proposal.undoOf &&
					change.kind === "set" &&
					change.id <= (replica.register(change.target, change.field)?.id ?? "")
				)
					throw new UndoUnavailable({
						reason: "Stale",
						message: "A compensation must advance its register",
					})
				if (
					change.target === proposal.document &&
					change.field === "document" &&
					change.value
				)
					throw new Error("A document root cannot become a child record")
			}
			return Schema.decodeUnknownSync(CommittedActionSchema)({
				...proposal,
				subject,
				...actionProvenance(replica, changes, proposal.document),
			})
		})
	})
}

function compensatingChanges(
	replica: Replica,
	action: PreparedAction | CommittedAction,
	staged: Replica,
) {
	if (
		action.before.some(
			field =>
				field.target === action.document &&
				field.field === "type" &&
				!field.value,
		)
	)
		throw new UndoUnavailable({
			reason: "BirthRoot",
			message: "Undoing document creation requires document deletion",
		})
	let changes: Operation[] = []
	for (let change of [...action.changes].reverse()) {
		if (
			change.kind === "set" ||
			(change.kind === "text" && !change.insert.length && !change.remove.length)
		)
			continue
		if (
			!replica.hasTextOperation(change.target, change.id) ||
			change.clock <= replica.textMigrationFloor(change.target)
		)
			throw new UndoUnavailable({
				reason: "BelowFloor",
				message:
					"This action lacks retained text provenance; undo is unavailable",
			})
		if (staged.canCancel(change.target, change.id))
			changes.push(staged.cancel(change.target, change.id))
	}
	let inverse = registerCompensations(replica, action)
	let protectedTargets = protectedRecords(
		replica,
		action,
		inverse,
		staged.text(action.document),
	)
	for (let field of inverse) {
		if (!protectedTargets.has(field.target))
			changes.push(
				staged.set(field.target, field.field, field.value, field.restores),
			)
	}
	if (!changes.length)
		throw new UndoUnavailable({
			reason: "Exhausted",
			message: "No contribution from this action remains eligible for undo",
		})
	return changes
}
function registerCompensations(
	replica: Replica,
	action: PreparedAction | CommittedAction,
) {
	let before = new Map(action.before.map(field => [fieldKey(field), field]))
	let inverse = new Map<
		string,
		{ target: string; field: string; value: string; restores?: string }
	>()
	let permissionAction = action.changes.every(
		change =>
			change.kind === "set" &&
			change.target === action.document &&
			change.field.startsWith("access:"),
	)
	for (let change of action.changes) {
		if (
			change.kind !== "set" ||
			change.field === "document" ||
			(!permissionAction && change.field.startsWith("access:"))
		)
			continue
		if (
			change.target === action.document &&
			(change.field === "metadata" ||
				sourceMetadataFields.includes(change.field))
		)
			continue
		let protectedField =
			change.field === "type" || change.field.startsWith("access:")
		let current = protectedField
			? replica.register(change.target, change.field)?.id
			: replica.contributor(change.target, change.field)
		let contribution = protectedField
			? change.id
			: (change.restores ?? change.id)
		if (current !== contribution) continue
		let previous = before.get(fieldKey(change))
		if (previous === undefined)
			throw new Error("The accepted action lacks a register before-image")
		inverse.set(fieldKey(change), {
			target: change.target,
			field: change.field,
			value:
				change.field === "type" && !previous.value ? "deleted" : previous.value,
			...(!protectedField && previous.contributor
				? { restores: previous.contributor }
				: {}),
		})
	}
	return [...inverse.values()].reverse()
}
function protectedRecords(
	replica: Replica,
	action: PreparedAction | CommittedAction,
	inverse: ReadonlyArray<typeof FieldSchema.Type>,
	source: string,
) {
	let own = new Set(action.changes.map(change => change.id))
	let retained = new Map(
		action.retained?.map(field => [fieldKey(field), field.id]),
	)
	let restoredTargets = new Set(
		action.before
			.filter(field => field.field === "type" && field.value === "deleted")
			.map(field => field.target),
	)
	let references = assetReferences(source)
	let protectedTargets = new Set<string>()
	let removableTargets = new Set(
		action.before
			.filter(
				field =>
					field.field === "type" && (!field.value || field.value === "deleted"),
			)
			.map(field => field.target),
	)
	for (let field of inverse) {
		if (field.field !== "type" || field.value !== "deleted") continue
		removableTargets.add(field.target)
	}
	for (let target of removableTargets) {
		if (target === action.document)
			throw new UndoUnavailable({
				reason: "BirthRoot",
				message: "Undoing document creation requires document deletion",
			})
		if (!own.has(replica.register(target, "type")?.id ?? "")) {
			protectedTargets.add(target)
			continue
		}
		if (
			restoredTargets.has(target) &&
			!action.retained?.some(field => field.target === target)
		)
			throw new UndoUnavailable({
				reason: "BelowFloor",
				message:
					"This restoration lacks retained record provenance; undo is unavailable",
			})
		if (
			references.has(target) ||
			Object.keys(replica.fields(target)).some(
				name =>
					name !== "document" &&
					!own.has(replica.register(target, name)?.id ?? "") &&
					(!restoredTargets.has(target) ||
						retained.get(fieldKey({ target, field: name })) !==
							replica.register(target, name)?.id),
			)
		)
			protectedTargets.add(target)
	}
	return protectedTargets
}

function retainedRegisters(
	replica: Replica,
	changes: readonly Operation[],
	document: string,
) {
	let restored = new Set(
		changes
			.filter(
				change =>
					change.kind === "set" &&
					change.target !== document &&
					change.field === "type" &&
					change.value &&
					change.value !== "deleted" &&
					replica.fields(change.target).type === "deleted",
			)
			.map(change => change.target),
	)
	return [...restored].flatMap(target =>
		Object.keys(replica.fields(target)).flatMap(field => {
			let previous = replica.register(target, field)
			return previous ? [{ target, field, id: previous.id }] : []
		}),
	)
}

function fieldKey(field: { readonly target: string; readonly field: string }) {
	return JSON.stringify([field.target, field.field])
}
function semanticChanges(action: DocumentAction) {
	return JSON.stringify(
		action.changes
			.map(change =>
				JSON.stringify([
					change.kind,
					change.target,
					change.field,
					change.value,
					change.restores ?? "",
					change.insert,
					change.remove,
				]),
			)
			.sort(),
	)
}

function targetState(replica: Replica, target: string) {
	return Crypto.Crypto.pipe(
		Effect.flatMap(crypto =>
			crypto.digest(
				"SHA-256",
				new TextEncoder().encode(replica.revision(target)),
			),
		),
		Effect.map(encode),
		Effect.mapError(
			() => new DocumentConflict({ message: "Could not verify undo state" }),
		),
	)
}
function attempt<A>(work: () => A) {
	return Effect.try({
		try: work,
		catch: cause =>
			cause instanceof UndoUnavailable
				? cause
				: new DocumentConflict({
						message: cause instanceof Error ? cause.message : String(cause),
					}),
	})
}
