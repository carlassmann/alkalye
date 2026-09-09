export {
	parsePortableAssetFence,
	resolvePortableAssetReferences,
	serializePortableAssetFence,
	type PortableAsset,
	type PortableAssetError,
}

type PortableAsset = {
	path: string
	mimeType: string
	dataUrl: string
	byteLength: number
}

type PortableAssetError = {
	message: string
}

type PortableAssetFence =
	| { type: "not-asset" }
	| { type: "error"; error: PortableAssetError }
	| { type: "asset"; asset: PortableAsset }

let allowedMimeTypes = new Set([
	"font/woff2",
	"font/woff",
	"font/ttf",
	"font/otf",
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
	"image/svg+xml",
])
let maxAssetBytes = 2_000_000
let assetPathPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/
let assetReferencePattern = /asset:([A-Za-z0-9][A-Za-z0-9._/-]*)/g

function parsePortableAssetFence(
	info: string,
	payload: string,
): PortableAssetFence {
	if (!info.startsWith("base64 asset")) return { type: "not-asset" }

	let header = info.match(/^base64 asset (\S+) (\S+)$/)
	if (!header) {
		return {
			type: "error",
			error: { message: "Asset fence needs a path and MIME type" },
		}
	}

	let path = header[1]
	let mimeType = header[2]
	if (!isValidAssetPath(path)) {
		return {
			type: "error",
			error: { message: `Invalid asset path: ${path}` },
		}
	}
	if (!allowedMimeTypes.has(mimeType)) {
		return {
			type: "error",
			error: { message: `Unsupported asset MIME type: ${mimeType}` },
		}
	}

	let base64 = payload.replace(/\s/g, "")
	if (!base64) {
		return { type: "error", error: { message: `Invalid base64 for ${path}` } }
	}
	let byteLength = getBase64ByteLength(base64)
	if (byteLength > maxAssetBytes) {
		return {
			type: "error",
			error: { message: `Asset ${path} exceeds 2 MB` },
		}
	}
	if (!isValidBase64(base64)) {
		return { type: "error", error: { message: `Invalid base64 for ${path}` } }
	}
	if (mimeType === "image/svg+xml" && !isSafeSvg(base64)) {
		return { type: "error", error: { message: `Unsafe SVG asset: ${path}` } }
	}

	return {
		type: "asset",
		asset: {
			path,
			mimeType,
			dataUrl: `data:${mimeType};base64,${base64}`,
			byteLength,
		},
	}
}

function resolvePortableAssetReferences(
	value: string,
	assets: Map<string, PortableAsset>,
): { value: string; missingPaths: string[] } {
	let missingPaths = new Set<string>()
	let resolved = value.replace(
		assetReferencePattern,
		(reference, path: string) => {
			let asset = assets.get(path)
			if (!asset) {
				missingPaths.add(path)
				return reference
			}
			return asset.dataUrl
		},
	)
	return { value: resolved, missingPaths: [...missingPaths] }
}

function serializePortableAssetFence(params: {
	path: string
	mimeType: string
	base64: string
}): string {
	let base64 = params.base64.replace(/\s/g, "")
	let lines = base64.match(/.{1,76}/g)?.join("\n") ?? ""
	return `\`\`\`base64 asset ${params.path} ${params.mimeType}\n${lines}\n\`\`\``
}

function isValidAssetPath(path: string): boolean {
	return (
		assetPathPattern.test(path) &&
		!path.startsWith("/") &&
		!path.split("/").includes("..")
	)
}

function isValidBase64(value: string): boolean {
	if (
		!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
			value,
		)
	)
		return false
	try {
		return btoa(atob(value)) === value
	} catch {
		return false
	}
}

function getBase64ByteLength(base64: string): number {
	let padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0
	return (base64.length / 4) * 3 - padding
}

function isSafeSvg(base64: string): boolean {
	let svg: string
	try {
		let bytes = Uint8Array.from(atob(base64), character =>
			character.charCodeAt(0),
		)
		svg = new TextDecoder().decode(bytes)
	} catch {
		return false
	}
	return (
		/^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(svg) &&
		!/<\s*(?:[\w-]+:)?(?:script|foreignObject|iframe|object|embed|style)\b/i.test(
			svg,
		) &&
		!/\son[a-z]+\s*=/i.test(svg) &&
		!/(?:href|xlink:href)\s*=\s*["']?\s*(?:javascript:|data:)/i.test(svg) &&
		!/<!(?:doctype|entity)\b/i.test(svg)
	)
}
