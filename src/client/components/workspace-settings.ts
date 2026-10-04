import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as FiberSet from "effect/FiberSet"
import type { WorkspaceSnapshot } from "../../shared/workspace"
import { setMarkup } from "../dom"
import { icon } from "../icons"
import { html, joinMarkup, translate } from "../language"
import { pickerMarkup } from "./menu"

export interface WorkspaceSettingsOptions {
	readonly workspace: string
	readonly back: string
	readonly subject: string
	readonly personal: boolean
	readonly local?: {
		readonly name: string
		readonly files: number
		readonly message?: string
		readonly refresh: Effect.Effect<unknown, unknown>
		readonly forget: Effect.Effect<unknown, unknown>
	}
	readonly load: Effect.Effect<WorkspaceSnapshot, unknown>
	readonly rename: (name: string) => Effect.Effect<unknown, unknown>
	readonly member: (
		member: string,
		role: "writer" | "reader" | null,
	) => Effect.Effect<unknown, unknown>
	readonly leave: Effect.Effect<unknown, unknown>
	readonly invitations: Effect.Effect<HTMLElement, unknown>
	readonly report: (error: unknown) => void
}

// The original's space settings page: everything about one workspace, with
// owner-only controls shown only to its owner.
export class WorkspaceSettingsElement extends HTMLElement {
	private options: WorkspaceSettingsOptions | undefined
	private lifetime: Fiber.Fiber<void, never> | undefined
	configure(options: WorkspaceSettingsOptions) {
		this.options = options
		this.dataset.workspaceSettings = ""
		if (this.lifetime) {
			let previous = this.lifetime
			this.lifetime = undefined
			Effect.runFork(Fiber.interrupt(previous))
		}
		if (this.isConnected) this.connectedCallback()
	}
	connectedCallback() {
		let configured = this.options
		if (!configured || this.lifetime) return
		let options = configured
		let host = this
		this.lifetime = Effect.runFork(
			Effect.scoped(
				Effect.gen(function* () {
					let run = yield* FiberSet.makeRuntime<never>()
					let events = yield* Effect.acquireRelease(
						Effect.sync(() => new AbortController()),
						abort => Effect.sync(() => abort.abort()),
					)
					// Saving re-renders the page; keyboard focus returns to the
					// same member's control or the same form.
					let perform = (work: Effect.Effect<unknown, unknown>) => {
						let focused =
							document.activeElement instanceof HTMLElement &&
							host.contains(document.activeElement)
								? document.activeElement.closest<HTMLElement>(
										"[data-member-row], form",
									)
								: null
						let key = focused?.dataset.memberRow
							? `[data-member-row="${CSS.escape(focused.dataset.memberRow)}"] .menu-trigger`
							: focused?.matches("[data-rename]")
								? "[data-rename] input"
								: focused?.matches("[data-add-member]")
									? "[data-add-member] input"
									: undefined
						return run(
							work.pipe(
								Effect.andThen(render),
								Effect.andThen(
									Effect.sync(() => {
										if (key) host.querySelector<HTMLElement>(key)?.focus()
									}),
								),
								Effect.catch(error => Effect.sync(() => options.report(error))),
							),
						)
					}
					let render = Effect.gen(function* () {
						if (options.local) return frame(localMarkup(options))
						let space = yield* options.load
						frame(spaceMarkup(space, options))
						if (space.owner === options.subject) {
							let panel = yield* options.invitations
							host
								.querySelector("[data-invitation-slot]")
								?.replaceChildren(panel)
						}
					})
					function frame(content: ReturnType<typeof html>) {
						setMarkup(
							host,
							html`<header class="settings-header">
									<div>
										<a
											class="settings-back"
											href="${options.back}"
											aria-label="${translate("Back")}"
											>${icon("arrow-left")}</a
										>
										<h1>${translate("Workspace settings")}</h1>
									</div>
								</header>
								<div class="settings-content">${content}</div>`,
						)
					}
					host.addEventListener(
						"submit",
						event => {
							if (!(event.target instanceof HTMLFormElement)) return
							event.preventDefault()
							let data = new FormData(event.target)
							if (event.target.matches("[data-rename]"))
								perform(options.rename(String(data.get("name") ?? "").trim()))
							else if (event.target.matches("[data-add-member]")) {
								let role = data.get("role")
								perform(
									options.member(
										String(data.get("member") ?? "").trim(),
										role === "reader" ? "reader" : "writer",
									),
								)
							}
						},
						{ signal: events.signal },
					)
					host.addEventListener(
						"change",
						event => {
							let picker = event.target
							if (
								!(picker instanceof HTMLElement) ||
								!picker.dataset.member ||
								!("value" in picker) ||
								typeof picker.value !== "string"
							)
								return
							perform(
								options.member(
									picker.dataset.member,
									picker.value === "reader" ? "reader" : "writer",
								),
							)
						},
						{ signal: events.signal },
					)
					host.addEventListener(
						"click",
						event => {
							if (!(event.target instanceof Element)) return
							let control = event.target.closest<HTMLButtonElement>(
								"button[data-workspace]",
							)
							if (!control) return
							let action = control.dataset.workspace
							if (action === "remove-member" && control.dataset.member)
								perform(options.member(control.dataset.member, null))
							else if (
								action === "leave" &&
								window.confirm(translate("Leave this workspace?"))
							)
								run(
									options.leave.pipe(
										Effect.catch(error =>
											Effect.sync(() => options.report(error)),
										),
									),
								)
							else if (action === "refresh" && options.local)
								perform(options.local.refresh)
							else if (
								action === "forget" &&
								options.local &&
								window.confirm(
									translate(
										"Remove this folder from Alkalye? Its files stay on disk.",
									),
								)
							)
								run(
									options.local.forget.pipe(
										Effect.catch(error =>
											Effect.sync(() => options.report(error)),
										),
									),
								)
						},
						{ signal: events.signal },
					)
					frame(html`<p class="muted">${translate("Loading workspace…")}</p>`)
					yield* render.pipe(
						Effect.catch(error => Effect.sync(() => options.report(error))),
					)
					yield* Effect.never
				}),
			),
		)
	}
	disconnectedCallback() {
		let lifetime = this.lifetime
		this.lifetime = undefined
		if (lifetime) Effect.runFork(Fiber.interrupt(lifetime))
	}
	connectedMoveCallback() {}
}
customElements.define("alkalye-workspace-settings", WorkspaceSettingsElement)

function spaceMarkup(
	space: WorkspaceSnapshot,
	options: WorkspaceSettingsOptions,
) {
	let owner = space.owner === options.subject
	return html`<section class="settings-section">
			<h2>${translate("General")}</h2>
			<div class="settings-panel">
				${
					owner && !options.personal
						? html`<form class="settings-row" data-rename>
								<label class="field"
									>${translate("Name")}<input
										name="name"
										value="${space.name}"
										required
										maxlength="100"
								/></label>
								<button class="primary">${translate("Rename")}</button>
							</form>`
						: html`<div class="settings-row">
								<span class="row-label">${translate("Name")}</span
								><span class="row-value">${space.name}</span>
							</div>`
				}
				<div class="settings-row">
					<span class="row-label">${translate("Your role")}</span
					><span class="row-value"
						>${translate(owner ? "Owner" : space.members.find(member => member.member === options.subject)?.role === "writer" ? "Writer" : "Reader")}</span
					>
				</div>
				<div class="settings-row">
					<span class="row-label">${translate("Documents")}</span
					><span class="row-value"
						>${space.documents.filter(document => !document.deleted).length}</span
					>
				</div>
			</div>
		</section>
		${
			owner
				? html`<section class="settings-section">
							<h2>${translate("Invite with a link")}</h2>
							<div class="settings-panel" data-invitation-slot></div>
						</section>
						<section class="settings-section">
							<h2>${translate("Members")}</h2>
							<p class="section-description">
								${translate("People added by account ID. People who joined through a link appear with that link above.")}
							</p>
							<div class="settings-panel">
								<div class="settings-row">
									${icon("user")}<span class="row-label"
										>${translate("You")}</span
									><span class="muted">${translate("Owner")}</span>
								</div>
								${joinMarkup(
									space.members.map(
										member =>
											html`<div
												class="settings-row"
												data-member-row="${member.member}"
											>
												${icon("user")}<code class="row-label"
													>${member.member}</code
												>${pickerMarkup(
													"role",
													translate("Role"),
													[
														{ value: "writer", label: translate("Writer") },
														{ value: "reader", label: translate("Reader") },
													],
													member.role,
													member.member,
												)}<button
													type="button"
													data-workspace="remove-member"
													data-member="${member.member}"
												>
													${translate("Remove")}
												</button>
											</div>`,
									),
								)}
								<form class="settings-row stacked" data-add-member>
									<label class="field"
										>${translate("Add by account ID")}<input
											name="member"
											required
											pattern="[\\w:.\\-]+"
											autocomplete="off"
									/></label>
									${pickerMarkup(
										"role",
										translate("Role"),
										[
											{ value: "writer", label: translate("Writer") },
											{ value: "reader", label: translate("Reader") },
										],
										"writer",
									)}<button class="primary">${translate("Add")}</button>
								</form>
							</div>
						</section>`
				: options.personal
					? ""
					: html`<section class="settings-section">
							<h2>${translate("Leave")}</h2>
							<div class="settings-panel">
								<div class="settings-row">
									<span class="row-label"
										>${translate("Stop seeing this workspace. Access you received by link ends.")}</span
									><button type="button" data-workspace="leave">
										${translate("Leave workspace")}
									</button>
								</div>
							</div>
						</section>`
		}`
}

function localMarkup(options: WorkspaceSettingsOptions) {
	let local = options.local
	return html`<section class="settings-section">
		<h2>${translate("Folder")}</h2>
		<p class="section-description">
			${translate("Files are read from and saved to this folder on this device. They are not synchronized to your account.")}
		</p>
		<div class="settings-panel">
			<div class="settings-row">
				${icon("folder")}<span class="row-label">${local?.name ?? ""}</span
				><span class="muted"
					>${local?.files ?? 0} ${translate("documents")}</span
				>
			</div>
			${local?.message ? html`<div class="settings-row"><span class="muted">${local.message}</span></div>` : ""}
			<div class="settings-row">
				<span class="row-label">${translate("Read the folder again")}</span
				><button type="button" data-workspace="refresh">
					${icon("refresh-cw")}<span>${translate("Refresh")}</span>
				</button>
			</div>
			<div class="settings-row">
				<span class="row-label"
					>${translate("Stop showing this folder in Alkalye")}</span
				><button type="button" data-workspace="forget">
					${translate("Remove from Alkalye")}
				</button>
			</div>
		</div>
	</section>`
}
