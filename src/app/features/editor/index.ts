import "./widgets/editor.css"

export {
	MarkdownEditor,
	useMarkdownEditorRef,
	type MarkdownEditorProps,
	type MarkdownEditorRef,
	type WikilinkDoc,
	type WikilinkResolution,
} from "./widgets/editor"
export { EditorToolbar } from "./widgets/editor-toolbar"
export { EditorStatsBadge } from "./widgets/editor-stats-badge"
export {
	FloatingActions,
	WikiLinkDialog,
	TaskAction,
	LinkAction,
	MediaAction,
	WikiLinkAction,
	type FloatingActionsProps,
	type FloatingActionsRef,
} from "./widgets/floating-actions"
export { SidebarEditMenu } from "./widgets/sidebar-edit-menu"
export { SidebarFormatMenu } from "./widgets/sidebar-format-menu"
export { SidebarEditorNavigation } from "./widgets/sidebar-editor-navigation"
export { FindPanel } from "./widgets/find-panel"

export { useFindPanel } from "./hooks/use-find-panel"

export {
	useEditorSettings,
	applyEditorSettings,
	DEFAULT_EDITOR_SETTINGS,
	type EditorSettingsData,
} from "./lib/editor-settings"

export {
	parseFrontmatter,
	getPath,
	getTags,
	getFrontmatterRange,
	togglePinned,
	addTag,
	getBacklinks,
	getBacklinksWithRange,
	setBacklinks,
	addBacklink,
	removeBacklink,
	setTheme,
	setPreset,
	type Frontmatter,
} from "./lib/frontmatter"

export {
	parseWikiLinks,
	WIKILINK_REGEX,
	type WikiLink,
} from "./lib/wikilink-parser"

export { setupKeyboardShortcuts } from "./lib/keyboard-shortcuts"
