import { html, joinMarkup, translate } from "../language"

import type { DocumentRecord } from "../../shared/model"
import { button, element, updateMarkup } from "../dom"
import { icon } from "../icons"
import type { IconName } from "../icons"
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
			${button("folders", "Folder / flat view", icon("folder"))}
			<alkalye-menu align="end">
				${button("library-options", "Sort and filter", icon("sliders-horizontal"), 'aria-expanded="false"')}
				<div
					id="library-options"
					class="library-options menu-popover"
					popover
					role="menu"
					aria-label="Sort and filter"
				>
					${filterMenu(
						"order",
						"Sort documents",
						[
							["updated", "Recently edited"],
							["title", "Title"],
							["created", "Created"],
						],
						"updated",
					)}
					${filterMenu(
						"type",
						"Document type",
						[
							["all", "All types"],
							["document", "Documents", "file-text"],
							["slides", "Slides", "presentation"],
							["whiteboard", "Whiteboards", "pen-tool"],
						],
						"all",
					)}
					<hr />
					${button("archive-toggle", "Show archive", html`${icon("archive")}<span>${translate("Archive")}</span>`)}
					${button("trash-toggle", "Show trash", html`${icon("trash-2")}<span>${translate("Trash")}</span>`)}
					${button("new-folder", "Create folder", html`${icon("folder-plus")}<span>${translate("Create folder")}</span>`)}
				</div>
			</alkalye-menu>
		</div>
		<div id="folder-status" class="folder-status" hidden></div>
		<div id="document-list" class="document-list"></div>
		<footer class="profile">
			<alkalye-menu side="top">
				${button(
					"profile-menu",
					name,
					html`<span class="avatar">${icon("cloud")}</span>
						<span class="profile-name"
							>${name}<small id="sync-status"> </small>
						</span>
						${icon("chevron-up")}`,
				)}
				<div
					id="profile-menu"
					class="profile-menu menu-popover"
					popover
					role="menu"
					aria-label="Account"
				>
					${button("settings", "Settings", html`${icon("settings")}<span>Settings</span>`)}
					${profileChoices("appearance", "Theme", "palette", [
						["light", "Light", "sun"],
						["dark", "Dark", "moon"],
						["system", "System", "monitor"],
					])}
					${profileChoices("language", "Language", "globe", [
						["en", "English", "globe"],
						["de", "Deutsch", "globe"],
						["system", "System", "monitor"],
					])}
					<hr />
					${button("open-folder", "Open folder", html`${icon("folder-open")}<span>Open folder</span>`)}
					${button("open-file", "Open file", html`${icon("file-text")}<span>Open file</span>`)}
					<hr />
					${button("sign-in", "Sign in", html`${icon("log-in")}<span>Sign in</span>`)}
					${button("sign-out", "Log out", html`${icon("log-out")}<span>Log out</span>`)}
				</div></alkalye-menu
			>
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
	for (let choice of document.querySelectorAll<HTMLElement>(
		"[data-library-filter]",
	)) {
		let value =
			choice.dataset.libraryFilter === "order"
				? options.order
				: options.type || "all"
		choice.setAttribute("aria-checked", String(choice.dataset.value === value))
	}
	document
		.querySelector('[data-action="library-options"]')
		?.setAttribute(
			"aria-pressed",
			String(options.order !== "updated" || (options.type ?? "all") !== "all"),
		)

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

function filterMenu(
	name: string,
	label: string,
	choices: readonly (readonly [string, string, IconName?])[],
	selected: string,
) {
	return html`<div class="filter-label">${translate(label)}</div>
		${joinMarkup(choices.map(([value, title, symbol]) => html`<button type="button" role="menuitemradio" data-library-filter="${name}" data-value="${value}" aria-checked="${value === selected}">${symbol ? icon(symbol) : ""}<span>${translate(title)}</span>${icon("check")}</button>`))}
		${name === "order" ? html`<hr />` : html``}`
}

function profileChoices(
	name: string,
	label: string,
	symbol: IconName,
	choices: readonly (readonly [string, string, IconName])[],
) {
	return html`<alkalye-menu data-submenu
		><button type="button">
			${icon(symbol)}<span data-profile-label="${label}"
				>${translate(label)}</span
			>${icon("chevron-right")}
		</button>
		<div
			id="profile-${name}"
			class="menu-popover"
			popover
			role="menu"
			aria-label="${translate(label)}"
			data-profile-menu-label="${label}"
		>
			${joinMarkup(choices.map(([value, title, symbol]) => html`<button type="button" role="menuitemradio" aria-checked="false" data-action="${name}-${value}">${icon(symbol)}<span data-profile-label="${title}">${translate(title)}</span>${icon("check")}</button>`))}
		</div></alkalye-menu
	>`
}
