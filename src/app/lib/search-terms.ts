export { parseSearchTerms }

function parseSearchTerms(query: string): string[] {
	return query
		.split(",")
		.map(term => term.trim())
		.filter(Boolean)
}
