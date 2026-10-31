import type { RefObject } from "react"
import type { useNavigate } from "@tanstack/react-router"
import { co, Group } from "jazz-tools"
import { toast } from "sonner"
import { unfoldEffect } from "@codemirror/language"
import { Document, UserAccount } from "@/schema"
import { leavePersonalDocument } from "@/app/features/sharing"
import {
	parseFrontmatter,
	togglePinned,
	getFrontmatterRange,
	getFrontmatterInsertion,
	getFrontmatterFieldValueRange,
	type MarkdownEditorRef,
} from "@/app/features/editor"
import { exportDocument, type ExportAsset } from "@/app/features/import-export"
import {
	applyContentDiffWithCommentAnchors,
	copyCommentsAndApplyContent,
	getExportComments,
} from "@/app/features/comments"
import { serializeAsset } from "@/app/features/assets"
import { readDocumentText } from "./document-text"
import { getDocumentTitle, addCopyToTitle } from "./title"
import { createDocumentMetadata, syncDocumentMetadata } from "./metadata"

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
export type { EditorRef, LoadedDocument, LoadedMe }

type LoadedDocument = co.loaded<
	typeof Document,
	{
		content: true
		assets: true
		comments: { $each: { replies: true } }
	}
>

type LoadedMe = co.loaded<
	typeof UserAccount,
	{ root: { documents: true; settings: true } }
>

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
			params: { id: doc.$jazz.id },
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

function makeTogglePin(docWithContent: LoadedDocument) {
	return function handleTogglePin() {
		if (!docWithContent?.$isLoaded || !docWithContent.content) return
		let content = docWithContent.content.toString()
		let newContent = togglePinned(content)
		applyContentDiffWithCommentAnchors(docWithContent, newContent)
		docWithContent.$jazz.set("updatedAt", new Date())
		syncDocumentMetadata(docWithContent)
	}
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

function makeDownload(doc: LoadedDocument, content: string) {
	return async function handleDownload() {
		let docAssets = await getExportAssets(doc)
		let title = getDocumentTitle(content)
		await exportDocument(
			content,
			title,
			docAssets.length > 0 ? docAssets : undefined,
			getExportComments(doc),
		)
	}
}

function makeDelete(
	doc: LoadedDocument,
	navigate: ReturnType<typeof useNavigate>,
	spaceId: string | undefined,
) {
	return function handleDelete() {
		doc.$jazz.set("deletedAt", new Date())
		if (spaceId) {
			navigate({ to: "/spaces/$spaceId", params: { spaceId } })
			return
		}
		navigate({ to: "/" })
	}
}

function makeLeave(
	docWithContent: LoadedDocument,
	me: LoadedMe | undefined,
	doc: LoadedDocument,
	navigate: ReturnType<typeof useNavigate>,
) {
	return async function handleLeave() {
		if (!docWithContent?.$isLoaded || !me) return
		await leavePersonalDocument(docWithContent, me)
		let idx = me.root?.documents?.findIndex(d => d?.$jazz.id === doc.$jazz.id)
		if (idx !== undefined && idx !== -1 && me.root?.documents?.$isLoaded) {
			me.root.documents.$jazz.splice(idx, 1)
		}
		navigate({ to: "/" })
	}
}

function makeDuplicate(
	doc: LoadedDocument,
	me: LoadedMe | undefined,
	spaceId: string | undefined,
	navigate: ReturnType<typeof useNavigate>,
) {
	return async function handleDuplicate() {
		if (!me?.root?.documents?.$isLoaded) return

		let content = doc.content?.$isLoaded ? readDocumentText(doc.content) : ""
		let newContent = addCopyToTitle(content)

		let now = new Date()
		let group = Group.create()
		let newDoc = Document.create(
			{
				version: 1,
				content: co.plainText().create(content, group),
				...createDocumentMetadata(newContent, now),
				createdAt: now,
				updatedAt: now,
			},
			group,
		)
		try {
			await copyCommentsAndApplyContent(doc, newDoc, newContent)
		} catch (error) {
			console.error("Failed to duplicate document:", error)
			toast.error("Failed to duplicate document")
			return
		}
		me.root.documents.$jazz.push(newDoc)

		if (spaceId) {
			navigate({
				to: "/spaces/$spaceId/doc/$id",
				params: { spaceId, id: newDoc.$jazz.id },
			})
		} else {
			navigate({ to: "/doc/$id", params: { id: newDoc.$jazz.id } })
		}
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

function getExistingFolders(me?: LoadedMe): string[] {
	if (!me?.root?.documents?.$isLoaded) return []

	let folders = new Set<string>()
	for (let doc of me.root.documents.values()) {
		if (!doc?.$isLoaded || !doc.path) continue
		folders.add(doc.path)
		let parts = doc.path.split("/")
		for (let i = 1; i < parts.length; i++) {
			folders.add(parts.slice(0, i).join("/"))
		}
	}

	return [...folders].sort()
}

async function getExportAssets(doc: LoadedDocument) {
	let docAssets: ExportAsset[] = []
	if (!doc.assets?.$isLoaded) return docAssets

	for (let asset of Array.from(doc.assets)) {
		if (!asset?.$isLoaded) continue
		let blob = await serializeAsset(asset)
		if (blob) docAssets.push({ id: asset.$jazz.id, name: asset.name, blob })
	}

	return docAssets
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
