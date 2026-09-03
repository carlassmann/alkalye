import { parseSearchTerms } from "@/app/lib/search-terms"

export { TextHighlight, parseSearchTerms }

function TextHighlight({ text, query }: { text: string; query?: string }) {
	if (!query?.trim() || !text) return text

	let terms = parseSearchTerms(query)
	if (terms.length === 0) return text

	let escaped = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
	let pattern = escaped.join("|")
	let parts = text.split(new RegExp(`(${pattern})`, "gi"))

	let termsLower = terms.map(t => t.toLowerCase())

	return (
		<>
			{parts.map((part, i) =>
				termsLower.includes(part.toLowerCase()) ? (
					<mark key={i} className="bg-brand/20 text-brand">
						{part}
					</mark>
				) : (
					part
				),
			)}
		</>
	)
}
