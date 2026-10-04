export interface ZipEntry {
	name: string
	data: Uint8Array<ArrayBuffer>
}
export function crc32(bytes: Uint8Array) {
	let crc = 0xffffffff
	for (let byte of bytes) {
		crc ^= byte
		for (let bit = 0; bit < 8; bit++)
			crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
	}
	return (crc ^ 0xffffffff) >>> 0
}
export function zip(entries: ZipEntry[]): Uint8Array<ArrayBuffer> {
	let encoder = new TextEncoder(),
		parts: Uint8Array[] = [],
		central: Uint8Array[] = [],
		offset = 0
	for (let entry of entries) {
		let name = encoder.encode(entry.name),
			checksum = crc32(entry.data),
			header = new Uint8Array(30 + name.length),
			view = new DataView(header.buffer)
		view.setUint32(0, 0x04034b50, true)
		view.setUint16(4, 20, true)
		view.setUint16(6, 0x800, true)
		view.setUint32(14, checksum, true)
		view.setUint32(18, entry.data.length, true)
		view.setUint32(22, entry.data.length, true)
		view.setUint16(26, name.length, true)
		header.set(name, 30)
		let directory = new Uint8Array(46 + name.length),
			info = new DataView(directory.buffer)
		info.setUint32(0, 0x02014b50, true)
		info.setUint16(4, 20, true)
		info.setUint16(6, 20, true)
		info.setUint16(8, 0x800, true)
		info.setUint32(16, checksum, true)
		info.setUint32(20, entry.data.length, true)
		info.setUint32(24, entry.data.length, true)
		info.setUint16(28, name.length, true)
		info.setUint32(42, offset, true)
		directory.set(name, 46)
		parts.push(header, entry.data)
		central.push(directory)
		offset += header.length + entry.data.length
	}
	let centralSize = central.reduce((size, bytes) => size + bytes.length, 0),
		end = new Uint8Array(22),
		view = new DataView(end.buffer)
	view.setUint32(0, 0x06054b50, true)
	view.setUint16(8, entries.length, true)
	view.setUint16(10, entries.length, true)
	view.setUint32(12, centralSize, true)
	view.setUint32(16, offset, true)
	let output = new Uint8Array(offset + centralSize + end.length),
		position = 0
	for (let part of [...parts, ...central, end]) {
		output.set(part, position)
		position += part.length
	}
	return output
}
export let maximumArchiveEntries = 10_000
export let maximumArchiveBytes = 100_000_000
export async function unzip(
	bytes: Uint8Array<ArrayBuffer>,
): Promise<ZipEntry[]> {
	let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
		end = bytes.length - 22
	while (
		end >= Math.max(0, bytes.length - 65557) &&
		view.getUint32(end, true) !== 0x06054b50
	)
		end--
	if (end < 0 || view.getUint32(end, true) !== 0x06054b50)
		throw new Error("Invalid ZIP archive")
	let count = view.getUint16(end + 10, true),
		offset = view.getUint32(end + 16, true),
		entries: ZipEntry[] = [],
		names = new Set<string>(),
		total = 0
	if (count > maximumArchiveEntries) throw new Error("ZIP has too many entries")
	for (let index = 0; index < count; index++) {
		if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50)
			throw new Error("Invalid ZIP directory")
		let flags = view.getUint16(offset + 8, true),
			method = view.getUint16(offset + 10, true),
			checksum = view.getUint32(offset + 16, true),
			size = view.getUint32(offset + 20, true),
			expanded = view.getUint32(offset + 24, true),
			nameLength = view.getUint16(offset + 28, true),
			extra = view.getUint16(offset + 30, true),
			comment = view.getUint16(offset + 32, true),
			local = view.getUint32(offset + 42, true)
		let name = new TextDecoder().decode(
			bytes.slice(offset + 46, offset + 46 + nameLength),
		)
		offset += 46 + nameLength + extra + comment
		if (
			flags & 1 ||
			![0, 8].includes(method) ||
			name.startsWith("/") ||
			name.includes("\\") ||
			name.split("/").includes("..")
		)
			throw new Error("Unsupported or unsafe ZIP entry")
		if (names.has(name)) throw new Error("ZIP contains a duplicate entry")
		names.add(name)
		total += expanded
		if (total > maximumArchiveBytes)
			throw new Error("ZIP expands beyond 100 MB")
		if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50)
			throw new Error("Invalid ZIP entry header")
		let start =
			local +
			30 +
			view.getUint16(local + 26, true) +
			view.getUint16(local + 28, true)
		if (start + size > bytes.length) throw new Error("Truncated ZIP entry")
		let compressed = bytes.slice(start, start + size)
		let data = method === 8 ? await inflate(compressed, expanded) : compressed
		if (data.length !== expanded || crc32(data) !== checksum)
			throw new Error("Corrupt ZIP entry")
		if (!name.endsWith("/")) entries.push({ name, data })
	}
	return entries
}

// The central directory states each entry's size; stop reading as soon as a
// stream exceeds it, so a small compressed entry cannot expand without bound.
async function inflate(compressed: Uint8Array<ArrayBuffer>, limit: number) {
	let reader = new Blob([compressed])
		.stream()
		.pipeThrough(new DecompressionStream("deflate-raw"))
		.getReader()
	let output = new Uint8Array(limit),
		length = 0
	try {
		while (true) {
			let next = await reader.read()
			if (next.done) break
			if (length + next.value.length > limit)
				throw new Error("ZIP entry expands beyond its declared size")
			output.set(next.value, length)
			length += next.value.length
		}
	} finally {
		await reader.cancel().catch(() => undefined)
	}
	return output.slice(0, length)
}
