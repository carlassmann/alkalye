import { parse, walk, type CssNode } from "css-tree"
export { scopeThemeCss }
function scopeThemeCss(css: string, scopeSelector: string): string {
	if (!css.trim()) return ""

	let { globalRules, scopedCss } = splitGlobalThemeRules(css)
	let scoped = `@scope (${scopeSelector}) {\n${scopedCss}\n}`
	return [...globalRules, scoped].join("\n")
}

function splitGlobalThemeRules(css: string) {
	let globalRules: string[] = []
	let spans: { from: number; to: number; replacement: string }[] = []
	try {
		let stylesheet = parse(css, {
			positions: true,
			parseAtrulePrelude: false,
			parseRulePrelude: true,
			parseValue: false,
		})
		if (stylesheet.type === "StyleSheet") {
			stylesheet.children.forEach(rule => collectGlobalRules(rule, []))
			walk(stylesheet, node => {
				if (
					node.type === "PseudoClassSelector" &&
					node.name.toLowerCase() === "root" &&
					node.loc
				)
					spans.push({
						from: node.loc.start.offset,
						to: node.loc.end.offset,
						replacement: ":scope",
					})
			})
		}
	} catch {
		return { globalRules: [], scopedCss: css }
	}
	function collectGlobalRules(rule: CssNode, wrappers: string[]) {
		if (rule.type !== "Atrule" || !rule.loc) return
		let name = rule.name.toLowerCase()
		let from = rule.loc.start.offset
		let to = rule.loc.end.offset
		if (["import", "font-face", "page"].includes(name)) {
			let globalRule = css.slice(from, to)
			for (let wrapper of [...wrappers].reverse())
				globalRule = `${wrapper}{\n${globalRule}\n}`
			globalRules.push(globalRule)
			spans.push({ from, to, replacement: "" })
		} else if (
			["media", "supports", "layer"].includes(name) &&
			rule.block?.loc
		) {
			let wrapper = css.slice(from, rule.block.loc.start.offset)
			rule.block.children.forEach(child =>
				collectGlobalRules(child, [...wrappers, wrapper]),
			)
		}
	}

	let scopedCss = css
	for (let span of spans.sort((a, b) => b.from - a.from))
		scopedCss =
			scopedCss.slice(0, span.from) +
			span.replacement +
			scopedCss.slice(span.to)
	return { globalRules, scopedCss }
}
