import {
	StateField,
	StateEffect,
	RangeSetBuilder,
	type Extension,
} from "@codemirror/state"
import {
	EditorView,
	Decoration,
	type DecorationSet,
	ViewPlugin,
	type ViewUpdate,
} from "@codemirror/view"

export {
	findExtension,
	setFindQuery,
	getFindState,
	replaceAllMatches,
	replaceCurrentMatch,
	selectMatch,
}
export type { FindState, FindMatch }

type FindMatch = { from: number; to: number }

type FindState = {
	query: string
	caseSensitive: boolean
	fuzzy: boolean
	matches: FindMatch[]
	currentIndex: number
}

let emptyState: FindState = {
	query: "",
	caseSensitive: false,
	fuzzy: false,
	matches: [],
	currentIndex: -1,
}

let setFindQueryEffect = StateEffect.define<{
	query: string
	caseSensitive: boolean
	fuzzy: boolean
}>()

let setCurrentIndexEffect = StateEffect.define<number>()

function setFindQuery(
	view: EditorView,
	query: string,
	caseSensitive: boolean,
	fuzzy: boolean,
) {
	view.dispatch({
		effects: setFindQueryEffect.of({ query, caseSensitive, fuzzy }),
	})
}

function selectMatch(view: EditorView, direction: "next" | "prev") {
	let state = view.state.field(findStateField)
	if (state.matches.length === 0) return

	let cursorPos = view.state.selection.main.head
	let newIndex: number

	if (direction === "next") {
		// Find next match after cursor
		newIndex = state.matches.findIndex(m => m.from > cursorPos)
		if (newIndex === -1) newIndex = 0 // Wrap to start
	} else {
		// Find prev match before cursor
		let reversed = [...state.matches].reverse()
		let revIndex = reversed.findIndex(m => m.to < cursorPos)
		if (revIndex === -1) {
			newIndex = state.matches.length - 1 // Wrap to end
		} else {
			newIndex = state.matches.length - 1 - revIndex
		}
	}

	let match = state.matches[newIndex]
	if (!match) return

	view.dispatch({
		effects: setCurrentIndexEffect.of(newIndex),
		selection: { anchor: match.from, head: match.to },
		scrollIntoView: true,
	})
}

function getFindState(view: EditorView): FindState {
	return view.state.field(findStateField, false) ?? emptyState
}

function replaceCurrentMatch(
	view: EditorView,
	replacement: string,
	scope?: FindMatch,
): boolean {
	let state = getFindState(view)
	let matches = scopedMatches(state.matches, scope)
	if (matches.length === 0) return false
	let selection = view.state.selection.main
	let match =
		matches.find(
			item => item.from === selection.from && item.to === selection.to,
		) ??
		matches.find(item => item.from >= selection.head) ??
		matches[0]
	if (!match) return false
	view.dispatch({
		changes: { from: match.from, to: match.to, insert: replacement },
		selection: { anchor: match.from, head: match.from + replacement.length },
	})
	return true
}

function replaceAllMatches(
	view: EditorView,
	replacement: string,
	scope?: FindMatch,
): number {
	let matches = scopedMatches(getFindState(view).matches, scope)
	if (matches.length === 0) return 0
	view.dispatch({
		changes: matches.map(match => ({
			from: match.from,
			to: match.to,
			insert: replacement,
		})),
	})
	return matches.length
}

function scopedMatches(matches: FindMatch[], scope?: FindMatch): FindMatch[] {
	if (!scope) return matches
	return matches.filter(
		match => match.from >= scope.from && match.to <= scope.to,
	)
}

function computeMatches(
	doc: string,
	query: string,
	caseSensitive: boolean,
	fuzzy: boolean,
): FindMatch[] {
	if (!query) return []

	let matches: FindMatch[] = []
	let searchDoc = caseSensitive ? doc : doc.toLowerCase()
	let searchQuery = caseSensitive ? query : query.toLowerCase()

	if (fuzzy) {
		// Fuzzy: find substrings within edit distance 1-2 (depending on query length)
		let maxDistance = query.length <= 3 ? 1 : 2
		let windowSize = query.length + maxDistance

		for (let i = 0; i <= searchDoc.length - query.length + maxDistance; i++) {
			// Check windows of varying sizes around query length
			for (
				let len = Math.max(1, query.length - maxDistance);
				len <= windowSize && i + len <= searchDoc.length;
				len++
			) {
				let substring = searchDoc.slice(i, i + len)
				let distance = levenshteinDistance(searchQuery, substring)

				if (distance <= maxDistance) {
					// Avoid overlapping matches - skip if too close to last match
					let lastMatch = matches[matches.length - 1]
					if (!lastMatch || i >= lastMatch.to) {
						matches.push({ from: i, to: i + len })
						break // Found match at this position, move on
					}
				}
			}
		}
	} else {
		// Exact substring match
		let pos = 0
		while (true) {
			let index = searchDoc.indexOf(searchQuery, pos)
			if (index === -1) break
			matches.push({ from: index, to: index + query.length })
			pos = index + 1
		}
	}

	return matches
}

function levenshteinDistance(a: string, b: string): number {
	if (a.length === 0) return b.length
	if (b.length === 0) return a.length

	// Use two rows instead of full matrix for memory efficiency
	let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
	let curr = new Array<number>(b.length + 1)

	for (let i = 1; i <= a.length; i++) {
		curr[0] = i
		for (let j = 1; j <= b.length; j++) {
			let cost = a[i - 1] === b[j - 1] ? 0 : 1
			curr[j] = Math.min(
				prev[j] + 1, // deletion
				curr[j - 1] + 1, // insertion
				prev[j - 1] + cost, // substitution
			)
		}
		;[prev, curr] = [curr, prev]
	}

	return prev[b.length]
}

let findStateField = StateField.define<FindState>({
	create() {
		return emptyState
	},

	update(state, tr) {
		for (let effect of tr.effects) {
			if (effect.is(setFindQueryEffect)) {
				let { query, caseSensitive, fuzzy } = effect.value
				let doc = tr.state.doc.toString()
				let matches = computeMatches(doc, query, caseSensitive, fuzzy)
				return {
					query,
					caseSensitive,
					fuzzy,
					matches,
					currentIndex: matches.length > 0 ? 0 : -1,
				}
			}
			if (effect.is(setCurrentIndexEffect)) {
				return { ...state, currentIndex: effect.value }
			}
		}

		// If doc changed, recompute matches
		if (tr.docChanged && state.query) {
			let doc = tr.state.doc.toString()
			let matches = computeMatches(
				doc,
				state.query,
				state.caseSensitive,
				state.fuzzy,
			)
			// Try to preserve current index
			let newIndex = state.currentIndex
			if (newIndex >= matches.length) {
				newIndex = matches.length - 1
			}
			return { ...state, matches, currentIndex: newIndex }
		}

		return state
	},
})

let matchMark = Decoration.mark({ class: "cm-find-match" })
let currentMatchMark = Decoration.mark({ class: "cm-find-match-current" })

let findDecorations = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet

		constructor(view: EditorView) {
			this.decorations = this.buildDecorations(view)
		}

		update(update: ViewUpdate) {
			let oldState = update.startState.field(findStateField, false)
			let newState = update.state.field(findStateField, false)

			if (oldState !== newState || update.docChanged) {
				this.decorations = this.buildDecorations(update.view)
			}
		}

		buildDecorations(view: EditorView): DecorationSet {
			let state = view.state.field(findStateField, false)
			if (!state || state.matches.length === 0) {
				return Decoration.none
			}

			let builder = new RangeSetBuilder<Decoration>()
			for (let i = 0; i < state.matches.length; i++) {
				let match = state.matches[i]
				let mark = i === state.currentIndex ? currentMatchMark : matchMark
				builder.add(match.from, match.to, mark)
			}
			return builder.finish()
		}
	},
	{
		decorations: v => v.decorations,
	},
)

let findTheme = EditorView.baseTheme({
	".cm-find-match": {
		backgroundColor: "var(--editor-find-match, rgba(255, 213, 0, 0.4))",
		borderRadius: "2px",
	},
	".cm-find-match-current": {
		backgroundColor: "var(--editor-find-match-current, rgba(255, 150, 0, 0.6))",
		borderRadius: "2px",
	},
})

let findExtension: Extension = [findStateField, findDecorations, findTheme]
