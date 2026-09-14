import { create } from "zustand"
import { persist } from "zustand/middleware"

export { useLocalSidebarState }

interface LocalSidebarState {
	searchByWorkspace: Record<string, string>
	sortByWorkspace: Record<string, "latest" | "alphabetical">
	typeByWorkspace: Record<string, "all" | "document" | "presentation">
	collapsedFolders: string[]
	setSearch: (workspaceId: string, search: string) => void
	setSort: (workspaceId: string, sort: "latest" | "alphabetical") => void
	setType: (
		workspaceId: string,
		type: "all" | "document" | "presentation",
	) => void
	toggleFolder: (workspaceId: string, path: string) => void
	isCollapsed: (workspaceId: string, path: string) => boolean
}

let useLocalSidebarState = create<LocalSidebarState>()(
	persist(
		(set, get) => ({
			searchByWorkspace: {},
			sortByWorkspace: {},
			typeByWorkspace: {},
			collapsedFolders: [],
			isCollapsed: (workspaceId, path) =>
				get().collapsedFolders.includes(JSON.stringify([workspaceId, path])),
			setSearch: (workspaceId, search) =>
				set(state => ({
					searchByWorkspace: {
						...state.searchByWorkspace,
						[workspaceId]: search,
					},
				})),
			setSort: (workspaceId, sort) =>
				set(state => ({
					sortByWorkspace: { ...state.sortByWorkspace, [workspaceId]: sort },
				})),
			setType: (workspaceId, type) =>
				set(state => ({
					typeByWorkspace: { ...state.typeByWorkspace, [workspaceId]: type },
				})),
			toggleFolder: (workspaceId, path) =>
				set(state => {
					let key = JSON.stringify([workspaceId, path])
					return {
						collapsedFolders: state.collapsedFolders.includes(key)
							? state.collapsedFolders.filter(item => item !== key)
							: [...state.collapsedFolders, key],
					}
				}),
		}),
		{
			name: "local-sidebar-state",
			partialize: state => ({
				collapsedFolders: state.collapsedFolders,
				sortByWorkspace: state.sortByWorkspace,
				typeByWorkspace: state.typeByWorkspace,
			}),
		},
	),
)
