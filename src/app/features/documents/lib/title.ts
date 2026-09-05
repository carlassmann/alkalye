import { parseFrontmatter } from "@/app/features/editor/lib/frontmatter"
import { parseSearchTerms } from "@/app/lib/search-terms"

export {
	getDocumentTitle,
	addCopyToTitle,
	isDocumentPinned,
	formatRelativeDate,
	countContentMatches,
}

function getDocumentTitle(
	doc: string | { content?: { toString(): string } },
): string {
	let content = typeof doc === "string" ? doc : (doc.content?.toString() ?? "")
	let { frontmatter, body } = parseFrontmatter(content)

	if (frontmatter?.title) return frontmatter.title

	let line = findTitleLine(body)
	return (
		line
			.replace(/^#{1,6}\s+/, "")
			.replace(/\*\*([^*]+)\*\*/g, "$1")
			.replace(/\*([^*]+)\*/g, "$1")
			.replace(/__([^_]+)__/g, "$1")
			.replace(/_([^_]+)_/g, "$1")
			.replace(/`([^`]+)`/g, "$1")
			.trim()
			.slice(0, 80) || "Untitled"
	)
}

function isDocumentPinned(doc: { content?: { toString(): string } }): boolean {
	let content = doc.content?.toString() ?? ""
	let { frontmatter } = parseFrontmatter(content)
	return frontmatter?.pinned === true
}

type DateLabels = {
	today: string
	yesterday: string
	daysAgo: (days: number) => string
	weeksAgo: (weeks: number) => string
}

function formatRelativeDate(date: Date, labels: DateLabels): string {
	let now = new Date()
	let diff = now.getTime() - new Date(date).getTime()
	let days = Math.floor(diff / (1000 * 60 * 60 * 24))

	if (days === 0) return labels.today
	if (days === 1) return labels.yesterday
	if (days < 7) return labels.daysAgo(days)
	if (days < 30) return labels.weeksAgo(Math.floor(days / 7))
	return new Date(date).toLocaleDateString()
}

function countContentMatches(content: string, query: string): number {
	let { body } = parseFrontmatter(content)
	let terms = parseSearchTerms(query)
	if (terms.length === 0) return 0
	let total = 0
	for (let term of terms) {
		total += countMatches(body, term)
	}
	return total
}

function addCopyToTitle(content: string): string {
	let { frontmatter } = parseFrontmatter(content)

	// If frontmatter has title, add (copy) to it
	if (frontmatter?.title) {
		return content.replace(
			/^(---\s*\n[\s\S]*?title:\s*)(.+?)(\s*\n[\s\S]*?---)/m,
			`$1$2 (copy)$3`,
		)
	}

	// Otherwise, look for first heading and add (copy) to it
	let lines = content.split("\n")
	for (let i = 0; i < lines.length; i++) {
		let match = lines[i].match(/^(#{1,6}\s+)(.+)$/)
		if (match) {
			lines[i] = `${match[1]}${match[2]} (copy)`
			return lines.join("\n")
		}
		// Skip empty lines and frontmatter when looking for heading
		if (lines[i].trim() && !lines[i].startsWith("---")) {
			// First non-empty content that's not a heading - prepend a heading
			break
		}
	}

	// No heading found, prepend one with the inferred title
	let title = getDocumentTitle(content)
	return `# ${title} (copy)\n\n${content}`
}

function countMatches(text: string, query: string): number {
	let q = query.toLowerCase()
	let t = text.toLowerCase()
	let count = 0
	let idx = 0
	while ((idx = t.indexOf(q, idx)) !== -1) {
		count++
		idx += q.length
	}
	return count
}

function findTitleLine(body: string): string {
	for (let line of body.split("\n")) {
		let withoutLeadingImages = line
			.trim()
			.replace(/^(?:!\[[^\]]*\]\([^)]+\)\s*)+/, "")
		if (withoutLeadingImages) return withoutLeadingImages
	}
	return ""
}
