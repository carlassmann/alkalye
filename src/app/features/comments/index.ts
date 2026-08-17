export {
	createCommentThread,
	createCommentThreadFromQuote,
	createCommentThreadFromQuoteOccurrence,
	addCommentReply,
	resolveCommentThread,
	reopenCommentThread,
	deleteCommentThread,
	areCommentsEnabled,
	setCommentsEnabled,
	getCommentRange,
	getVisibleCommentThreads,
	getUnresolvedCommentCount,
	getExportComments,
	getExportCommentsForContent,
	restoreExportedComments,
	cloneCommentThreads,
	copyCommentsAndApplyContent,
	applyContentDiffWithCommentAnchors,
	applyContentDiffLoadingCommentAnchors,
	replaceDocumentContentMappingAnchors,
	replaceDocumentContentPreservingAnchors,
	type LoadedCommentDocument,
	type LoadedAnchorDocument,
	type CommentRange,
	type ExportComment,
} from "./lib/comments"

export {
	commentsExtension,
	setCommentDecorationsEffect,
	scrollEditorCommentIntoView,
	type CommentDecoration,
} from "./lib/editor-extension"

export { SidebarComments } from "./widgets/sidebar-comments"
