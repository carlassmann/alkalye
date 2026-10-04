import { frontmatter } from "./markdown"

export type StatsUnit = "words" | "sentences" | "tasks" | "hidden"
export let statsUnits: readonly StatsUnit[] = [
	"words",
	"sentences",
	"tasks",
	"hidden",
]
export interface DocumentStats {
	words: number
	sentences: number
	tasks: number
	completedTasks: number
}
export function documentStats(source: string): DocumentStats {
	let body = frontmatter(source).body
	let prose = body
		.replace(/(`{3,}|~{3,})[^\n]*\n[\s\S]*?\1[^\n]*(?:\n|$)/g, "")
		.replace(/`[^`\n]+`/g, "")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/^#+\s*/gm, "")
	let tasks = [...body.matchAll(/^\s*[-*+]\s+\[([ xX])\]/gm)]
	return {
		words: body.trim().split(/\s+/).filter(Boolean).length,
		sentences: prose.split(/[.!?]+(?:\s|$)/).filter(sentence => sentence.trim())
			.length,
		tasks: tasks.length,
		completedTasks: tasks.filter(task => task[1] !== " ").length,
	}
}
export function statValue(stats: DocumentStats, unit: StatsUnit) {
	return unit === "hidden"
		? ""
		: unit === "tasks"
			? `${stats.completedTasks} / ${stats.tasks}`
			: String(stats[unit])
}
