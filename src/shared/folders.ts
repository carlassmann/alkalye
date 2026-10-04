import type { Replica } from "./crdt"
import { records, setFields } from "./documents"
import { changeMetadata } from "./document-metadata"

export function folderPath(value: string) {
	let parts = value
		.trim()
		.split("/")
		.map(part => part.trim())
		.filter(Boolean)
	if (
		parts.some(part => part === "." || part === ".." || /[\r\n\0]/.test(part))
	)
		throw new Error("Choose a folder name without traversal or line breaks")
	return parts.join("/")
}
export function folderPaths(replica: Replica) {
	let paths = new Set(
		records(replica, "folder").map(folder => folder.fields.path ?? ""),
	)
	for (let doc of replica.documents("")) paths.add(doc.folder)
	for (let path of [...paths]) {
		let parts = path.split("/")
		while (parts.length > 1) {
			parts.pop()
			paths.add(parts.join("/"))
		}
	}
	return [...paths].filter(Boolean).sort()
}
export function createFolder(replica: Replica, value: string, id: string) {
	let path = folderPath(value)
	if (!path) throw new Error("Choose a folder name")
	if (folderPaths(replica).includes(path)) return []
	return setFields(replica, id, { type: "folder", path })
}
export function moveFolder(replica: Replica, previous: string, next: string) {
	next = folderPath(next)
	if (!next) throw new Error("Choose a folder name")
	if (next.startsWith(previous + "/"))
		throw new Error("A folder cannot contain itself")
	return rewriteFolder(replica, previous, next, false)
}
export function deleteFolder(replica: Replica, path: string) {
	return rewriteFolder(
		replica,
		path,
		path.split("/").slice(0, -1).join("/"),
		true,
	)
}
function rewriteFolder(
	replica: Replica,
	previous: string,
	next: string,
	remove: boolean,
) {
	function inside(path: string) {
		return path === previous || path.startsWith(previous + "/")
	}
	let operations = []
	for (let folder of records(replica, "folder")) {
		let path = folder.fields.path ?? ""
		if (inside(path))
			operations.push(
				replica.set(
					folder.id,
					remove ? "type" : "path",
					remove ? "deleted" : next + path.slice(previous.length),
				),
			)
	}
	for (let doc of replica.documents("")) {
		if (inside(doc.folder))
			operations.push(
				...changeMetadata(replica, doc.id, {
					path: remove ? next : next + doc.folder.slice(previous.length),
				}),
			)
	}
	return operations
}
