import { compileTheme, frontmatter } from "../../shared/markdown"
import { html } from "../language"
import { PickerElement, pickerMarkup } from "./menu"
import type { MenuChoice } from "./menu"
import { toast } from "./toast"
import * as Effect from "effect/Effect"
import type * as Context from "effect/Context"
import type { DocumentSession } from "../document-session"
import { withFrontmatter } from "../../shared/markdown"
import { openDialog } from "./dialog"

interface DocumentThemeOptions {
	document: string
	session: Context.Service.Shape<typeof DocumentSession>
	dialog: HTMLDialogElement
	writable(): boolean
	uuid: Effect.Effect<string, unknown>
	run(command: Effect.Effect<unknown, unknown>): Promise<unknown>
	report(error: unknown): void
	changed(): void
	workbench(id: string): void
}

export function openDocumentThemePicker(options: DocumentThemeOptions) {
	let { session, document, dialog } = options
	let themes = session.replica
		.records("theme")
		.map(theme => ({ ...theme, source: session.replica.text(theme.id) }))
	let header = frontmatter(session.replica.text(document)).values
	let selected = header["theme-id"] || header.theme || ""
	openDialog(
		dialog,
		options.report,
		options.changed,
		"Document theme",
		html`<section data-theme-picker>
			<label
				>Theme${pickerMarkup(
					"theme",
					"Theme",
					[
						{ value: "", label: "Alkalye default" },
						...themes.map(theme => ({
							value: theme.id,
							label: theme.fields.name || "Custom theme",
						})),
					],
					selected,
				)}</label
			>
			<label
				>Preset${pickerMarkup(
					"preset",
					"Preset",
					themePresets(themes.find(theme => theme.id === selected)?.source),
					header.preset ?? "",
				)}</label
			>
			<div class="button-row">
				<button type="button" id="new-theme">New custom theme</button
				><button type="button" id="edit-theme">Open workbench</button
				><label
					>Import theme<input
						id="import-theme"
						type="file"
						accept=".md,.theme.md,text/markdown"
				/></label>
			</div>
		</section>`,
		form =>
			options.run(
				session.change("Change document theme", staged => {
					if (!options.writable()) throw new Error("This document is read-only")
					return [
						staged.edit(
							document,
							withFrontmatter(staged.text(document), {
								"theme-id": String(form.get("theme") ?? ""),
								preset: String(form.get("preset") ?? ""),
							}),
						),
					]
				}),
			),
	)
	let themeSelect = dialog.querySelector('alkalye-picker[name="theme"]')
	let presetSelect = dialog.querySelector('alkalye-picker[name="preset"]')
	if (
		themeSelect instanceof PickerElement &&
		presetSelect instanceof PickerElement
	)
		themeSelect.onchange = () =>
			presetSelect.setChoices(
				themePresets(
					themes.find(theme => theme.id === themeSelect.value)?.source,
				),
				"",
			)
	let create = dialog.querySelector<HTMLButtonElement>("#new-theme")
	let edit = dialog.querySelector<HTMLButtonElement>("#edit-theme")
	let input = dialog.querySelector<HTMLInputElement>("#import-theme")
	let save = dialog.querySelector<HTMLButtonElement>("#submit-dialog")
	if (save) save.disabled = !options.writable()
	if (create) {
		create.disabled = !options.writable()
		create.onclick = () =>
			createTheme(
				'# Custom theme\n\n```css theme\n.document .content { font-family: Georgia, serif; }\n```\n\n```html document\n<article class="content" data-content></article>\n```',
			)
	}
	if (edit)
		edit.onclick = () => {
			let id = themeSelect instanceof PickerElement ? themeSelect.value : ""
			if (id) options.workbench(id)
			else toast("Choose a custom theme first")
		}
	if (input) {
		input.disabled = !options.writable()
		input.onchange = () => {
			let file = input.files?.[0]
			if (file) void file.text().then(createTheme).catch(options.report)
		}
	}
	function createTheme(source: string) {
		if (create) create.disabled = true
		return options
			.run(
				Effect.gen(function* () {
					let compiled = yield* Effect.try(() => compileTheme(source))
					let id = yield* options.uuid
					yield* session.change("Create document theme", staged => {
						if (!options.writable())
							throw new Error("This document is read-only")
						return [
							staged.set(id, "type", "theme"),
							staged.set(id, "document", document),
							staged.set(id, "name", compiled.metadata.name || "Custom theme"),
							staged.edit(id, source),
							staged.edit(
								document,
								withFrontmatter(staged.text(document), { "theme-id": id }),
							),
						]
					})
					options.workbench(id)
				}),
			)
			.catch(options.report)
			.finally(() => {
				if (create) create.disabled = !options.writable()
			})
	}
}

function themePresets(source = ""): MenuChoice[] {
	let presets = source ? compileTheme(source).metadata.presets : []
	return [
		{ value: "", label: "Automatic" },
		...presets.map(preset => ({
			value: preset.name,
			label: preset.name + " · " + preset.appearance,
		})),
	]
}
