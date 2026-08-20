import { useCallback } from "react"
import { useNavigate, useSearch } from "@tanstack/react-router"

export { useFindPanel }

function useFindPanel(): {
	findOpen: boolean
	findQuery?: string
	findCase?: boolean
	findFuzzy?: boolean
	findReplace?: boolean
	setFind: (updates: FindPanelState) => void
} {
	let search = useSearch({ strict: false }) as FindSearchSchema
	let navigate = useNavigate()

	let findOpen = search.find === true
	let findQuery = search.q
	let findCase = search.case
	let findFuzzy = search.fuzzy
	let findReplace = search.replace

	let setFind = useCallback(
		(updates: FindPanelState) => {
			let next = { ...(search as FindSearchSchema) }

			if (updates.open !== undefined) {
				if (updates.open) {
					next.find = true
				} else {
					delete next.find
					delete next.q
					delete next.case
					delete next.fuzzy
					delete next.replace
				}
			}

			if (updates.q !== undefined) {
				if (updates.q) {
					next.q = updates.q
				} else {
					delete next.q
				}
			}

			if (updates.case !== undefined) {
				if (updates.case) {
					next.case = true
				} else {
					delete next.case
				}
			}

			if (updates.fuzzy !== undefined) {
				if (updates.fuzzy) {
					next.fuzzy = true
				} else {
					delete next.fuzzy
				}
			}

			if (updates.replace !== undefined) {
				if (updates.replace) next.replace = true
				else delete next.replace
			}

			void navigate({
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				search: next as any,
				replace: true,
			})
		},
		[navigate, search],
	)

	return { findOpen, findQuery, findCase, findFuzzy, findReplace, setFind }
}

interface FindPanelState {
	open?: boolean
	q?: string
	case?: boolean
	fuzzy?: boolean
	replace?: boolean
}

interface FindSearchSchema {
	find?: boolean
	q?: string
	case?: boolean
	fuzzy?: boolean
	replace?: boolean
	[key: string]: unknown
}
