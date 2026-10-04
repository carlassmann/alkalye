import { html, joinMarkup, translate } from "../language"

import type { DocumentRecord } from "../../shared/model"
import { button, element, updateMarkup } from "../dom"
import { icon } from "../icons"
import { PickerElement, pickerMarkup } from "./menu"
export type DocumentSummary = Omit<DocumentRecord, "content"> & {
	excerpt: string
}
export function libraryMarkup(name: string, filter: string) {
	return html` <aside data-library class="library" aria-label="Documents">
		<header class="library-header">
			<a class="brand" href="/app" title="Alkalye">Alkalye</a>
			<div class="library-actions">
				<alkalye-menu align="end">
					${button("library-menu", translate("File options"), icon("ellipsis"), 'aria-expanded="false"')}
					<div
						id="file-options"
						class="library-menu menu-popover"
						popover
						role="menu"
						aria-label="File options"
					>
						${button("import", translate("Import"), html`${icon("upload")}<span>${translate("Import")}</span>`)}${button("export-all", translate("Export all"), html`${icon("download")}<span>${translate("Export all")}</span>`)}
					</div>
				</alkalye-menu>
				<button
					type="button"
					class="primary new-button"
					data-action="new"
					title="${translate("New document")}"
					aria-label="${translate("New document")}"
				>
					${icon("plus")}<span>${translate("New")}</span>
				</button>
			</div>
		</header>
		<div class="workspace-row">
			<alkalye-workspace-menu></alkalye-workspace-menu
			>${button("manage-workspace", translate("Workspace settings"), icon("settings"))}
		</div>
		<div class="search-row">
			<label class="search"
				>${icon("search")}<input
					id="search"
					type="search"
					placeholder="${translate("Find")}"
					aria-label="${translate("Find documents")}"
					value="${filter}"
			/></label>
			${button("folders", "Folder / flat view", icon("folder"))}${button("library-options", "Sort and filter", icon("sliders-horizontal"), 'aria-expanded="false"')}
		</div>
		<div class="library-options" hidden>
			${pickerMarkup(
				"order",
				translate("Sort documents"),
				[
					{ value: "updated", label: translate("Recently edited") },
					{ value: "title", label: translate("Title") },
					{ value: "created", label: translate("Created") },
				],
				"updated",
			)}${pickerMarkup(
				"type",
				translate("Document type"),
				[
					{ value: "all", label: translate("All types") },
					{ value: "document", label: translate("Documents") },
					{ value: "slides", label: translate("Slides") },
					{ value: "whiteboard", label: translate("Whiteboards") },
				],
				"all",
			)}${button("archive-toggle", "Show archive", html`${icon("archive")}<span>${translate("Archive")}</span>`)}${button("trash-toggle", "Show trash", html`${icon("trash-2")}<span>${translate("Trash")}</span>`)}${button("new-folder", "Create folder", icon("folder-plus"))}
		</div>
		<div id="folder-status" class="folder-status" hidden></div>
		<div id="document-list" class="document-list"></div>
		<footer class="profile">
			${button(
				"settings",
				name,
				html`<span class="avatar">${icon("cloud")}</span>
					<span class="profile-name"
						>${name}<small id="sync-status"> </small>
					</span>
					${icon("chevron-up")}`,
			)}
		</footer>
	</aside>`
}
export function updateLibrary(
	documents: readonly (DocumentRecord | DocumentSummary)[],
	selected: string,
	filter: string,
	showArchive: boolean,
	options: {
		order: string
		folders: boolean
		paths?: string[]
		collapsed?: Set<string>
		type?: string
		label?: string
	} = {
		order: "updated",
		folders: true,
	},
) {
	let docs = documents
		.filter(
			doc =>
				doc.archived === showArchive &&
				(!options.type ||
					options.type === "all" ||
					options.type === doc.kind) &&
				filter
					.split(",")
					.map(term => term.trim().toLowerCase().replace(/^#/, ""))
					.every(term =>
						`${doc.title} ${"content" in doc ? doc.content : doc.excerpt} ${doc.folder} ${doc.tags?.join(" ")}`
							.toLowerCase()
							.includes(term),
					),
		)
		.sort(
			(a, b) =>
				Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
				(options.order === "title"
					? a.title.localeCompare(b.title)
					: options.order === "created"
						? (b.created ?? 0) - (a.created ?? 0)
						: b.updated - a.updated),
		)
	let folders = options.folders
		? [
				...new Set([
					...docs.map(doc => doc.folder),
					...(!filter && !showArchive ? (options.paths ?? []) : []),
				]),
			]
				.sort()
				.filter(
					path =>
						!path
							.split("/")
							.slice(0, -1)
							.some((_part, index, parts) =>
								options.collapsed?.has(parts.slice(0, index + 1).join("/")),
							),
				)
		: [""]
	for (let picker of document.querySelectorAll(
		".library-options alkalye-picker",
	))
		if (picker instanceof PickerElement)
			picker.value =
				picker.name === "order" ? options.order : options.type || "all"
	document
		.querySelector("[data-action=folders]")
		?.setAttribute("aria-pressed", String(options.folders))
	updateMarkup(
		element("#document-list"),
		docs.length || folders.some(Boolean)
			? joinMarkup(
					folders.map(
						folder =>
							html`<section>
								${
									folder
										? html`<header
												class="folder-header"
												style="--folder-depth:${folder.split("/").length - 1}"
											>
												<button
													class="folder-label"
													data-action="folder-toggle:${folder}"
													aria-expanded="${!options.collapsed?.has(folder)}"
												>
													${icon(options.collapsed?.has(folder) ? "chevron-right" : "chevron-down")}${icon("folder")}<span
														>${folder.split("/").at(-1)}</span
													></button
												><button
													data-folder="${folder}"
													aria-label="Folder actions"
												>
													${icon("ellipsis")}
												</button>
											</header>`
										: showArchive || options.label
											? html`<h3 class="folder-label">
													${translate(options.label ?? "Archive")}
												</h3>`
											: ""
								}${joinMarkup(
									docs
										.filter(
											doc =>
												!options.folders ||
												(doc.folder === folder &&
													!options.collapsed?.has(folder)),
										)
										.map(
											doc =>
												html`<button
													class="document-row ${doc.id === selected ? "active" : ""}"
													data-doc="${doc.id}"
												>
													<small class="document-date"
														>${relativeDate(doc.updated)}</small
													><strong>${doc.title}</strong
													>${doc.pinned ? html`<span class="document-pin">${icon("pin")}</span>` : ""}${doc.tags?.length ? html`<small class="document-tags">${doc.tags.join(" · ")}</small>` : ""}
												</button>`,
										),
									"",
								)}
							</section>`,
					),
					"",
				)
			: html`<div class="empty-list">
					${showArchive ? "No archived documents" : filter ? "No matching documents" : "Your next thought starts here."}
				</div>`,
	)
}

function relativeDate(time: number) {
	if (!time) return ""
	let day = 86_400_000
	let today = new Date()
	today.setHours(0, 0, 0, 0)
	let difference = today.getTime() - time
	if (difference <= 0) return translate("Today")
	if (difference <= day) return translate("Yesterday")
	return new Date(time).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		...(new Date(time).getFullYear() === today.getFullYear()
			? {}
			: { year: "numeric" }),
	})
}
