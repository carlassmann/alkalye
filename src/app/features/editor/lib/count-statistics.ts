import type { EditorStatistics } from "./editor-statistics-protocol"

export { getStats }

let FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/
let TASK_RE = /^\s*[-*+]\s\[([ xX])\]/gm

function stripFrontmatter(content: string): string {
	return content.replace(FRONTMATTER_RE, "")
}

function countWords(text: string): number {
	let stripped = stripFrontmatter(text)
	let words = stripped.split(/\s+/).filter(Boolean)
	return words.length
}

function countSentences(text: string): number {
	let stripped = stripFrontmatter(text)
	let cleaned = stripped
		.replace(/```[\s\S]*?```/g, "")
		.replace(/`[^`]+`/g, "")
		.replace(/!\[.*?\]\(.*?\)/g, "")
		.replace(/\[([^\]]+)\]\(.*?\)/g, "$1")
		.replace(/^#+\s*/gm, "")
	let sentences = cleaned.split(/[.!?]+(?:\s|$)/).filter(s => s.trim())
	return sentences.length
}

function countTasks(text: string): { done: number; total: number } {
	let done = 0
	let total = 0
	let match: RegExpExecArray | null
	TASK_RE.lastIndex = 0
	while ((match = TASK_RE.exec(text)) !== null) {
		total++
		if (match[1] !== " ") done++
	}
	return { done, total }
}

function getStats(content: string): EditorStatistics {
	let words = countWords(content)
	let sentences = countSentences(content)
	let { done, total } = countTasks(content)
	return {
		words: `${words}`,
		sentences: `${sentences}`,
		tasks: `${done} / ${total}`,
	}
}
