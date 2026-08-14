import { co } from "jazz-tools"
import {
	Document,
	Space,
	Theme,
	Settings,
	UserAccount,
	UserRoot,
} from "@/schema"
import { isWelcomeDoc } from "@/app/features/documents/lib/welcome-doc"
import { collectCandidates, type PointerCandidate } from "./edit-history"
import {
	logInspectReport,
	ROOT_LIST_KEYS,
	INSPECTED_ROOT_KEYS,
	type InspectResult,
	type InspectedRootKey,
	type ListCandidateReport,
	type RootCandidateReport,
	type DocumentsSummary,
	type SpacesSummary,
} from "./inspect-report"

export {
	inspectRecovery,
	recoverAccount,
	type InspectResult,
	type RecoverOptions,
	type RecoverOutcome,
}

let DocumentList = co.list(Document)
let SpaceList = co.list(Space)
let ThemeList = co.list(Theme)

type RecoverOptions = {
	rootId?: string
	documents?: string
	inactiveDocuments?: string
	spaces?: string
	themes?: string
	settings?: string
	/** Required to execute the automatic (no explicit IDs) recovery plan. */
	confirm?: boolean
	/** Bypass history checks: unknown IDs and older-than-newest candidates. */
	force?: boolean
}

type RecoverOutcome = "recovered" | "planned" | "refused" | "noop"

async function inspectRecovery(
	account = UserAccount.getMe(),
): Promise<InspectResult> {
	let currentRootId = account.$jazz.raw.get("root")
	let currentRootIdString =
		typeof currentRootId === "string" ? currentRootId : undefined

	let rootCandidateEntries = collectCandidates(
		account.$jazz.raw.editsAt("root"),
	)
	let rootCandidates = await Promise.all(
		rootCandidateEntries.map(entry =>
			describeRootCandidate(entry, currentRootIdString),
		),
	)

	let currentRootLists: InspectResult["currentRootLists"] = {}
	let currentRoot =
		currentRootIdString === undefined
			? undefined
			: await UserRoot.load(currentRootIdString)

	if (currentRoot?.$isLoaded) {
		for (let key of INSPECTED_ROOT_KEYS) {
			let entries = collectCandidates(currentRoot.$jazz.raw.editsAt(key))
			if (entries.length === 0) continue
			let currentListId = currentRoot.$jazz.raw.get(key)
			let currentListIdString =
				typeof currentListId === "string" ? currentListId : undefined
			currentRootLists[key] = await Promise.all(
				entries.map(entry =>
					describeListCandidate(key, entry, currentListIdString),
				),
			)
		}
	}

	logInspectReport({
		currentRootId: currentRootIdString,
		rootCandidates,
		currentRootLists,
	})

	return {
		currentRootId: currentRootIdString,
		rootCandidates,
		currentRootLists,
	}
}

async function recoverAccount(
	options: RecoverOptions = {},
): Promise<RecoverOutcome> {
	let account = await UserAccount.getMe().$jazz.ensureLoaded({
		resolve: { root: true },
	})

	let hasListOptions = INSPECTED_ROOT_KEYS.some(
		key => options[key] !== undefined,
	)

	if (options.rootId) {
		return recoverRootPointer(account, options.rootId, options.force ?? false)
	}

	if (hasListOptions) {
		return recoverListPointers(account, options)
	}

	let plan = buildAutoPlan(account)
	if (plan.kind === "none") {
		console.info(
			"[recovery] Nothing to recover: no unambiguous previous pointer found. " +
				"Run alkalyeRecovery.inspect() and pass explicit IDs if you disagree.",
		)
		return "noop"
	}

	if (!options.confirm) {
		if (plan.kind === "root") {
			console.warn(
				`[recovery] PLAN (not executed): restore account.root to ${plan.rootId}. ` +
					"Re-run recover({ confirm: true }) to execute (the plan is recomputed " +
					"at execution time), or pass an explicit rootId.",
			)
		} else {
			console.warn(
				"[recovery] PLAN (not executed): restore list pointers",
				plan.lists,
				"Re-run recover({ confirm: true }) to execute (the plan is recomputed " +
					"at execution time), or pass explicit IDs.",
			)
		}
		return "planned"
	}

	if (plan.kind === "root") {
		console.info(`[recovery] Executing confirmed plan: root -> ${plan.rootId}`)
		return recoverRootPointer(account, plan.rootId, false)
	}
	console.info("[recovery] Executing confirmed plan:", plan.lists)
	return recoverListPointers(account, { ...plan.lists })
}

// --- pointer history -------------------------------------------------------

type PointerHistory = {
	currentId: string | undefined
	candidates: PointerCandidate[]
	// Values whose first write predates the current value's first write.
	// After a recovery flips a pointer back, the damaged value re-appears as
	// the LAST edit but its first write is newer than the restored value's,
	// so it is never offered again - a second bare recover() cannot flip back.
	previousCandidates: PointerCandidate[]
	newestPreviousId: string | undefined
}

function readPointerHistory(
	edits: Iterable<{ value?: unknown; at?: Date; by?: unknown }>,
	currentId: string | undefined,
): PointerHistory {
	let candidates = collectCandidates(edits)
	let currentIndex = candidates.findIndex(c => c.id === currentId)
	let previousCandidates =
		currentIndex === -1 ? [] : candidates.slice(0, currentIndex)
	return {
		currentId,
		candidates,
		previousCandidates,
		newestPreviousId: previousCandidates.at(-1)?.id,
	}
}

type TargetValidation =
	| { ok: true }
	| { ok: true; alreadyCurrent: true }
	| { ok: false; reason: string }

function validateTarget(
	history: PointerHistory,
	requestedId: string,
	force: boolean,
): TargetValidation {
	if (requestedId === history.currentId)
		return { ok: true, alreadyCurrent: true }
	if (force) return { ok: true }

	let inHistory = history.candidates.some(c => c.id === requestedId)
	if (!inHistory) {
		return {
			ok: false,
			reason: `${requestedId} never appeared in this pointer's edit history. Pass { force: true } to override.`,
		}
	}

	let isPrevious = history.previousCandidates.some(c => c.id === requestedId)
	if (!isPrevious) {
		return {
			ok: false,
			reason: `${requestedId} was written AFTER the current value first appeared - restoring it would re-apply the damage. Pass { force: true } to override.`,
		}
	}

	if (requestedId !== history.newestPreviousId) {
		return {
			ok: false,
			reason: `${requestedId} is older than the newest previous candidate (${history.newestPreviousId}). Restoring it can resurrect deleted documents. Pass { force: true } to override.`,
		}
	}

	return { ok: true }
}

function rootPointerHistory(
	account: co.loaded<typeof UserAccount>,
): PointerHistory {
	let currentRootId = account.$jazz.raw.get("root")
	return readPointerHistory(
		account.$jazz.raw.editsAt("root"),
		typeof currentRootId === "string" ? currentRootId : undefined,
	)
}

function rootKeyHistory(
	root: co.loaded<typeof UserRoot>,
	key: InspectedRootKey,
): PointerHistory {
	let currentId = root.$jazz.raw.get(key)
	return readPointerHistory(
		root.$jazz.raw.editsAt(key),
		typeof currentId === "string" ? currentId : undefined,
	)
}

// --- automatic plan --------------------------------------------------------

type AutoPlan =
	| { kind: "root"; rootId: string }
	| { kind: "lists"; lists: RecoverOptions }
	| { kind: "none" }

function buildAutoPlan(account: co.loaded<typeof UserAccount>): AutoPlan {
	let rootHistory = rootPointerHistory(account)
	if (rootHistory.previousCandidates.length === 1) {
		return { kind: "root", rootId: rootHistory.previousCandidates[0].id }
	}
	if (rootHistory.previousCandidates.length > 1) return { kind: "none" }

	let root = account.root
	if (!root?.$isLoaded) return { kind: "none" }

	let lists: RecoverOptions = {}
	let foundList = false
	for (let key of ROOT_LIST_KEYS) {
		let history = rootKeyHistory(root, key)
		if (history.previousCandidates.length === 1) {
			lists[key] = history.previousCandidates[0].id
			foundList = true
		}
	}

	return foundList ? { kind: "lists", lists } : { kind: "none" }
}

// --- root pointer recovery -------------------------------------------------

async function recoverRootPointer(
	account: co.loaded<typeof UserAccount>,
	rootId: string,
	force: boolean,
): Promise<RecoverOutcome> {
	let history = rootPointerHistory(account)
	let validation = validateTarget(history, rootId, force)
	if (!validation.ok) {
		console.error(`[recovery] Refused: ${validation.reason}`)
		return "refused"
	}
	if ("alreadyCurrent" in validation) {
		console.info(`[recovery] account.root already points at ${rootId}.`)
		return "noop"
	}

	let restoredRoot = await loadRootDeep(rootId)
	if (!restoredRoot?.$isLoaded) {
		console.error(`[recovery] Could not load target root ${rootId}. Aborting.`)
		return "refused"
	}

	let currentRoot =
		history.currentId === undefined
			? null
			: await loadRootDeep(history.currentId)

	let before = describeRootCounts(restoredRoot)

	if (currentRoot?.$isLoaded) {
		mergeRootLists(restoredRoot, currentRoot)
		carryOverRootFields(restoredRoot, currentRoot)
	} else {
		pruneResurrectedDocuments(
			restoredRoot,
			collectRetiredDocIds([restoredRoot]),
		)
	}

	account.$jazz.set("root", restoredRoot)

	let after = describeRootCounts(restoredRoot)
	console.info("[recovery] Root pointer restored to", rootId)
	console.info("[recovery] Restored-root contents before merge:", before)
	console.info("[recovery] Restored-root contents after merge:", after)
	return "recovered"
}

// --- list pointer recovery -------------------------------------------------

async function recoverListPointers(
	account: co.loaded<typeof UserAccount>,
	options: RecoverOptions,
): Promise<RecoverOutcome> {
	let currentRootId = account.$jazz.raw.get("root")
	if (typeof currentRootId !== "string") {
		console.error("[recovery] No current root to restore lists onto. Aborting.")
		return "refused"
	}
	let root = await loadRootDeep(currentRootId)
	if (!root?.$isLoaded) {
		console.error(`[recovery] Could not load current root ${currentRootId}.`)
		return "refused"
	}

	let force = options.force ?? false
	let requested: [InspectedRootKey, string][] = []
	for (let key of INSPECTED_ROOT_KEYS) {
		let id = options[key]
		if (id) requested.push([key, id])
	}

	let toRestore: [InspectedRootKey, string][] = []
	for (let [key, id] of requested) {
		let validation = validateTarget(rootKeyHistory(root, key), id, force)
		if (!validation.ok) {
			console.error(`[recovery] Refused ("${key}"): ${validation.reason}`)
			return "refused"
		}
		if ("alreadyCurrent" in validation) {
			console.info(`[recovery] "${key}" already points at ${id}, skipping.`)
			continue
		}
		toRestore.push([key, id])
	}

	if (toRestore.length === 0) {
		console.info("[recovery] All requested pointers already current.")
		return "noop"
	}

	// Load every target before mutating anything, so a failed load cannot
	// leave the account with partial writes and a false success.
	let targets: RestoreTarget[] = []
	for (let [key, id] of toRestore) {
		let target = await loadRestoreTarget(key, id)
		if (!target) {
			console.error(
				`[recovery] Could not load "${key}" target ${id}. Nothing was changed.`,
			)
			return "refused"
		}
		targets.push(target)
	}

	// "documents" applies before "inactiveDocuments" and computes its retired
	// set against pre-restore state - safe because pruned docs are rescued into
	// the CURRENT inactive list, which a subsequent inactiveDocuments restore
	// merges forward.
	for (let target of targets) {
		applyRestoreTarget(root, target)
	}

	console.info("[recovery] List recovery complete:", describeRootCounts(root))
	return "recovered"
}

type RestoreTarget =
	| {
			key: "documents" | "inactiveDocuments"
			id: string
			list: LoadedDocumentList
	  }
	| { key: "spaces"; id: string; list: LoadedSpaceList }
	| { key: "themes"; id: string; list: LoadedThemeList }
	| { key: "settings"; id: string; settings: co.loaded<typeof Settings> }

async function loadRestoreTarget(
	key: InspectedRootKey,
	id: string,
): Promise<RestoreTarget | null> {
	if (key === "documents" || key === "inactiveDocuments") {
		let list = await DocumentList.load(id, {
			resolve: { $each: { content: true } },
		})
		return list?.$isLoaded ? { key, id, list } : null
	}
	if (key === "spaces") {
		let list = await SpaceList.load(id, { resolve: { $each: true } })
		return list?.$isLoaded ? { key, id, list } : null
	}
	if (key === "themes") {
		let list = await ThemeList.load(id, { resolve: { $each: true } })
		return list?.$isLoaded ? { key, id, list } : null
	}
	let settings = await Settings.load(id)
	return settings?.$isLoaded ? { key, id, settings } : null
}

function applyRestoreTarget(root: LoadedRoot, target: RestoreTarget): void {
	if (target.key === "settings") {
		// Unlike the root path's carryOverRootFields, an explicit settings ID
		// replaces the pointer outright - intentional asymmetry.
		root.$jazz.set("settings", target.settings)
		console.info("[recovery] settings pointer restored to", target.id)
	} else if (target.key === "spaces") {
		if (root.spaces) {
			let added = addMissingItems(target.list, root.spaces)
			console.info(`[recovery] merged ${added} space(s) into restored list`)
		}
		root.$jazz.set("spaces", target.list)
		console.info(
			`[recovery] spaces pointer restored to ${target.list.$jazz.id} (${target.list.length} spaces)`,
		)
	} else if (target.key === "themes") {
		if (root.themes) {
			let added = addMissingItems(target.list, root.themes)
			console.info(`[recovery] merged ${added} theme(s) into restored list`)
		}
		root.$jazz.set("themes", target.list)
		console.info(
			`[recovery] themes pointer restored to ${target.list.$jazz.id}`,
		)
	} else {
		applyDocumentList(root, target.key, target.list)
	}
}

// --- loading ---------------------------------------------------------------

let ROOT_RESOLVE = {
	documents: { $each: { content: true } },
	inactiveDocuments: { $each: { content: true } },
	spaces: { $each: true },
	themes: { $each: true },
	settings: true,
} as const

type LoadedRoot = co.loaded<typeof UserRoot, typeof ROOT_RESOLVE>

async function loadRootDeep(id: string) {
	return UserRoot.load(id, { resolve: ROOT_RESOLVE })
}

type LoadedDocumentList = co.loaded<
	typeof DocumentList,
	{ $each: { content: true } }
>
type LoadedSpaceList = co.loaded<typeof SpaceList, { $each: true }>
type LoadedThemeList = co.loaded<typeof ThemeList, { $each: true }>

// --- merging ---------------------------------------------------------------

function mergeRootLists(restored: LoadedRoot, current: LoadedRoot): void {
	let retiredDocIds = collectRetiredDocIds([restored, current])

	if (current.inactiveDocuments) {
		let target = ensureList(
			restored.inactiveDocuments,
			() => DocumentList.create([], restored.$jazz.owner),
			list => restored.$jazz.set("inactiveDocuments", list),
		)
		let added = addMissingDocuments(target, current.inactiveDocuments)
		console.info(`[recovery] merged ${added} inactive document(s)`)
	}

	let addedDocs = addMissingDocuments(
		restored.documents,
		current.documents,
		retiredDocIds,
	)
	console.info(`[recovery] merged ${addedDocs} document(s) from current root`)

	pruneResurrectedDocuments(restored, retiredDocIds)

	if (current.spaces) {
		let target = ensureList(
			restored.spaces,
			() => SpaceList.create([], restored.$jazz.owner),
			list => restored.$jazz.set("spaces", list),
		)
		let added = addMissingItems(target, current.spaces)
		console.info(`[recovery] merged ${added} space(s)`)
	}

	if (current.themes) {
		let target = ensureList(
			restored.themes,
			() => ThemeList.create([], restored.$jazz.owner),
			list => restored.$jazz.set("themes", list),
		)
		let added = addMissingItems(target, current.themes)
		console.info(`[recovery] merged ${added} theme(s)`)
	}
}

function ensureList<T>(
	existing: T | undefined,
	create: () => T,
	assign: (list: T) => void,
): T {
	if (existing) return existing
	let created = create()
	assign(created)
	return created
}

// Restored-root values deliberately win over post-incident edits: the
// restored root carries the user's long-lived preferences, while the current
// root only existed since the incident - its scalars are migration defaults
// or throwaway state, so they merely fill gaps.
function carryOverRootFields(restored: LoadedRoot, current: LoadedRoot): void {
	if (!restored.$jazz.has("settings") && current.settings) {
		restored.$jazz.set("settings", current.settings)
		console.info("[recovery] carried over settings from current root")
	}
	for (let field of CARRIED_ROOT_SCALARS) {
		if (restored[field] === undefined && current[field] !== undefined) {
			restored.$jazz.set(field, current[field])
		}
	}
}

// Migration version describes a root's physical history and cannot be inherited.
let CARRIED_ROOT_SCALARS = [
	"language",
	"lastOpenedDocId",
	"lastOpenedSpaceId",
] as const

// Docs that are deleted (deletedAt) or already moved to an inactive list must
// never (re-)appear as active documents - restoring an old list would
// otherwise resurrect them.
function collectRetiredDocIds(
	roots: (LoadedRoot | null | undefined)[],
): Set<string> {
	let retired = new Set<string>()
	for (let root of roots) {
		if (!root?.$isLoaded) continue
		for (let doc of root.inactiveDocuments ?? []) {
			if (doc?.$isLoaded) retired.add(doc.$jazz.id)
		}
		for (let doc of Array.from(root.documents)) {
			if (doc?.$isLoaded && doc.deletedAt) retired.add(doc.$jazz.id)
		}
	}
	return retired
}

function pruneResurrectedDocuments(
	root: LoadedRoot,
	retiredDocIds: Set<string>,
): void {
	let documents = root.documents
	if (!documents) return

	let pruned = 0
	for (let index = documents.length - 1; index >= 0; index--) {
		let doc = documents[index]
		if (!doc?.$isLoaded) continue
		let retired = retiredDocIds.has(doc.$jazz.id) || doc.deletedAt !== undefined
		if (!retired) continue
		documents.$jazz.splice(index, 1)
		rescueIntoInactive(root, doc)
		pruned++
	}
	if (pruned > 0) {
		console.info(
			`[recovery] moved ${pruned} deleted document(s) out of the active list`,
		)
	}
}

function rescueIntoInactive(
	root: LoadedRoot,
	doc: co.loaded<typeof Document, { content: true }>,
): void {
	let inactive = root.inactiveDocuments
	if (!inactive) {
		inactive = DocumentList.create([], root.$jazz.owner)
		root.$jazz.set("inactiveDocuments", inactive)
	}
	if (!inactive.some(entry => entry?.$jazz.id === doc.$jazz.id)) {
		inactive.$jazz.push(doc)
	}
}

function applyDocumentList(
	root: LoadedRoot,
	key: "documents" | "inactiveDocuments",
	restoredList: LoadedDocumentList,
): void {
	let retiredDocIds = collectRetiredDocIds([root])
	let currentList =
		key === "documents" ? root.documents : root.inactiveDocuments
	if (currentList) {
		let excluded = key === "documents" ? retiredDocIds : undefined
		let added = addMissingDocuments(restoredList, currentList, excluded)
		console.info(`[recovery] merged ${added} document(s) into restored ${key}`)
	}

	root.$jazz.set(key, restoredList)
	if (key === "documents") {
		pruneResurrectedDocuments(root, retiredDocIds)
	}
	console.info(
		`[recovery] ${key} pointer restored to ${restoredList.$jazz.id} (${restoredList.length} docs)`,
	)
}

function addMissingDocuments(
	target: co.loaded<typeof DocumentList>,
	source: LoadedDocumentList,
	excludedIds?: Set<string>,
): number {
	let existing = collectIds(target)
	// Welcome docs are only skipped when the target already has one: the
	// auto-created duplicate is noise, but a welcome doc the user kept
	// writing in is real data and must survive when the target lacks one.
	let targetHasWelcome = listContainsWelcomeDoc(target)
	let added = 0
	for (let doc of source) {
		if (!doc?.$isLoaded) continue
		if (existing.has(doc.$jazz.id)) continue
		if (excludedIds?.has(doc.$jazz.id)) continue
		if (excludedIds && doc.deletedAt !== undefined) continue
		let isWelcome = isWelcomeDoc(readContent(doc))
		if (isWelcome && targetHasWelcome) continue
		target.$jazz.push(doc)
		existing.add(doc.$jazz.id)
		if (isWelcome) targetHasWelcome = true
		added++
	}
	return added
}

function listContainsWelcomeDoc(list: co.loaded<typeof DocumentList>): boolean {
	return Array.from(list).some(
		doc => Boolean(doc?.$isLoaded) && isWelcomeDoc(readContent(doc)),
	)
}

function readContent(
	doc: NonNullable<co.loaded<typeof DocumentList>[number]> | null | undefined,
): string {
	if (!doc?.$isLoaded) return ""
	let content = doc.content
	return content?.$isLoaded ? content.toString() : ""
}

function isLoadedItem<T extends { $isLoaded: boolean }>(
	item: T | null | undefined,
): item is T & { $isLoaded: true } {
	return item?.$isLoaded === true
}

// T is inferred from `source` as the full element type (loaded | not-loaded),
// but `push` is required to accept only `T & { $isLoaded: true }` - the loaded
// element - matching Jazz's real CoList.push, which never accepts a not-loaded
// value. The `isLoadedItem` guard narrows to exactly that loaded element.
function addMissingItems<
	T extends { $isLoaded: boolean; $jazz: { id: string } },
>(
	target: Iterable<
		{ $isLoaded: boolean; $jazz: { id: string } } | null | undefined
	> & { $jazz: { push: (item: T & { $isLoaded: true }) => void } },
	source: Iterable<T | null | undefined>,
): number {
	let existing = collectIds(target)
	let added = 0
	for (let item of source) {
		if (!isLoadedItem(item)) continue
		if (existing.has(item.$jazz.id)) continue
		target.$jazz.push(item)
		existing.add(item.$jazz.id)
		added++
	}
	return added
}

function collectIds(
	list: Iterable<
		{ $isLoaded: boolean; $jazz: { id: string } } | null | undefined
	>,
): Set<string> {
	let ids = new Set<string>()
	for (let item of list) {
		if (item?.$isLoaded) ids.add(item.$jazz.id)
	}
	return ids
}

// --- inspect summaries -----------------------------------------------------

async function describeRootCandidate(
	entry: PointerCandidate,
	currentRootId: string | undefined,
): Promise<RootCandidateReport> {
	let root = await loadRootDeep(entry.id)
	if (!root?.$isLoaded) {
		return {
			...entry,
			isCurrent: entry.id === currentRootId,
			loadable: false,
			documents: { count: 0, previews: [] },
			spaces: { count: 0, names: [] },
		}
	}

	return {
		...entry,
		isCurrent: entry.id === currentRootId,
		loadable: true,
		documents: summarizeDocuments(root.documents),
		spaces: summarizeSpaces(root.spaces),
	}
}

async function describeListCandidate(
	key: InspectedRootKey,
	entry: PointerCandidate,
	currentListId: string | undefined,
): Promise<ListCandidateReport> {
	let target = await loadRestoreTarget(key, entry.id)
	return {
		...entry,
		isCurrent: entry.id === currentListId,
		loadable: target !== null,
		summary: summarizeListTarget(key, target),
	}
}

function summarizeListTarget(
	key: InspectedRootKey,
	target: RestoreTarget | null,
): ListCandidateReport["summary"] {
	if (key === "spaces") {
		return target?.key === "spaces"
			? summarizeSpaces(target.list)
			: { count: 0, names: [] }
	}
	if (key === "documents" || key === "inactiveDocuments") {
		return target?.key === key
			? summarizeDocuments(target.list)
			: { count: 0, previews: [] }
	}
	if (key === "settings") return { count: target ? 1 : 0 }
	return { count: target?.key === "themes" ? target.list.length : 0 }
}

type LoadedDocument = co.loaded<typeof Document, { content: true }>
type LoadedSpace = co.loaded<typeof Space>

function summarizeDocuments(docs: LoadedDocumentList): DocumentsSummary {
	let loaded = Array.from(docs).filter((doc): doc is LoadedDocument =>
		Boolean(doc?.$isLoaded),
	)
	let previews = loaded
		.slice(0, 5)
		.map(doc => firstLine(doc.content?.toString() ?? ""))
	return { count: loaded.length, previews }
}

function summarizeSpaces(spaces: LoadedSpaceList | undefined): SpacesSummary {
	let loaded = Array.from(spaces ?? []).filter((space): space is LoadedSpace =>
		Boolean(space?.$isLoaded),
	)
	return { count: loaded.length, names: loaded.map(space => space.name) }
}

function firstLine(content: string): string {
	let line = content.split("\n").find(candidate => candidate.trim().length > 0)
	return (line ?? "(empty)").slice(0, 80)
}

function describeRootCounts(root: LoadedRoot) {
	return {
		documents: root.documents?.length ?? 0,
		inactiveDocuments: root.inactiveDocuments?.length ?? 0,
		spaces: root.spaces?.length ?? 0,
		themes: root.themes?.length ?? 0,
	}
}
