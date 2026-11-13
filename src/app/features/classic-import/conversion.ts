export {
	stableId,
	packBytes,
	unpackBytes,
	groupHistory,
	resolveClassicAnchor,
	rewriteReferences,
}

async function stableId(value: string) {
	let hash = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(`alkalye:classic:v1:${value}`),
	)
	let hex = Array.from(new Uint8Array(hash), byte =>
		byte.toString(16).padStart(2, "0"),
	).join("")
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
async function packBytes(data: Uint8Array<ArrayBuffer>) {
	let base64 = ""
	for (let offset = 0; offset < data.length; offset += 32768)
		base64 += String.fromCharCode(...data.subarray(offset, offset + 32768))
	return { base64: btoa(base64), sha256: await byteHash(data) }
}
async function unpackBytes(value: { base64: string; sha256: string }) {
	let data = Uint8Array.from(atob(value.base64), char => char.charCodeAt(0))
	if ((await byteHash(data)) !== value.sha256)
		throw new Error("Classic asset checksum mismatch")
	return data
}
function groupHistory<
	T extends { createdAt: Date; authorId: string; content: string },
>(versions: T[], limit = 200, maxBytes = 8 * 1024 * 1024) {
	let result: T[] = []
	for (let version of [...versions].sort(
		(a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
	)) {
		let previous = result.at(-1)
		if (previous?.content === version.content) continue
		if (
			previous &&
			previous.authorId === version.authorId &&
			version.createdAt.getTime() - previous.createdAt.getTime() < 60_000
		)
			result[result.length - 1] = version
		else result.push(version)
	}
	let bytes = 0
	return result
		.slice(-limit)
		.reverse()
		.filter(version => {
			bytes += new TextEncoder().encode(version.content).length
			return bytes <= maxBytes
		})
		.reverse()
}
function resolveClassicAnchor(
	content: string,
	anchor: { quote: string; contextBefore: string; contextAfter: string },
	start?: number,
	end?: number,
) {
	if (
		start !== undefined &&
		end !== undefined &&
		start <= end &&
		content.slice(start, end) === anchor.quote
	)
		return { start, end }
	let candidates: number[] = []
	if (!anchor.quote) return undefined
	for (
		let offset = content.indexOf(anchor.quote);
		offset !== -1;
		offset = content.indexOf(anchor.quote, offset + 1)
	) {
		if (
			content.slice(0, offset).endsWith(anchor.contextBefore) &&
			content
				.slice(offset + anchor.quote.length)
				.startsWith(anchor.contextAfter)
		)
			candidates.push(offset)
	}
	return candidates.length === 1
		? { start: candidates[0]!, end: candidates[0]! + anchor.quote.length }
		: undefined
}
async function rewriteReferences(content: string) {
	let ids = [...new Set(content.match(/co_z[1-9A-HJ-NP-Za-km-z]+/g) ?? [])]
	let replacements = new Map<string, string>()
	for (let id of ids) replacements.set(id, await stableId(id))
	content = content.replace(
		/(asset:|\[\[|\/doc\/|\/spaces\/)(co_z[1-9A-HJ-NP-Za-km-z]+)/g,
		(_match: string, prefix: string, id: string) =>
			prefix + (replacements.get(id) ?? id),
	)
	let frontmatter = content.match(/^---\r?\n[\s\S]*?\r?\n---/)
	if (frontmatter) {
		let rewritten = frontmatter[0].replace(
			/co_z[1-9A-HJ-NP-Za-km-z]+/g,
			id => replacements.get(id) ?? id,
		)
		content = rewritten + content.slice(frontmatter[0].length)
	}
	return content
}

async function byteHash(data: Uint8Array<ArrayBuffer>) {
	let hash = await crypto.subtle.digest("SHA-256", data)
	return Array.from(new Uint8Array(hash), byte =>
		byte.toString(16).padStart(2, "0"),
	).join("")
}
