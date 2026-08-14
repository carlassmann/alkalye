import { co, type ResolveQuery } from "jazz-tools"
import { UserAccount } from "@/schema"
import {
	recordStartupTrace,
	type JazzCoValueLabel,
} from "@/app/lib/reload-diagnostics"

export { collectStartupDiagnosticLabels }

let diagnosticResolve = {
	profile: true,
	root: {
		documents: { $each: true },
		inactiveDocuments: { $each: true },
		spaces: { $each: { documents: { $each: true } } },
		settings: true,
		themes: true,
	},
} as const satisfies ResolveQuery<typeof UserAccount>

async function collectStartupDiagnosticLabels(): Promise<JazzCoValueLabel[]> {
	let startedAt = performance.now()
	try {
		let account = UserAccount.getMe()
		let loaded = await account.$jazz.ensureLoaded({
			resolve: diagnosticResolve,
		})
		let labels = createLabels(loaded)
		recordStartupTrace("jazz-covalue-labels", {
			labelCount: labels.length,
			durationMs: millisecondsSince(startedAt),
		})
		return labels
	} catch (error) {
		recordStartupTrace("jazz-covalue-labels:error", {
			error: error instanceof Error ? error.name : "UnknownError",
			durationMs: millisecondsSince(startedAt),
		})
		return []
	}
}

function createLabels(
	account: co.loaded<typeof UserAccount, typeof diagnosticResolve>,
): JazzCoValueLabel[] {
	let labels: JazzCoValueLabel[] = []
	let seen = new Set<string>()
	addLabel(labels, seen, account, "account")
	addLabel(labels, seen, account.profile, "account-profile")
	addLabel(labels, seen, account.root, "root")
	addLabel(labels, seen, account.root.documents, "personal-documents-list")
	addLabel(
		labels,
		seen,
		account.root.inactiveDocuments,
		"inactive-documents-list",
	)
	addLabel(labels, seen, account.root.spaces, "spaces-list")
	addLabel(labels, seen, account.root.settings, "settings")
	addLabel(labels, seen, account.root.themes, "themes-list")

	for (let [index, document] of account.root.documents.entries()) {
		addDocumentLabels(labels, seen, document, `personal-document:${index}`)
	}
	for (let [index, document] of (
		account.root.inactiveDocuments ?? []
	).entries()) {
		addDocumentLabels(labels, seen, document, `inactive-document:${index}`)
	}
	for (let [spaceIndex, space] of (account.root.spaces ?? []).entries()) {
		addLabel(labels, seen, space, `space:${spaceIndex}`)
		if (!space?.$isLoaded) continue
		addLabel(
			labels,
			seen,
			space.documents,
			`space-documents-list:${spaceIndex}`,
		)
		for (let [documentIndex, document] of space.documents.entries()) {
			addDocumentLabels(
				labels,
				seen,
				document,
				`space-document:${spaceIndex}:${documentIndex}`,
			)
		}
	}
	return labels
}

function addDocumentLabels(
	labels: JazzCoValueLabel[],
	seen: Set<string>,
	document: unknown,
	label: string,
): void {
	addLabel(labels, seen, document, label)
	if (!isLoadedDocument(document)) return
	addLabel(labels, seen, document.content, `${label}:content`)
	addLabel(labels, seen, document.assets, `${label}:assets`)
	addLabel(labels, seen, document.comments, `${label}:comments`)
	addLabel(labels, seen, document.cursors, `${label}:cursors`)
	addLabel(labels, seen, document.$jazz.owner, `${label}:owner`)
}

function addLabel(
	labels: JazzCoValueLabel[],
	seen: Set<string>,
	value: unknown,
	label: string,
): void {
	if (!hasJazzId(value) || seen.has(value.$jazz.id)) return
	seen.add(value.$jazz.id)
	labels.push({ id: value.$jazz.id, label })
}

type LoadedDocument = {
	$isLoaded: true
	content: unknown
	assets?: unknown
	comments?: unknown
	cursors?: unknown
	$jazz: { id: string; owner: unknown }
}

function isLoadedDocument(value: unknown): value is LoadedDocument {
	return hasJazzId(value) && "$isLoaded" in value && value.$isLoaded === true
}

function hasJazzId(value: unknown): value is { $jazz: { id: string } } {
	if (typeof value !== "object" || value === null || !("$jazz" in value))
		return false
	let jazz = value.$jazz
	return (
		typeof jazz === "object" &&
		jazz !== null &&
		"id" in jazz &&
		typeof jazz.id === "string"
	)
}

function millisecondsSince(startedAt: number): number {
	return Math.round((performance.now() - startedAt) * 10) / 10
}
