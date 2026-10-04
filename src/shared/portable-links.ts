export function archiveLinkPath(path: string) {
	let parts = path.split("/")
	let name = (parts.pop() ?? "").replace(/\.(md|markdown|txt)$/i, "")
	if (parts.at(-1) === name) parts.pop()
	return [...parts, name].join("/")
}
export function wikiReplacements(
	source: string,
	resolve: (token: string) => string | undefined,
): [string, string][] {
	let replacements = new Map<string, string>()
	for (let match of source.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
		let [token = "", ...label] = (match[1] ?? "").split("|")
		let target = resolve(token.trim())
		if (target)
			replacements.set(
				match[0],
				`[[${target}${label.length ? "|" + label.join("|") : ""}]]`,
			)
	}
	return [...replacements]
}
export function relativeLinkPath(folder: string, reference: string) {
	let parts: string[] = []
	for (let part of (folder + "/" + reference).split("/")) {
		if (part === "..") parts.pop()
		else if (part && part !== ".") parts.push(part)
	}
	return parts.join("/")
}

// Targets of [[wiki links]], as written: identities or titles. Summaries keep
// them so the library can show backlinks without opening other documents.
export function wikiTargets(source: string) {
	let targets = new Set<string>()
	for (let match of source.matchAll(/\[\[([^\]\n|]+)/g)) {
		let target = (match[1] ?? "").trim()
		if (target) targets.add(target.slice(0, 200))
		if (targets.size >= 200) break
	}
	return [...targets]
}
