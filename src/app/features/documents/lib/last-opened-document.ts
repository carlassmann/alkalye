export {
	clearLastOpenedDocument,
	readLastOpenedDocument,
	writeLastOpenedDocument,
	type LastOpenedDocument,
}

type LastOpenedDocument = {
	documentId: string
	spaceId?: string
}

type StoredLastOpenedDocument = LastOpenedDocument & {
	accountId: string
}

let storageKey = "alkalye:last-opened-document"

function readLastOpenedDocument(accountId: string): LastOpenedDocument | null {
	let stored = readStoredLastOpenedDocument()
	if (!stored || stored.accountId !== accountId) return null
	return {
		documentId: stored.documentId,
		...(stored.spaceId ? { spaceId: stored.spaceId } : {}),
	}
}

function writeLastOpenedDocument(
	accountId: string,
	documentId: string,
	spaceId?: string,
): void {
	let current = readStoredLastOpenedDocument()
	if (
		current?.accountId === accountId &&
		current.documentId === documentId &&
		current.spaceId === spaceId
	)
		return

	let next: StoredLastOpenedDocument = {
		accountId,
		documentId,
		...(spaceId ? { spaceId } : {}),
	}
	try {
		window.localStorage.setItem(storageKey, JSON.stringify(next))
	} catch {
		return
	}
}

function clearLastOpenedDocument(accountId: string): void {
	let current = readStoredLastOpenedDocument()
	if (current?.accountId !== accountId) return
	try {
		window.localStorage.removeItem(storageKey)
	} catch {
		return
	}
}

function readStoredLastOpenedDocument(): StoredLastOpenedDocument | null {
	try {
		let value: unknown = JSON.parse(
			window.localStorage.getItem(storageKey) ?? "null",
		)
		if (!isRecord(value)) return null
		if (
			typeof value.accountId !== "string" ||
			typeof value.documentId !== "string"
		)
			return null
		if (value.spaceId !== undefined && typeof value.spaceId !== "string")
			return null
		return {
			accountId: value.accountId,
			documentId: value.documentId,
			...(value.spaceId ? { spaceId: value.spaceId } : {}),
		}
	} catch {
		return null
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null
}
