import { parseFrontmatter } from "@/app/features/editor/lib/frontmatter"

export { setDocumentTitle }

function setDocumentTitle(content: string, title: string): string {
	let nextTitle = title.trim()
	if (!nextTitle) return content

	let { frontmatter } = parseFrontmatter(content)
	if (frontmatter?.title) {
		return content.replace(
			/^(---\s*\n[\s\S]*?\ntitle:\s*)(.+?)(\n[\s\S]*?---\n?)/m,
			`$1${nextTitle}$3`,
		)
	}

	let lines = content.split("\n")
	for (let index = 0; index < lines.length; index++) {
		let match = lines[index].match(/^(#{1,6}\s+)(.+)$/)
		if (match) {
			lines[index] = `${match[1]}${nextTitle}`
			return lines.join("\n")
		}
		if (lines[index].trim() && !lines[index].startsWith("---")) break
	}

	return `# ${nextTitle}\n\n${content}`.trimEnd()
}
