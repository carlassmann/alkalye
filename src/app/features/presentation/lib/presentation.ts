import { Lexer, type Token, type Tokens } from "marked"

export {
	parsePresentation,
	getPresentationMode,
	parsePresentationSize,
	parsePresentationTheme,
}
export type {
	PresentationItem,
	VisualBlock,
	SlideContent,
	PresentationSize,
	PresentationTheme,
	TextSegment,
}

type PresentationSize = "S" | "M" | "L"
type PresentationTheme = "light" | "dark"

function getPresentationMode(content: string): boolean {
	let frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
	if (!frontmatterMatch) return false
	return /^mode:\s*(?:present|presentation)\s*$/m.test(frontmatterMatch[1])
}

function parsePresentationSize(content: string): PresentationSize {
	let frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
	if (!frontmatterMatch) return "M"
	let sizeMatch = frontmatterMatch[1].match(/^size:\s*(S|M|L)\s*$/m)
	return (sizeMatch?.[1] as PresentationSize) ?? "M"
}

function parsePresentationTheme(content: string): PresentationTheme | null {
	let frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
	if (!frontmatterMatch) return null
	let themeMatch = frontmatterMatch[1].match(/^theme:\s*(light|dark)\s*$/m)
	return (themeMatch?.[1] as PresentationTheme) ?? null
}

function parsePresentation(content: string): PresentationItem[] {
	let sections = splitIntoSections(content)
	let items: PresentationItem[] = []

	for (let i = 0; i < sections.length; i++) {
		let sectionItems = buildSectionItems(sections[i], content, i + 1)
		items.push(...sectionItems)
	}

	return items
}

function splitIntoSections(content: string): Section[] {
	let processContent = content
	let lineOffset = 0
	let frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n?/)
	if (frontmatterMatch) {
		lineOffset = frontmatterMatch[0].split("\n").length - 1
		processContent = content.slice(frontmatterMatch[0].length)
	}

	let tokens = Lexer.lex(processContent)
	let sections: Section[] = []
	let currentTokens: Token[] = []
	let pos = 0
	let sectionStartPos = 0

	for (let token of tokens) {
		if (token.type === "hr") {
			if (currentTokens.length > 0) {
				let startLine = lineOffset + posToLine(processContent, sectionStartPos)
				let endLine = lineOffset + posToLine(processContent, pos) - 1
				sections.push({ tokens: currentTokens, startLine, endLine })
			}
			pos += token.raw.length
			sectionStartPos = pos
			currentTokens = []
		} else {
			if (token.type === "space" && currentTokens.length === 0) {
				pos += token.raw.length
				sectionStartPos = pos
			} else {
				currentTokens.push(token)
				pos += token.raw.length
			}
		}
	}

	if (currentTokens.length > 0) {
		let startLine = lineOffset + posToLine(processContent, sectionStartPos)
		let endLine = lineOffset + processContent.split("\n").length - 1
		sections.push({ tokens: currentTokens, startLine, endLine })
	}

	return sections
}

function buildSectionItems(
	section: Section,
	content: string,
	slideNumber: number,
): PresentationItem[] {
	let items: PresentationItem[] = []
	let currentBlockContent: SlideContent[] = []
	let currentBlockStart = section.startLine
	let currentBlockEnd = section.startLine

	let { processContent, lineOffset } = stripFrontmatter(content)
	let pos = getSectionContentStart(
		processContent,
		section.startLine,
		lineOffset,
	)

	for (let token of section.tokens) {
		let tokenStartLine = lineOffset + posToLine(processContent, pos)
		let contentEnd = token.raw.replace(/\n+$/, "")
		let tokenContentEndLine = tokenStartLine + contentEnd.split("\n").length - 1

		if (token.type === "space") {
			if (currentBlockContent.length > 0) {
				items.push(
					createBlock(
						slideNumber,
						currentBlockContent,
						currentBlockStart,
						currentBlockEnd,
					),
				)
				currentBlockContent = []
			}
			currentBlockStart = tokenStartLine + token.raw.split("\n").length - 1
			currentBlockEnd = currentBlockStart
		} else if (token.type === "list") {
			let result = processListToken(
				token as Tokens.List,
				tokenStartLine,
				slideNumber,
				currentBlockContent,
				currentBlockStart,
				currentBlockEnd,
			)
			items.push(...result.items)
			currentBlockContent = result.blockContent
			currentBlockStart = result.blockStart
			currentBlockEnd = result.blockEnd
		} else if (isTokenOnSlide(token)) {
			if (currentBlockContent.length === 0) {
				currentBlockStart = tokenStartLine
			}
			currentBlockContent.push(...tokenToContent(token))
			currentBlockEnd = tokenContentEndLine

			if (endsWithBlankLine(token)) {
				items.push(
					createBlock(
						slideNumber,
						currentBlockContent,
						currentBlockStart,
						currentBlockEnd,
					),
				)
				currentBlockContent = []
				currentBlockStart = tokenContentEndLine + 2
				currentBlockEnd = currentBlockStart
			}
		} else if (token.type === "paragraph") {
			let result = processParagraphToken(
				token as Tokens.Paragraph,
				tokenStartLine,
				tokenContentEndLine,
				slideNumber,
				currentBlockContent,
				currentBlockStart,
				currentBlockEnd,
			)
			items.push(...result.items)
			currentBlockContent = result.blockContent
			currentBlockStart = result.blockStart
			currentBlockEnd = result.blockEnd
		}

		pos += token.raw.length
	}

	if (currentBlockContent.length > 0) {
		items.push(
			createBlock(
				slideNumber,
				currentBlockContent,
				currentBlockStart,
				currentBlockEnd,
			),
		)
	}

	return items
}

function processParagraphToken(
	token: Tokens.Paragraph,
	tokenStartLine: number,
	tokenContentEndLine: number,
	slideNumber: number,
	blockContent: SlideContent[],
	blockStart: number,
	blockEnd: number,
): {
	items: PresentationItem[]
	blockContent: SlideContent[]
	blockStart: number
	blockEnd: number
} {
	let items: PresentationItem[] = []
	let lines = token.raw.split("\n")

	for (let i = 0; i < lines.length; i++) {
		let line = lines[i]
		let lineNum = tokenStartLine + i

		if (line.trim() === "") continue

		if (/^(\t| {2})/.test(line)) {
			if (blockContent.length === 0) {
				blockStart = lineNum
			}
			let text = line.replace(/^(\t| {2,})/, "")
			blockContent.push({
				type: "text",
				text,
				segments: parseTextSegments(text),
			})
			blockEnd = lineNum
		} else {
			if (blockContent.length > 0) {
				items.push(createBlock(slideNumber, blockContent, blockStart, blockEnd))
				blockContent = []
			}
			blockStart = lineNum + 1
			blockEnd = blockStart
			items.push({ type: "line", slideNumber, lineNumber: lineNum, text: line })
		}
	}

	if (endsWithBlankLine(token)) {
		if (blockContent.length > 0) {
			items.push(createBlock(slideNumber, blockContent, blockStart, blockEnd))
			blockContent = []
		}
		blockStart = tokenContentEndLine + 2
		blockEnd = blockStart
	}

	return { items, blockContent, blockStart, blockEnd }
}

function processListToken(
	token: Tokens.List,
	tokenStartLine: number,
	slideNumber: number,
	blockContent: SlideContent[],
	blockStart: number,
	blockEnd: number,
): {
	items: PresentationItem[]
	blockContent: SlideContent[]
	blockStart: number
	blockEnd: number
} {
	let items: PresentationItem[] = []
	let currentLine = tokenStartLine

	// Group consecutive indented items into lists, non-indented as teleprompter
	let indentedItems: Tokens.ListItem[] = []

	for (let item of token.items) {
		// Count actual content line (excluding trailing blank lines)
		let contentRaw = item.raw.replace(/\n+$/, "")
		let contentLines = contentRaw.split("\n").length
		let totalLines =
			item.raw.split("\n").length - (item.raw.endsWith("\n") ? 1 : 0)
		let isIndented = /^(\t| {2})/.test(item.raw)

		if (isIndented) {
			if (indentedItems.length === 0 && blockContent.length === 0) {
				blockStart = currentLine
			}
			indentedItems.push(item)
			// blockEnd should be the last content line, not including trailing blanks
			blockEnd = currentLine + contentLines - 1
		} else {
			// Flush any accumulated indented items as a list
			if (indentedItems.length > 0) {
				blockContent.push({
					type: "list",
					items: indentedItems.map(i => ({
						text: i.text.replace(/\n+$/, ""),
						segments: parseTextSegments(i.text.replace(/\n+$/, "")),
					})),
					ordered: token.ordered,
				})
				// Flush the block before teleprompter content
				items.push(createBlock(slideNumber, blockContent, blockStart, blockEnd))
				blockContent = []
				indentedItems = []
			}
			// Non-indented item goes to teleprompter
			let text = item.text.replace(/\n+$/, "")
			items.push({ type: "line", slideNumber, lineNumber: currentLine, text })
			blockStart = currentLine + totalLines
			blockEnd = blockStart
		}

		currentLine += totalLines
	}

	// Flush remaining indented items
	if (indentedItems.length > 0) {
		blockContent.push({
			type: "list",
			items: indentedItems.map(i => ({
				text: i.text.replace(/\n+$/, ""),
				segments: parseTextSegments(i.text.replace(/\n+$/, "")),
			})),
			ordered: token.ordered,
		})
	}

	// Handle trailing blank lines
	if (endsWithBlankLine(token) && blockContent.length > 0) {
		items.push(createBlock(slideNumber, blockContent, blockStart, blockEnd))
		blockContent = []
		blockStart = blockEnd + 2
		blockEnd = blockStart
	}

	return { items, blockContent, blockStart, blockEnd }
}

function tokenToContent(token: Token): SlideContent[] {
	switch (token.type) {
		case "heading": {
			let h = token as Tokens.Heading
			return [
				{
					type: "heading",
					depth: h.depth,
					text: h.text,
					segments: parseTextSegments(h.text),
				},
			]
		}
		case "code": {
			let c = token as Tokens.Code
			if (c.codeBlockStyle === "indented") {
				return parseIndentedCode(c)
			}
			return [
				{ type: "code", text: c.text, language: parseCodeLanguage(c.lang) },
			]
		}
		case "table": {
			let t = token as Tokens.Table
			let rows = [t.header.map(h => h.text)]
			rows.push(...t.rows.map(r => r.map(c => c.text)))
			return [{ type: "table", rows }]
		}
		case "list": {
			let l = token as Tokens.List
			return [
				{
					type: "list",
					items: l.items.map(i => ({
						text: i.text,
						segments: parseTextSegments(i.text),
					})),
					ordered: l.ordered,
				},
			]
		}
		case "blockquote": {
			let b = token as Tokens.Blockquote
			return [
				{
					type: "blockquote",
					text: b.text,
					segments: parseTextSegments(b.text),
				},
			]
		}
		case "paragraph": {
			let p = token as Tokens.Paragraph
			let imgMatch = p.raw.match(/^!\[([^\]]*)\]\(([^)]+)\)/)
			if (imgMatch) {
				let content: SlideContent[] = [
					{ type: "image", alt: imgMatch[1], src: imgMatch[2] },
				]
				// Check for indented text after the image (same visual block)
				let afterImage = p.raw.slice(imgMatch[0].length)
				let lines = afterImage.split("\n")
				for (let line of lines) {
					if (line.trim() === "") continue
					if (/^(\t| {2})/.test(line)) {
						let text = line.replace(/^(\t| {2,})/, "")
						content.push({
							type: "text",
							text,
							segments: parseTextSegments(text),
						})
					}
				}
				return content
			}
			let text = p.text.replace(/^(\t| {2})/, "")
			return [{ type: "text", text, segments: parseTextSegments(text) }]
		}
		default:
			return []
	}
}

function parseIndentedCode(token: Tokens.Code): SlideContent[] {
	let lines = token.text.split("\n")
	let content: SlideContent[] = []
	let i = 0

	while (i < lines.length) {
		let line = lines[i]
		if (line.trim() === "") {
			i++
			continue
		}

		if (/^>\s?/.test(line)) {
			let quoteLines: string[] = []
			while (i < lines.length && /^>\s?/.test(lines[i])) {
				quoteLines.push(lines[i].replace(/^>\s?/, ""))
				i++
			}
			let text = quoteLines.join("\n")
			content.push({
				type: "blockquote",
				text,
				segments: parseTextSegments(text),
			})
			continue
		}

		let listMatch =
			line.match(/^([-+*])\s(.*)$/) || line.match(/^(\d+)\.\s(.*)$/)
		if (listMatch) {
			let items: { text: string; segments: TextSegment[] }[] = []
			let ordered = /^\d+$/.test(listMatch[1])
			while (i < lines.length) {
				let m =
					lines[i].match(/^([-+*])\s(.*)$/) || lines[i].match(/^(\d+)\.\s(.*)$/)
				if (!m) break
				items.push({ text: m[2], segments: parseTextSegments(m[2]) })
				i++
			}
			content.push({ type: "list", items, ordered })
			continue
		}

		content.push({
			type: "text",
			text: line,
			segments: parseTextSegments(line),
		})
		i++
	}

	return content
}

// Helpers

function parseCodeLanguage(language: string | undefined): string | undefined {
	let firstToken = language?.trim().split(/\s+/, 1)[0]?.toLowerCase()
	if (!firstToken || firstToken.startsWith("{")) return undefined
	return firstToken
}

function createBlock(
	slideNumber: number,
	content: SlideContent[],
	startLine: number,
	endLine: number,
): PresentationItem {
	return {
		type: "block",
		slideNumber,
		block: { content, startLine, endLine },
	}
}

function stripFrontmatter(content: string): {
	processContent: string
	lineOffset: number
} {
	let frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n?/)
	if (!frontmatterMatch) return { processContent: content, lineOffset: 0 }
	return {
		processContent: content.slice(frontmatterMatch[0].length),
		lineOffset: frontmatterMatch[0].split("\n").length - 1,
	}
}

function getSectionContentStart(
	processContent: string,
	sectionStartLine: number,
	lineOffset: number,
): number {
	let pos = processContent
		.split("\n")
		.slice(0, sectionStartLine - lineOffset)
		.join("\n").length
	if (sectionStartLine > lineOffset) pos++
	return pos
}

function posToLine(content: string, pos: number): number {
	return content.slice(0, pos).split("\n").length - 1
}

function isTokenOnSlide(token: Token): boolean {
	switch (token.type) {
		case "heading":
		case "table":
		case "image":
		case "code":
			return true
		case "list":
			// Lists need special handling - marked merges consecutive lists
			// Check if ANY item is indented (will be split in tokenToContent)
			return hasIndentedListItems(token as Tokens.List)
		case "blockquote":
			return /^(\t| {2})/.test(token.raw)
		case "paragraph":
			if (/^!\[/.test(token.raw)) return true
			return /^(\t| {2})/.test(token.raw)
		default:
			return false
	}
}

function hasIndentedListItems(list: Tokens.List): boolean {
	for (let item of list.items) {
		if (/^(\t| {2})/.test(item.raw)) return true
	}
	return false
}

function endsWithBlankLine(token: Token): boolean {
	return /\n\n$/.test(token.raw)
}

// Types

type TextSegment =
	| { type: "text"; text: string }
	| { type: "link"; text: string; href: string }
	| { type: "wikilink"; docId: string; alias?: string }
	| { type: "strong"; segments: TextSegment[] }
	| { type: "em"; segments: TextSegment[] }
	| { type: "codespan"; text: string }
	| { type: "del"; segments: TextSegment[] }

type SlideContent =
	| { type: "heading"; depth: number; text: string; segments: TextSegment[] }
	| { type: "text"; text: string; segments: TextSegment[] }
	| { type: "code"; text: string; language?: string }
	| { type: "image"; alt: string; src: string }
	| {
			type: "list"
			items: { text: string; segments: TextSegment[] }[]
			ordered: boolean
	  }
	| { type: "blockquote"; text: string; segments: TextSegment[] }
	| { type: "table"; rows: string[][] }

function parseTextSegments(text: string): TextSegment[] {
	// Handle wikilinks before standard lexing
	// Match [[id]], [[id|alias]], or [[id]]suffix
	let segments: TextSegment[] = []
	let lastIndex = 0
	let regex = /\[\[([^\]]+)\]\](\w*)/g
	let match

	while ((match = regex.exec(text)) !== null) {
		// Process text before the wikilink
		if (match.index > lastIndex) {
			let before = text.slice(lastIndex, match.index)
			let tokens = Lexer.lexInline(before)
			segments.push(...tokensToSegments(tokens))
		}

		let inner = match[1]
		let suffix = match[2]
		let pipeIndex = inner.indexOf("|")
		let docId: string
		let alias: string | undefined

		if (pipeIndex !== -1) {
			docId = inner.slice(0, pipeIndex).trim()
			alias = inner.slice(pipeIndex + 1).trim()
		} else {
			docId = inner.trim()
		}

		// Append suffix to alias
		if (suffix) {
			alias = (alias ?? "") + suffix
		}

		// Add wikilink segment
		segments.push({ type: "wikilink", docId, alias: alias || undefined })
		lastIndex = match.index + match[0].length
	}

	// Process remaining text
	if (lastIndex < text.length) {
		let remaining = text.slice(lastIndex)
		let tokens = Lexer.lexInline(remaining)
		segments.push(...tokensToSegments(tokens))
	}

	return segments.length > 0
		? segments
		: tokensToSegments(Lexer.lexInline(text))
}

function tokensToSegments(tokens: Token[]): TextSegment[] {
	let segments: TextSegment[] = []

	for (let token of tokens) {
		switch (token.type) {
			case "text":
			case "escape":
				segments.push({ type: "text", text: token.text })
				break
			case "link": {
				let link = token as Tokens.Link
				segments.push({ type: "link", text: link.text, href: link.href })
				break
			}
			case "strong": {
				let strong = token as Tokens.Strong
				segments.push({
					type: "strong",
					segments: tokensToSegments(strong.tokens ?? []),
				})
				break
			}
			case "em": {
				let em = token as Tokens.Em
				segments.push({
					type: "em",
					segments: tokensToSegments(em.tokens ?? []),
				})
				break
			}
			case "codespan": {
				let code = token as Tokens.Codespan
				segments.push({ type: "codespan", text: code.text })
				break
			}
			case "del": {
				let del = token as Tokens.Del
				segments.push({
					type: "del",
					segments: tokensToSegments(del.tokens ?? []),
				})
				break
			}
			default:
				if ("text" in token && typeof token.text === "string") {
					segments.push({ type: "text", text: token.text })
				}
		}
	}

	return segments
}

type VisualBlock = {
	content: SlideContent[]
	startLine: number
	endLine: number
}

type PresentationItem =
	| { type: "block"; slideNumber: number; block: VisualBlock }
	| { type: "line"; slideNumber: number; lineNumber: number; text: string }

type Section = {
	tokens: Token[]
	startLine: number
	endLine: number
}
