import {
	getPath,
	getTags,
	parseFrontmatter,
} from "@/app/features/editor/lib/frontmatter"
import { getDocumentTitle } from "./title"

export { documentMetadata }

function documentMetadata(content: string) {
	let frontmatter = parseFrontmatter(content).frontmatter
	return {
		title: getDocumentTitle(content),
		tags: getTags(content),
		path: getPath(content),
		frontmatterPinned: frontmatter?.pinned === true,
		isPresentation: frontmatter?.mode === "present",
	}
}
