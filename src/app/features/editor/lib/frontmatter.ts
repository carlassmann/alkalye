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

type FrontmatterBlock = {
	yaml: string
	yamlStart: number
	end: number
	newline: string
	closingNewline: string
}

function parseFrontmatter(content: string): {
	frontmatter: Frontmatter | null
	body: string
} {
	let block = findFrontmatterBlock(content)
	if (!block) return { frontmatter: null, body: content }

	let body = content.slice(block.end)
	let frontmatter: Frontmatter = {}
	let foundField = false
	let rootIndent = getFrontmatterRootIndent(block.yaml)

	for (let line of block.yaml.split(/\r?\n/)) {
		let colonIdx = line.indexOf(":")
		if (colonIdx === -1) continue
		let rawKey = line.slice(0, colonIdx)
		let key = rawKey.trim()
		let indentation = rawKey.slice(0, rawKey.length - rawKey.trimStart().length)
		if (!key || indentation !== rootIndent) continue
		foundField = true
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
	if (!foundField && block.yaml.trim()) {
		return { frontmatter: null, body: content }
	}

	return { frontmatter, body }
}

function togglePinned(content: string): string {
	let { frontmatter } = parseFrontmatter(content)
	let isPinned = frontmatter?.pinned === true
	return setFrontmatterField(content, "pinned", isPinned ? null : "true")
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
	let existingTags = getTags(content)

	if (existingTags.includes(tag)) return content

	let newTags = [...existingTags, tag].join(", ")

	return setFrontmatterField(content, "tags", newTags)
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
	let block = findFrontmatterBlock(content)
	if (!block) return null

	let lines = block.yaml ? block.yaml.split(/\r?\n/) : []
	let offset = block.yamlStart

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
	let newBacklinks = ids.filter(Boolean).join(", ")
	return setFrontmatterField(content, "backlinks", newBacklinks || null)
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

	let block = findFrontmatterBlock(content)
	if (!block) return content

	let lines = block.yaml ? block.yaml.split(/\r?\n/) : []
	let rootIndent = getFrontmatterRootIndent(block.yaml) ?? ""
	let fieldIndexes: number[] = []
	for (let index = 0; index < lines.length; index++) {
		let line = lines[index] ?? ""
		let colonIndex = line.indexOf(":")
		if (colonIndex < 0) continue
		let rawKey = line.slice(0, colonIndex)
		let indentation = rawKey.slice(0, rawKey.length - rawKey.trimStart().length)
		if (indentation !== rootIndent || rawKey.trim() !== key) continue
		fieldIndexes.push(index)
	}

	if (fieldIndexes.length === 0) {
		if (!value) return content
		lines.unshift(`${rootIndent}${key}: ${value}`)
	} else {
		let fieldIndex = fieldIndexes[fieldIndexes.length - 1] ?? 0
		if (value) lines[fieldIndex] = `${rootIndent}${key}: ${value}`
		for (let index = fieldIndexes.length - 1; index >= 0; index--) {
			let duplicateIndex = fieldIndexes[index]
			if (value && duplicateIndex === fieldIndex) continue
			if (duplicateIndex !== undefined) lines.splice(duplicateIndex, 1)
		}
	}

	let remainingFields = lines.some(line => line.trim())
	let body = content.slice(block.end)
	if (!remainingFields) return body.replace(/^\r?\n/, "")
	return `---${block.newline}${lines.join(block.newline)}${block.newline}---${block.closingNewline}${body}`
}

function findFrontmatterBlock(content: string): FrontmatterBlock | null {
	let opening = content.match(/^---(\r?\n)/)
	if (!opening) return null

	let closingPattern = /^---(\r?\n|$)/gm
	closingPattern.lastIndex = opening[0].length
	let closing = closingPattern.exec(content)
	if (!closing) return null

	let yamlStart = opening[0].length
	let yaml = content.slice(yamlStart, closing.index).replace(/\r?\n$/, "")
	return {
		yaml,
		yamlStart,
		end: closing.index + closing[0].length,
		newline: opening[1],
		closingNewline: closing[1],
	}
}

function getFrontmatterRootIndent(yaml: string): string | null {
	let rootIndent: string | null = null
	for (let line of yaml.split(/\r?\n/)) {
		let colonIndex = line.indexOf(":")
		if (colonIndex < 0) continue
		let rawKey = line.slice(0, colonIndex)
		if (!rawKey.trim()) continue
		let indentation = rawKey.slice(0, rawKey.length - rawKey.trimStart().length)
		if (rootIndent === null || indentation.length < rootIndent.length) {
			rootIndent = indentation
		}
	}
	return rootIndent
}
