import { array, object, string } from "./model"
export function rewrite(source: string, pairs: [string, string][]) {
	let text = source
	let stages: { start: number; end: number; size: number }[][] = []
	for (let [previous, next] of pairs) {
		if (!previous) continue
		let changes = [
			...text.matchAll(
				new RegExp(previous.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
			),
		].map(match => ({
			start: match.index,
			end: match.index + previous.length,
			size: next.length,
		}))
		stages.push(changes)
		text = text.replaceAll(previous, () => next)
	}
	return { text, offset }
	function offset(position: number) {
		for (let changes of stages) {
			let delta = 0
			for (let change of changes) {
				if (position < change.start) break
				if (position < change.end) {
					position =
						change.start + Math.min(position - change.start, change.size)
					break
				}
				delta += change.size - (change.end - change.start)
			}
			position += delta
		}
		return position
	}
}
export function assetPath(id: string, filename: string) {
	let name = encodeURIComponent(id + "-" + filename).replace(
		/[!'()*]/g,
		character => "%" + character.charCodeAt(0).toString(16).toUpperCase(),
	)
	return "assets/" + name
}
export function decodedPath(path: string) {
	try {
		return decodeURIComponent(path)
	} catch {
		return path
	}
}
let mediaTypes: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	svg: "image/svg+xml",
	gif: "image/gif",
	webp: "image/webp",
	avif: "image/avif",
	mp4: "video/mp4",
	webm: "video/webm",
	mov: "video/quicktime",
	mp3: "audio/mpeg",
	ogg: "audio/ogg",
	wav: "audio/wav",
	woff: "font/woff",
	woff2: "font/woff2",
	ttf: "font/ttf",
	otf: "font/otf",
}
export function mediaType(path: string) {
	return (
		mediaTypes[path.split(".").pop()?.toLowerCase() ?? ""] ??
		"application/octet-stream"
	)
}

export interface PortableManifest {
	documents: {
		path: string
		id?: string
		theme?: string
		drawing?: string
		drawingAsset?: string
	}[]
	themes: { path: string; name: string }[]
}
export function readPortableManifest(value: unknown): PortableManifest {
	let source = object(value)
	if (source.format !== "alkalye-portable-v1")
		throw new Error("Unsupported portable archive")
	return {
		documents: array(source.documents).map(value => {
			let document = object(value)
			return {
				path: string(document.path),
				...(document.id === undefined ? {} : { id: string(document.id) }),
				...(document.theme === undefined
					? {}
					: { theme: string(document.theme) }),
				...(document.drawingAsset === undefined
					? {}
					: { drawingAsset: string(document.drawingAsset) }),
				...(document.drawing === undefined
					? {}
					: { drawing: string(document.drawing) }),
			}
		}),
		themes: array(source.themes).map(value => {
			let theme = object(value)
			return { path: string(theme.path), name: string(theme.name) }
		}),
	}
}

export function portableComments(value: unknown): Record<string, unknown>[] {
	if (Array.isArray(value)) return value.map(object)
	let sidecar = object(value)
	if (sidecar.version !== 1) throw new Error("Unsupported comments sidecar")
	return array(sidecar.comments).map(value => {
		let comment = object(value)
		let replies = array(comment.replies ?? []).map(object)
		let first = replies[0]
		return {
			...comment,
			body: first?.body ?? "",
			author: first?.authorName ?? "",
			resolved: String(comment.resolved === true),
			selectionStart: comment.from,
			selectionEnd: comment.to,
			orphaned: comment.from === null || comment.to === null,
			...Object.fromEntries(
				replies.slice(1).map((reply, index) => {
					let time =
						typeof reply.createdAt === "string"
							? Date.parse(reply.createdAt) || 0
							: 0
					return [
						`reply:${time}:${index}`,
						JSON.stringify({
							body: string(reply.body),
							author:
								typeof reply.authorName === "string" ? reply.authorName : "",
							time,
						}),
					]
				}),
			),
		}
	})
}

export function commentSidecar(
	source: string,
	comments: Record<string, unknown>[],
) {
	let now = new Date().toISOString()
	return {
		version: 1,
		comments: comments.map(comment => {
			let from =
				typeof comment.selectionStart === "number"
					? comment.selectionStart
					: null
			let to =
				typeof comment.selectionEnd === "number" ? comment.selectionEnd : null
			let replies = []
			for (let [key, value] of Object.entries(comment)) {
				if (!key.startsWith("reply:") || typeof value !== "string") continue
				try {
					let reply = object(JSON.parse(value))
					let date =
						typeof reply.time === "number" ? new Date(reply.time) : new Date()
					replies.push({
						body: string(reply.body),
						authorName: string(reply.author ?? ""),
						createdAt: Number.isFinite(date.getTime())
							? date.toISOString()
							: now,
						updatedAt: null,
					})
				} catch {
					continue
				}
			}
			let createdAt =
				typeof comment.createdAt === "string" ? comment.createdAt : now
			return {
				id: string(comment.id),
				quote:
					from !== null && to !== null
						? source.slice(from, to)
						: string(comment.quote ?? ""),
				contextBefore:
					from !== null
						? source.slice(Math.max(0, from - 80), from)
						: string(comment.contextBefore ?? ""),
				contextAfter:
					to !== null
						? source.slice(to, to + 80)
						: string(comment.contextAfter ?? ""),
				from,
				to,
				resolved: comment.resolved === "true",
				createdAt,
				updatedAt:
					typeof comment.updatedAt === "string" ? comment.updatedAt : now,
				replies: [
					{
						body: string(comment.body ?? ""),
						authorName: string(comment.author ?? ""),
						createdAt,
						updatedAt: null,
					},
					...replies,
				],
			}
		}),
	}
}

export function importedCommentAnchor(
	original: string,
	pairs: [string, string][],
	fields: Record<string, unknown>,
) {
	let changes = rewrite(original, pairs)
	let quote = rewrite(string(fields.quote ?? ""), pairs).text
	if (!quote || fields.orphaned === true)
		return { quote, start: -1, orphaned: fields.orphaned === true }
	let expected =
		typeof fields.selectionStart === "number"
			? changes.offset(fields.selectionStart)
			: -1
	if (
		expected >= 0 &&
		changes.text.slice(expected, expected + quote.length) === quote
	)
		return { quote, start: expected, orphaned: false }
	let before = rewrite(string(fields.contextBefore ?? ""), pairs).text
	let after = rewrite(string(fields.contextAfter ?? ""), pairs).text
	let matches: number[] = []
	let contextual: number[] = []
	for (
		let start = changes.text.indexOf(quote);
		start >= 0;
		start = changes.text.indexOf(quote, start + quote.length)
	) {
		matches.push(start)
		if (
			(before || after) &&
			changes.text.slice(0, start).endsWith(before) &&
			changes.text.slice(start + quote.length).startsWith(after)
		)
			contextual.push(start)
	}
	let start =
		contextual.length === 1
			? contextual[0]
			: matches.length === 1
				? matches[0]
				: undefined
	return { quote, start: start ?? -1, orphaned: start === undefined }
}
