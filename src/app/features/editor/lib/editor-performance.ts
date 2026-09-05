export { MAX_RICH_MARKDOWN_LENGTH, usesRichMarkdown }

let MAX_RICH_MARKDOWN_LENGTH = 128 * 1024

function usesRichMarkdown(documentLength: number) {
	return documentLength < MAX_RICH_MARKDOWN_LENGTH
}
