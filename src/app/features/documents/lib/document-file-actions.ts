import { readAssetBlob } from "@/app/features/assets"
import {
	exportComments,
	importComments,
} from "@/app/features/import-export/lib/comment-format"
import { sharingRequest } from "@/app/features/sharing"
import { createSpaceDocument } from "@/app/features/spaces"
import type { RefObject } from "react"
import type { useNavigate } from "@tanstack/react-router"
import { unfoldEffect } from "@codemirror/language"
import {
	parseFrontmatter,
	getFrontmatterRange,
	getFrontmatterInsertion,
	getFrontmatterFieldValueRange,
	type MarkdownEditorRef,
} from "@/app/features/editor"
import { exportDocument, type ExportAsset } from "@/app/features/import-export"
import {
	app,
	createDocument,
	readDocument,
	setPinned,
	type Database,
	type LibraryDocument,
} from "./library"
import { watchWrite } from "./writes"
import { getDocumentTitle, addCopyToTitle } from "./title"
export {
	getExistingFolders,
	getExportAssets,
	makeAddTag,
	makeDelete,
	makeDownload,
	makeDuplicate,
	makeLeave,
	makeMoveToSpace,
	makeOpenTimeMachine,
	makeRename,
	makeTogglePin,
	makeTurnIntoPresentation,
}
export type { EditorRef, LoadedDocument }
type LoadedDocument = LibraryDocument
type EditorRef = RefObject<MarkdownEditorRef | null>
function makeOpenTimeMachine(
	doc: LoadedDocument,
	navigate: ReturnType<typeof useNavigate>,
	setLeftOpen: (open: boolean) => void,
	setRightOpen: (open: boolean) => void,
	setLeftOpenMobile: (open: boolean) => void,
	setRightOpenMobile: (open: boolean) => void,
) {
	return function handleOpenTimeMachine() {
		setLeftOpen(false)
		setRightOpen(false)
		setLeftOpenMobile(false)
		setRightOpenMobile(false)
		navigate({
			to: "/doc/$id/timemachine",
			params: { id: doc.id },
		})
	}
}

function makeRename(
	editor: EditorRef,
	isMobile: boolean,
	setRightOpenMobile: (open: boolean, callback?: () => void) => void,
) {
	return function handleRename() {
		runWithMobileClose(isMobile, setRightOpenMobile, () => {
			let view = editor.current?.getEditor()
			if (!view) return

			let content = view.state.doc.toString()
			let { frontmatter, body } = parseFrontmatter(content)

			if (!frontmatter) {
				let inferredTitle = getInferredTitle(content)
				let newFrontmatter = `---\ntitle: ${inferredTitle}\n---\n\n`
				view.dispatch({ changes: { from: 0, to: 0, insert: newFrontmatter } })
				let titleStart = 4 + 7
				let titleEnd = titleStart + inferredTitle.length
				view.dispatch({ selection: { anchor: titleStart, head: titleEnd } })
				view.focus()
				return
			}

			if (!frontmatter.title) {
				let inferredTitle = getInferredTitle(body)
				let insertion = getFrontmatterInsertion(content)
				if (!insertion) return
				let insertPos = insertion.position
				let titleLine = `${insertion.indentation}title: ${inferredTitle}\n`
				view.dispatch({
					changes: { from: insertPos, to: insertPos, insert: titleLine },
				})
				let range = getFrontmatterRange(view.state)
				if (range)
					view.dispatch({
						effects: unfoldEffect.of({ from: range.from, to: range.to }),
					})
				let titleStart = insertPos + insertion.indentation.length + 7
				let titleEnd = titleStart + inferredTitle.length
				view.dispatch({ selection: { anchor: titleStart, head: titleEnd } })
				view.focus()
				return
			}

			let range = getFrontmatterRange(view.state)
			if (range)
				view.dispatch({
					effects: unfoldEffect.of({ from: range.from, to: range.to }),
				})
			let titleRange = getFrontmatterFieldValueRange(content, "title")
			if (titleRange) {
				view.dispatch({
					selection: { anchor: titleRange.from, head: titleRange.to },
				})
			}
			view.focus()
		})
	}
}

function makeTogglePin(db: Database, ownerId: string, doc: LoadedDocument) {
	return () => setPinned(db, ownerId, doc, !doc.pinned)
}

function makeAddTag(
	editor: EditorRef,
	isMobile: boolean,
	setRightOpenMobile: (open: boolean, callback?: () => void) => void,
) {
	return function handleAddTag() {
		runWithMobileClose(isMobile, setRightOpenMobile, () => {
			let view = editor.current?.getEditor()
			if (!view) return

			let content = view.state.doc.toString()
			let { frontmatter } = parseFrontmatter(content)
			let tag = "your_tag"

			if (!frontmatter) {
				let newFrontmatter = `---\ntags: ${tag}\n---\n\n`
				view.dispatch({ changes: { from: 0, to: 0, insert: newFrontmatter } })
				let tagStart = 4 + 6
				let tagEnd = tagStart + tag.length
				view.dispatch({ selection: { anchor: tagStart, head: tagEnd } })
				view.focus()
				return
			}

			if (!frontmatter.tags) {
				let insertion = getFrontmatterInsertion(content)
				if (!insertion) return
				let insertPos = insertion.position
				let tagsLine = `${insertion.indentation}tags: ${tag}\n`
				view.dispatch({
					changes: { from: insertPos, to: insertPos, insert: tagsLine },
				})
				let range = getFrontmatterRange(view.state)
				if (range)
					view.dispatch({
						effects: unfoldEffect.of({ from: range.from, to: range.to }),
					})
				let tagStart = insertPos + insertion.indentation.length + 6
				let tagEnd = tagStart + tag.length
				view.dispatch({ selection: { anchor: tagStart, head: tagEnd } })
				view.focus()
				return
			}

			let tagsRange = getFrontmatterFieldValueRange(content, "tags")
			if (tagsRange) {
				let existingTags = content
					.slice(tagsRange.from, tagsRange.to)
					.replace(/[,\s]+$/, "")
				let newTags = existingTags ? `${existingTags}, ${tag}` : tag
				view.dispatch({
					changes: { from: tagsRange.from, to: tagsRange.to, insert: newTags },
				})
				let range = getFrontmatterRange(view.state)
				if (range)
					view.dispatch({
						effects: unfoldEffect.of({ from: range.from, to: range.to }),
					})
				let tagStart = tagsRange.from + newTags.length - tag.length
				let tagEnd = tagStart + tag.length
				view.dispatch({ selection: { anchor: tagStart, head: tagEnd } })
				view.focus()
			}
		})
	}
}

function makeTurnIntoPresentation(
	editor: EditorRef,
	isMobile: boolean,
	setRightOpenMobile: (open: boolean, callback?: () => void) => void,
) {
	return function handleTurnIntoPresentation() {
		runWithMobileClose(isMobile, setRightOpenMobile, () => {
			let view = editor.current?.getEditor()
			if (!view) return

			let content = view.state.doc.toString()
			let { frontmatter } = parseFrontmatter(content)

			if (!frontmatter) {
				let newFrontmatter = `---\nmode: present\n---\n\n`
				view.dispatch({ changes: { from: 0, to: 0, insert: newFrontmatter } })
				view.focus()
				return
			}

			let insertPos = 4
			let modeLine = `mode: present\n`
			view.dispatch({
				changes: { from: insertPos, to: insertPos, insert: modeLine },
			})
			view.focus()
		})
	}
}

function makeDownload(db: Database, doc: LoadedDocument, content: string) {
	return async function handleDownload() {
		let docAssets = await getExportAssets(db, doc)
		let title = getDocumentTitle(content)
		await exportDocument(
			content,
			title,
			docAssets.length > 0 ? docAssets : undefined,
			await exportComments(db, doc.id),
		)
	}
}

function makeDelete(
	db: Database,
	doc: LoadedDocument,
	navigate: ReturnType<typeof useNavigate>,
	spaceId?: string,
) {
	return function handleDelete() {
		watchWrite(db.update(app.documents, doc.id, { deletedAt: new Date() }))
		void (spaceId
			? navigate({ to: "/spaces/$spaceId", params: { spaceId } })
			: navigate({ to: "/" }))
	}
}

function makeLeave(
	db: Database,
	doc: LoadedDocument,
	navigate: ReturnType<typeof useNavigate>,
) {
	return async function handleLeave() {
		await sharingRequest(db, "leave", { documentId: doc.id })
		void navigate({ to: "/" })
	}
}

function makeDuplicate(
	db: Database,
	doc: LoadedDocument,
	ownerId: string,
	spaceId: string | undefined,
	navigate: ReturnType<typeof useNavigate>,
) {
	return async function handleDuplicate() {
		let loaded = await readDocument(db, doc.id)
		let content = addCopyToTitle(loaded.content)
		let copy = spaceId
			? await createSpaceDocument(db, ownerId, spaceId, content)
			: await createDocument(db, ownerId, content)
		let { copyDocumentAssets } = await import("@/app/features/assets")
		let { updateContent } = await import("./library")
		await updateContent(
			db,
			copy,
			await copyDocumentAssets(db, doc.id, copy.id, copy.content),
		)
		await importComments(
			db,
			copy.id,
			ownerId,
			await exportComments(db, doc.id),
			loaded.content,
		)
		void (spaceId
			? navigate({
					to: "/spaces/$spaceId/doc/$id",
					params: { spaceId, id: copy.id },
				})
			: navigate({ to: "/doc/$id", params: { id: copy.id } }))
	}
}

function makeMoveToSpace(
	navigate: ReturnType<typeof useNavigate>,
	currentSpaceId?: string,
) {
	return function handleMoveToSpace(
		destination: { id: string; name: string } | null,
	) {
		if (destination) {
			let docId = window.location.pathname.match(
				/\/(?:app\/)?doc\/([^/]+)/,
			)?.[1]
			if (docId) {
				navigate({
					to: "/spaces/$spaceId/doc/$id",
					params: { spaceId: destination.id, id: docId },
				})
			}
		} else if (currentSpaceId) {
			let docId = window.location.pathname.match(
				/\/(?:app\/)?doc\/([^/]+)/,
			)?.[1]
			if (docId) {
				navigate({ to: "/doc/$id", params: { id: docId } })
			}
		}
	}
}

function getExistingFolders(documents: LoadedDocument[] = []): string[] {
	let folders = new Set<string>()
	for (let doc of documents) {
		if (!doc.path) continue
		let parts = doc.path.split("/")
		for (let i = 1; i <= parts.length; i++)
			folders.add(parts.slice(0, i).join("/"))
	}
	return [...folders].sort()
}

async function getExportAssets(
	db: Database,
	doc: LoadedDocument,
): Promise<ExportAsset[]> {
	let assets = await db.all(
		app.assets.where({ documentId: doc.id }).select("id", "name"),
	)
	return Promise.all(
		assets.map(async asset => ({
			...asset,
			blob: await readAssetBlob(db, asset.id),
		})),
	)
}

function runWithMobileClose(
	isMobile: boolean,
	setRightOpenMobile: (open: boolean, callback?: () => void) => void,
	fn: () => void,
) {
	if (isMobile) {
		setRightOpenMobile(false, fn)
	} else {
		requestAnimationFrame(fn)
	}
}

function getInferredTitle(body: string): string {
	let line = body.split("\n").find(l => l.trim()) ?? ""
	return (
		line
			.replace(/^#{1,6}\s+/, "")
			.replace(/\*\*([^*]+)\*\*/g, "$1")
			.replace(/\*([^*]+)\*/g, "$1")
			.replace(/__([^_]+)__/g, "$1")
			.replace(/_([^_]+)_/g, "$1")
			.replace(/`([^`]+)`/g, "$1")
			.trim()
			.slice(0, 80) || "Untitled"
	)
}
