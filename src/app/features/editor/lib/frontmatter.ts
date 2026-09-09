import { EditorState } from "@codemirror/state"

export {
	getPath,
	getTags,
	parseFrontmatter,
	getFrontmatterRange,
	togglePinned,
	addTag,
	getBacklinks,
	getBacklinksWithRange,
	setBacklinks,
	addBacklink,
	removeBacklink,
	setTheme,
	setPreset,
	setSyntaxTheme,
}

export type { Frontmatter }

interface Frontmatter {
	title?: string
	pinned?: boolean
	tags?: string
	path?: string
	[key: string]: string | boolean | undefined
}

function parseFrontmatter(content: string): {
	frontmatter: Frontmatter | null
	body: string
} {
	let match = content.match(/^---\r?\n([\s\S]*?)(?:\r?\n)?---(?:\r?\n)?/)
	if (!match) return { frontmatter: null, body: content }

	let yaml = match[1]
	let body = content.slice(match[0].length)
	let frontmatter: Frontmatter = {}

	for (let line of yaml.split(/\r?\n/)) {
		let colonIdx = line.indexOf(":")
		if (colonIdx === -1) continue
		let key = line.slice(0, colonIdx).trim()
		let value = line.slice(colonIdx + 1).trim()
		if (value.startsWith('"') && value.endsWith('"')) {
			value = value.slice(1, -1)
		} else if (value.startsWith("'") && value.endsWith("'")) {
			value = value.slice(1, -1)
		}
		if (value === "true") {
			frontmatter[key] = true
		} else if (value === "false") {
			frontmatter[key] = false
		} else {
			frontmatter[key] = value
		}
	}

	return { frontmatter, body }
}

function togglePinned(content: string): string {
	let { frontmatter } = parseFrontmatter(content)
	let isPinned = frontmatter?.pinned === true

	if (isPinned) {
		return content.replace(
			/^(---\r?\n[\s\S]*?)pinned:\s*true\r?\n([\s\S]*?---)/,
			"$1$2",
		)
	}

	if (!frontmatter) {
		return `---\npinned: true\n---\n\n${content}`
	}

	return content.replace(/^(---\r?\n)/, "$1pinned: true\n")
}

function getTags(content: string): string[] {
	let { frontmatter } = parseFrontmatter(content)
	if (!frontmatter?.tags) return []
	return frontmatter.tags
		.split(",")
		.map(t => t.trim())
		.filter(Boolean)
}

function getPath(content: string): string | null {
	let { frontmatter } = parseFrontmatter(content)
	if (!frontmatter?.path || typeof frontmatter.path !== "string") return null
	let path = frontmatter.path.trim()
	if (!path) return null
	return path.replace(/^\/+|\/+$/g, "") || null
}

function addTag(content: string, tag: string): string {
	let { frontmatter } = parseFrontmatter(content)
	let existingTags = getTags(content)

	if (existingTags.includes(tag)) return content

	let newTags = [...existingTags, tag].join(", ")

	if (!frontmatter) {
		return `---\ntags: ${newTags}\n---\n\n${content}`
	}

	if (!frontmatter.tags) {
		return content.replace(/^(---\r?\n)/, `$1tags: ${newTags}\n`)
	}

	return content.replace(
		/^(---\r?\n[\s\S]*?)tags:\s*[^\r\n]*/,
		`$1tags: ${newTags}`,
	)
}

function getBacklinks(content: string): string[] {
	let { frontmatter } = parseFrontmatter(content)
	if (!frontmatter?.backlinks || typeof frontmatter.backlinks !== "string")
		return []
	return frontmatter.backlinks
		.split(",")
		.map(id => id.trim())
		.filter(Boolean)
}

type BacklinksWithRange = {
	ids: string[]
	lineFrom: number
	lineTo: number
	valueFrom: number
	valueTo: number
}

function getBacklinksWithRange(content: string): BacklinksWithRange | null {
	let match = content.match(/^---\r?\n([\s\S]*?)(?:\r?\n)?---/)
	if (!match) return null

	let frontmatter = match[1]
	let frontmatterStart = content.indexOf("\n") + 1

	let lines = frontmatter.split(/\r?\n/)
	let offset = frontmatterStart

	for (let line of lines) {
		let backlinkMatch = line.match(/^backlinks:\s*(.*)$/)
		if (backlinkMatch) {
			let ids = backlinkMatch[1]
				.split(",")
				.map(id => id.trim())
				.filter(Boolean)
			let lineFrom = offset
			let lineTo = offset + line.length
			let valueFrom = offset + line.indexOf(":") + 1
			// Skip leading whitespace after colon
			let valueStartOffset = backlinkMatch[0].indexOf(backlinkMatch[1])
			valueFrom = offset + valueStartOffset
			let valueTo = lineTo
			return { ids, lineFrom, lineTo, valueFrom, valueTo }
		}
		offset += line.length + 1
	}

	return null
}

function setBacklinks(content: string, ids: string[]): string {
	let { frontmatter } = parseFrontmatter(content)
	let newBacklinks = ids.filter(Boolean).join(", ")

	if (!frontmatter) {
		if (!newBacklinks) return content
		return `---\nbacklinks: ${newBacklinks}\n---\n\n${content}`
	}

	if (!frontmatter.backlinks) {
		if (!newBacklinks) return content
		return content.replace(/^(---\r?\n)/, `$1backlinks: ${newBacklinks}\n`)
	}

	if (!newBacklinks) {
		let result = content.replace(
			/^(---\r?\n[\s\S]*?)backlinks:\s*[^\r\n]*\r?\n/,
			"$1",
		)
		return removeEmptyFrontmatter(result)
	}

	return content.replace(
		/^(---\r?\n[\s\S]*?)backlinks:\s*[^\r\n]*/,
		`$1backlinks: ${newBacklinks}`,
	)
}

function addBacklink(content: string, id: string): string {
	let existing = getBacklinks(content)
	if (existing.includes(id)) return content
	return setBacklinks(content, [...existing, id])
}

function removeBacklink(content: string, id: string): string {
	let existing = getBacklinks(content)
	if (!existing.includes(id)) return content
	return setBacklinks(
		content,
		existing.filter(x => x !== id),
	)
}

function setTheme(content: string, themeName: string | null): string {
	let result = setFrontmatterField(content, "theme", themeName)
	return themeName ? result : setPreset(result, null)
}

function setPreset(content: string, presetName: string | null): string {
	return setFrontmatterField(content, "preset", presetName)
}

function setSyntaxTheme(content: string, familyId: string | null): string {
	return setFrontmatterField(content, "syntax-theme", familyId)
}

function getFrontmatterRange(
	state: EditorState,
): { from: number; to: number } | null {
	let doc = state.doc
	let firstLine = doc.line(1)

	if (firstLine.text !== "---") return null

	for (let i = 2; i <= doc.lines; i++) {
		let line = doc.line(i)
		if (line.text === "---") {
			return { from: firstLine.to, to: line.to }
		}
	}
	return null
}

// Helpers

function setFrontmatterField(
	content: string,
	key: string,
	value: string | null,
): string {
	let { frontmatter } = parseFrontmatter(content)

	if (!frontmatter) {
		if (!value) return content
		return `---\n${key}: ${value}\n---\n\n${content}`
	}

	let match = content.match(/^---(\r?\n)([\s\S]*?)(?:\r?\n)?---(?:\r?\n)?/)
	if (!match) return content

	let newline = match[1]
	let lines = match[2].split(/\r?\n/)
	let fieldIndex = lines.findIndex(line => {
		let colonIndex = line.indexOf(":")
		return colonIndex >= 0 && line.slice(0, colonIndex).trim() === key
	})

	if (fieldIndex < 0) {
		if (!value) return content
		lines.unshift(`${key}: ${value}`)
	} else if (value) {
		lines[fieldIndex] = `${key}: ${value}`
	} else {
		lines.splice(fieldIndex, 1)
	}

	let remainingFields = lines.some(line => line.trim())
	let body = content.slice(match[0].length)
	if (!remainingFields) return body
	return `---${newline}${lines.join(newline)}${newline}---${newline}${body}`
}

function removeEmptyFrontmatter(content: string): string {
	return content.replace(/^---\r?\n\s*---\r?\n?/, "")
}
