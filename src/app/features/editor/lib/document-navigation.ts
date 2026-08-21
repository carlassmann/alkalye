import { parseFrontmatter } from "./frontmatter"

export { getDocumentHeadings }
export type { DocumentHeading }

interface DocumentHeading {
	level: number
	title: string
	from: number
	line: number
}

interface Fence {
	marker: "`" | "~"
	length: number
}

function getDocumentHeadings(content: string): DocumentHeading[] {
	let { frontmatter, body } = parseFrontmatter(content)
	let contentOffset = frontmatter ? content.length - body.length : 0
	let lineOffset = frontmatter
		? content.slice(0, contentOffset).split("\n").length - 1
		: 0
	let lines = body.split("\n")
	let positions: number[] = []
	let position = contentOffset
	for (let line of lines) {
		positions.push(position)
		position += line.length + 1
	}

	let headings: DocumentHeading[] = []
	let fence: Fence | null = null
	for (let index = 0; index < lines.length; index++) {
		let line = lines[index] ?? ""
		let fenceRun = line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1]
		let marker = getFenceMarker(fenceRun)
		if (fence && marker === fence.marker) {
			let isClosingFence = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.test(line)
			if (isClosingFence && (fenceRun?.length ?? 0) >= fence.length)
				fence = null
			continue
		}
		if (fence) continue
		if (fenceRun && marker) {
			fence = { marker, length: fenceRun.length }
			continue
		}

		let atx = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/)
		if (atx) {
			headings.push({
				level: atx[1]?.length ?? 1,
				title: atx[2]?.trim() ?? "",
				from: positions[index] ?? 0,
				line: index + 1 + lineOffset,
			})
			continue
		}

		let underline = lines[index + 1]?.match(/^\s{0,3}(=+|-+)\s*$/)
		if (!line.trim() || !underline || isThematicBreak(line)) continue
		headings.push({
			level: underline[1]?.startsWith("=") ? 1 : 2,
			title: line.trim(),
			from: positions[index] ?? 0,
			line: index + 1 + lineOffset,
		})
		index++
	}
	return headings
}

function getFenceMarker(value: string | undefined): "`" | "~" | null {
	if (value?.startsWith("`")) return "`"
	if (value?.startsWith("~")) return "~"
	return null
}

function isThematicBreak(line: string): boolean {
	return /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(
		line,
	)
}
