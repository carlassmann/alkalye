import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import * as FiberSet from "effect/FiberSet"
import type { WorkspaceSnapshot } from "../../shared/workspace"
import { setMarkup } from "../dom"
import { icon } from "../icons"
import { html, joinMarkup, translate } from "../language"
import { confirmDialog, openDialog } from "./dialog"
import { PickerElement, pickerMarkup } from "./menu"
import { screenIcon } from "./screen-icons"
import { avatarLayout, cropAvatar, spaceAvatar } from "./space-avatar"

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
	readonly changes?: Stream.Stream<unknown>
	readonly load: Effect.Effect<WorkspaceSnapshot, unknown>
	readonly rename: (name: string) => Effect.Effect<unknown, unknown>
	// Sets or, with null, removes the space's avatar.
	readonly avatar?: (image: string | null) => Effect.Effect<unknown, unknown>
	readonly member: (
		member: string,
		role: "writer" | "reader" | null,
	) => Effect.Effect<unknown, unknown>
	readonly leave: Effect.Effect<unknown, unknown>
	// Permanently deletes the workspace; the Danger Zone offers it only when
	// the root can.
	readonly remove?: (name: string) => Effect.Effect<unknown, unknown>
	readonly invitations: Effect.Effect<HTMLElement, unknown>
	readonly report: (error: unknown) => void
	readonly dialog?: HTMLDialogElement
}

// The original's space settings page: the name, the members with their
// roles, and the Danger Zone. Owners edit; writers and readers see their role
// and can leave.
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
					let rendering = yield* Semaphore.make(1)
					let events = yield* Effect.acquireRelease(
						Effect.sync(() => new AbortController()),
						abort => Effect.sync(() => abort.abort()),
					)
					let space: WorkspaceSnapshot | undefined
					let uploading = false
					let dialog = () =>
						options.dialog ??
						document.querySelector<HTMLDialogElement>("dialog[data-dialog]") ??
						undefined
					// Saving re-renders the page; keyboard focus returns to the
					// same member's control or the same field.
					let perform = (work: Effect.Effect<unknown, unknown>) => {
						let focused =
							document.activeElement instanceof HTMLElement &&
							host.contains(document.activeElement)
								? document.activeElement
								: null
						let member =
							focused?.closest<HTMLElement>("[data-member-row]")?.dataset
								.memberRow
						let key = member
							? `[data-member-row="${CSS.escape(member)}"] button`
							: focused?.closest("[data-rename]")
								? "[data-rename] input"
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
					let render = rendering.withPermits(1)(
						Effect.gen(function* () {
							if (options.local) return frame(localMarkup(options))
							space = yield* options.load
							frame(spaceMarkup(space, options, uploading))
						}),
					)
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
										<h1>${translate("Space Settings")}</h1>
									</div>
								</header>
								<div class="settings-content">${content}</div>`,
						)
					}
					function invite() {
						let target = dialog()
						if (!target) return
						openDialog(
							target,
							options.report,
							() => {},
							translate("Invite"),
							html`<div class="space-invitations" data-invitation-slot></div>
								<div class="space-add-member" data-add-member>
									<label
										>${translate("Add by account ID")}<input
											name="member"
											autocomplete="off"
											pattern="[\\w:.\\-]+"
									/></label>
									<div class="space-add-row">
										${pickerMarkup(
											"role",
											translate("Role"),
											[
												{ value: "writer", label: translate("Writer") },
												{ value: "reader", label: translate("Reader") },
											],
											"writer",
										)}<button type="button" class="primary" data-add>
											${translate("Add")}
										</button>
									</div>
								</div>`,
						)
						let form = target.querySelector<HTMLElement>("[data-add-member]")
						let add = form?.querySelector<HTMLButtonElement>("[data-add]")
						let input = form?.querySelector<HTMLInputElement>("input")
						let picker = form?.querySelector("alkalye-picker")
						if (add && input)
							add.onclick = () => {
								let member = input.value.trim()
								if (!member || !input.checkValidity())
									return input.reportValidity()
								add.disabled = true
								let role: "reader" | "writer" =
									picker instanceof PickerElement && picker.value === "reader"
										? "reader"
										: "writer"
								run(
									options.member(member, role).pipe(
										Effect.andThen(render),
										Effect.andThen(Effect.sync(() => target.close())),
										Effect.catch(error =>
											Effect.sync(() => options.report(error)),
										),
										Effect.ensuring(
											Effect.sync(() => {
												add.disabled = false
											}),
										),
									),
								)
							}
						run(
							options.invitations.pipe(
								Effect.tap(panel =>
									Effect.sync(() =>
										target
											.querySelector("[data-invitation-slot]")
											?.replaceChildren(panel),
									),
								),
								Effect.catch(error => Effect.sync(() => options.report(error))),
							),
						)
					}
					function editMember(member: string) {
						let target = dialog()
						let role = space?.members.find(
							value => value.member === member,
						)?.role
						if (!target || !role) return
						openDialog(
							target,
							options.report,
							() => {},
							translate("Edit member"),
							html`<p class="muted">
									${translate("Change permissions or remove")}
									<span title="${member}"
										>${space?.members.find(person => person.member === member)?.name || "Anonymous writer"}</span
									>
									${translate("from this space.")}
								</p>
								<label class="space-role-label"
									>${translate("Role")}
									${pickerMarkup(
										"role",
										translate("Role"),
										[
											{ value: "writer", label: translate("Writer") },
											{ value: "reader", label: translate("Reader") },
										],
										role,
									)}</label
								>
								<button type="button" class="danger" data-remove-member>
									${translate("Remove from space")}
								</button>`,
							form =>
								Effect.runPromise(
									options
										.member(
											member,
											form.get("role") === "reader" ? "reader" : "writer",
										)
										.pipe(Effect.andThen(render)),
								),
						)
						let remove = target.querySelector<HTMLButtonElement>(
							"[data-remove-member]",
						)
						if (remove)
							remove.onclick = () => {
								remove.disabled = true
								run(
									options.member(member, null).pipe(
										Effect.andThen(render),
										Effect.andThen(Effect.sync(() => target.close())),
										Effect.catch(error =>
											Effect.sync(() => options.report(error)),
										),
										Effect.ensuring(
											Effect.sync(() => {
												remove.disabled = false
											}),
										),
									),
								)
							}
					}
					function chooseAvatar(file: File) {
						let target = dialog()
						let save = options.avatar
						if (!target || !save) return
						let saveAvatar = save
						let url = URL.createObjectURL(file)
						openDialog(
							target,
							options.report,
							() => {},
							translate("Crop avatar"),
							html`<p class="muted">
									${translate("Drag to reposition, scroll or pinch to zoom.")}
								</p>
								<div
									data-avatar-cropper
									tabindex="0"
									role="img"
									aria-label="${translate("Drag to reposition, scroll or pinch to zoom.")}"
								>
									<img alt="" src="${url}" /><span
										class="avatar-crop-window"
									></span>
								</div>`,
							() => {
								let image = cropper.crop()
								uploading = true
								if (space) frame(spaceMarkup(space, options, uploading))
								run(
									saveAvatar(image).pipe(
										Effect.ensuring(
											Effect.sync(() => {
												uploading = false
											}),
										),
										Effect.andThen(render),
										Effect.catch(error =>
											Effect.sync(() => {
												options.report(error)
												if (space) frame(spaceMarkup(space, options, uploading))
											}),
										),
									),
								)
								return Promise.resolve()
							},
						)
						let cropper = avatarCropper(target)
						target.addEventListener(
							"close",
							() => {
								cropper.dispose()
								URL.revokeObjectURL(url)
							},
							{ once: true },
						)
					}
					function removeAvatar() {
						let target = dialog()
						let save = options.avatar
						if (!target || !save) return
						let saveAvatar = save
						run(
							confirmDialog(
								target,
								translate(
									"The space avatar will be removed and replaced with initials.",
								),
								translate("Remove"),
								translate("Remove avatar?"),
							).pipe(
								Effect.flatMap(confirmed =>
									confirmed
										? saveAvatar(null).pipe(Effect.andThen(render))
										: Effect.void,
								),
								Effect.catch(error => Effect.sync(() => options.report(error))),
							),
						)
					}
					function leave() {
						let target = dialog()
						if (!target || !space) return
						run(
							confirmDialog(
								target,
								translate("You will lose access to") +
									` "${space.name}" ` +
									translate(
										"and all its documents. You'll need a new invite to rejoin.",
									),
								translate("Leave"),
							).pipe(
								Effect.flatMap(confirmed =>
									confirmed ? options.leave : Effect.void,
								),
								Effect.catch(error => Effect.sync(() => options.report(error))),
							),
						)
					}
					function remove() {
						let target = dialog()
						let removeWorkspace = options.remove
						if (!target || !space || !removeWorkspace) return
						let name = space.name
						let removal = removeWorkspace(name)
						let phrase = translate("yes, delete permanently")
						openDialog(
							target,
							options.report,
							() => {},
							translate("Delete space permanently"),
							html`<p class="muted">
									${translate("This action is irreversible. All documents in this space will be permanently deleted and cannot be recovered.")}
								</p>
								<label
									>${translate("Type the space name to confirm:")}
									<strong>${name}</strong
									><input name="name" autocomplete="off" required
								/></label>
								<label
									>${translate("Type")}
									<strong>${phrase}</strong> ${translate("to confirm:")}<input
										name="phrase"
										autocomplete="off"
										required
								/></label>`,
							form =>
								String(form.get("name") ?? "").trim() === name &&
								String(form.get("phrase") ?? "")
									.trim()
									.toLowerCase() === phrase
									? Effect.runPromise(removal)
									: Promise.reject(
											new Error(translate("The confirmation does not match")),
										),
							"Delete permanently",
						)
						let form = target.querySelector("form")
						let submit =
							target.querySelector<HTMLButtonElement>("#submit-dialog")
						let nameInput =
							target.querySelector<HTMLInputElement>('[name="name"]')
						let phraseInput =
							target.querySelector<HTMLInputElement>('[name="phrase"]')
						function validate() {
							if (submit)
								submit.disabled =
									nameInput?.value !== name ||
									phraseInput?.value.toLowerCase() !== phrase
						}
						if (form) form.oninput = validate
						submit?.classList.add("destructive")
						validate()
					}
					host.addEventListener(
						"submit",
						event => {
							if (!(event.target instanceof HTMLFormElement)) return
							if (!event.target.matches("[data-rename]")) return
							event.preventDefault()
							saveName(event.target)
						},
						{ signal: events.signal },
					)
					host.addEventListener(
						"change",
						event => {
							if (
								event.target instanceof HTMLInputElement &&
								event.target.matches("[data-avatar-file]")
							) {
								let file = event.target.files?.[0]
								event.target.value = ""
								if (file) chooseAvatar(file)
								return
							}
							let form =
								event.target instanceof Element
									? event.target.closest("form[data-rename]")
									: null
							if (form instanceof HTMLFormElement) saveName(form)
						},
						{ signal: events.signal },
					)
					function saveName(form: HTMLFormElement) {
						let name = String(new FormData(form).get("name") ?? "").trim()
						if (!name || name === space?.name) return
						perform(options.rename(name))
					}
					host.addEventListener(
						"click",
						event => {
							if (!(event.target instanceof Element)) return
							let control = event.target.closest<HTMLButtonElement>(
								"button[data-workspace]",
							)
							if (!control) return
							let action = control.dataset.workspace
							if (action === "invite") invite()
							else if (action === "edit-member" && control.dataset.member)
								editMember(control.dataset.member)
							else if (action === "leave") leave()
							else if (action === "avatar-upload")
								host
									.querySelector<HTMLInputElement>("[data-avatar-file]")
									?.click()
							else if (action === "avatar-remove") removeAvatar()
							else if (action === "delete") remove()
							else if (action === "refresh" && options.local)
								perform(options.local.refresh)
							else if (action === "forget" && options.local) {
								let target = dialog()
								let forget = options.local.forget
								if (target)
									run(
										confirmDialog(
											target,
											translate(
												"Remove this folder from Alkalye? Its files stay on disk.",
											),
											translate("Remove from Alkalye"),
										).pipe(
											Effect.flatMap(confirmed =>
												confirmed ? forget : Effect.void,
											),
											Effect.catch(error =>
												Effect.sync(() => options.report(error)),
											),
										),
									)
							}
						},
						{ signal: events.signal },
					)
					frame(
						html`<p class="space-loading">${translate("Loading space...")}</p>`,
					)
					yield* render.pipe(
						Effect.catch(error => Effect.sync(() => options.report(error))),
					)
					if (options.changes)
						yield* options.changes.pipe(
							Stream.runForEach(() => {
								if (
									uploading ||
									(document.activeElement instanceof HTMLInputElement &&
										host.contains(document.activeElement))
								)
									return Effect.void
								return render.pipe(
									Effect.catch(error =>
										Effect.sync(() => options.report(error)),
									),
								)
							}),
							Effect.forkScoped(),
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

function roleLabel(role: "owner" | "writer" | "reader") {
	return translate(
		role === "owner" ? "Owner" : role === "writer" ? "Writer" : "Reader",
	)
}

function spaceMarkup(
	space: WorkspaceSnapshot,
	options: WorkspaceSettingsOptions,
	uploading: boolean,
) {
	let owner = space.owner === options.subject
	let editable = owner && !options.personal
	let members: {
		member: string
		name?: string
		source?: string
		role: "owner" | "writer" | "reader"
	}[] = [
		{ member: space.owner, name: space.ownerName, role: "owner" },
		...space.members,
	]
	return html`<section class="space-section">
			<h2>${translate("General")}</h2>
			<div class="space-panel">
				${
					editable
						? html`<form data-rename>
								<label class="space-label" for="space-name"
									>${translate("Space name")}</label
								><input
									id="space-name"
									class="space-name"
									name="name"
									value="${space.name}"
									required
									maxlength="100"
								/>
							</form>`
						: html`<label class="space-label" for="space-name"
									>${translate("Space name")}</label
								><input
									id="space-name"
									class="space-name"
									value="${space.name}"
									disabled
								/>`
				}${
					options.personal || !options.avatar
						? ""
						: html`<div class="space-avatar-field">
								<div class="space-label">${translate("Space avatar")}</div>
								<div class="space-avatar-row">
									${spaceAvatar(space.name, space.avatar, "md")}<button
										type="button"
										class="outline${uploading ? " spinning" : ""}"
										data-workspace="avatar-upload"
										${editable && !uploading ? "" : "disabled"}
									>
										${
											uploading
												? html`${icon("refresh-cw")}<span
															>${translate("Uploading...")}</span
														>`
												: html`${icon("upload")}<span
															>${translate(space.avatar ? "Change" : "Upload")}</span
														>`
										}</button
									>${
										space.avatar
											? html`<button
													type="button"
													class="outline"
													data-workspace="avatar-remove"
													${editable && !uploading ? "" : "disabled"}
												>
													${icon("trash-2")}<span>${translate("Remove")}</span>
												</button>`
											: ""
									}<input
										type="file"
										accept="image/*"
										hidden
										data-avatar-file
										aria-label="${translate("Space avatar")}"
									/>
								</div>
							</div>`
				}
			</div>
		</section>
		<section class="space-section">
			<div class="space-heading">
				<h2>${translate("Members")}</h2>
				${
					editable
						? html`<button
								type="button"
								class="outline"
								data-workspace="invite"
							>
								${screenIcon("user-round-plus")}<span
									>${translate("Invite")}</span
								>
							</button>`
						: ""
				}
			</div>
			<div class="space-panel">
				<ul class="space-members">
					${joinMarkup(
						members.map(
							member =>
								html`<li
									class="space-member"
									${member.role === "owner" ? "" : html`data-member-row="${member.member}"`}
								>
									<span class="member-name"
										><span title="${member.member}"
											>${member.name || "Anonymous writer"}</span
										>${
											member.member === options.subject
												? html`<span class="badge">${translate("You")}</span>`
												: ""
										}</span
									><span class="member-actions"
										>${
											editable &&
											member.role !== "owner" &&
											(!member.source || member.source === "direct")
												? html`<button
														type="button"
														class="outline"
														data-workspace="edit-member"
														data-member="${member.member}"
													>
														${translate("Edit")}
													</button>`
												: ""
										}<span class="member-role"
											>${roleLabel(member.role)}${member.source === "invitation" || member.source === "both" ? html`<small> · ${translate("via invitation")}</small>` : ""}</span
										></span
									>
								</li>`,
						),
					)}
				</ul>
			</div>
		</section>
		${
			options.personal || (owner && !options.remove)
				? ""
				: html`<section class="space-section">
						<h2>${translate("Danger Zone")}</h2>
						<div class="space-danger">
							${
								owner
									? html`<div class="danger-row">
											<div>
												<div class="danger-title">
													${translate("Delete space")}
												</div>
												<div class="danger-description">
													${translate("Permanently delete this space and all its documents")}
												</div>
											</div>
											<button
												type="button"
												class="danger"
												data-workspace="delete"
											>
												${translate("Delete")}
											</button>
										</div>`
									: html`<div class="danger-row">
											<div>
												<div class="danger-title">
													${translate("Leave space")}
												</div>
												<div class="danger-description">
													${translate("Remove yourself from this space")}
												</div>
											</div>
											<button
												type="button"
												class="outline"
												data-workspace="leave"
											>
												${translate("Leave")}
											</button>
										</div>`
							}
						</div>
					</section>`
		}`
}

function localMarkup(options: WorkspaceSettingsOptions) {
	let local = options.local
	return html`<section class="space-section">
			<h2>${translate("Folder")}</h2>
			<p class="space-description">
				${translate("Files are read from and saved to this folder on this device. They are not synchronized to your account.")}
			</p>
			<div class="space-panel">
				<div class="space-folder">
					${icon("folder")}<span class="member-name">${local?.name ?? ""}</span
					><span class="member-role"
						>${local?.files ?? 0} ${translate("documents")}</span
					>
				</div>
				${
					local?.message
						? html`<p class="space-description">${local.message}</p>`
						: ""
				}
				<div class="space-folder">
					<span class="member-name">${translate("Read the folder again")}</span
					><button type="button" class="outline" data-workspace="refresh">
						${icon("refresh-cw")}<span>${translate("Refresh")}</span>
					</button>
				</div>
			</div>
		</section>
		<section class="space-section">
			<h2>${translate("Danger Zone")}</h2>
			<div class="space-danger">
				<div class="danger-row">
					<div>
						<div class="danger-title">${translate("Remove from Alkalye")}</div>
						<div class="danger-description">
							${translate("Stop showing this folder in Alkalye")}
						</div>
					</div>
					<button type="button" class="outline" data-workspace="forget">
						${translate("Remove from Alkalye")}
					</button>
				</div>
			</div>
		</section>`
}

// Drag moves the image under the square window; the wheel, a pinch, or the
// keyboard (arrows move, + and - zoom) changes the zoom.
function avatarCropper(dialog: HTMLDialogElement) {
	let stage = dialog.querySelector<HTMLElement>("[data-avatar-cropper]")
	let image = stage?.querySelector("img")
	let frame = stage?.querySelector<HTMLElement>(".avatar-crop-window")
	if (!stage || !image || !frame) throw new Error("Avatar cropper missing")
	let surface = stage,
		picture = image,
		square = frame
	let events = new AbortController()
	let view = { zoom: 1, x: 0, y: 0 }
	let pointers = new Map<number, { x: number; y: number }>()
	let pinch = 0
	function layout() {
		let natural = {
			width: picture.naturalWidth || 1,
			height: picture.naturalHeight || 1,
		}
		return avatarLayout({
			width: surface.clientWidth,
			height: surface.clientHeight,
			image: natural,
			...view,
		})
	}
	function paint() {
		let current = layout()
		view = { zoom: current.zoom, x: current.x, y: current.y }
		square.style.width = square.style.height = current.size + "px"
		picture.style.width = picture.naturalWidth * current.scale + "px"
		picture.style.height = picture.naturalHeight * current.scale + "px"
		picture.style.left = current.left + "px"
		picture.style.top = current.top + "px"
	}
	picture.addEventListener("load", paint, { signal: events.signal })
	if (picture.complete) paint()
	surface.addEventListener(
		"pointerdown",
		event => {
			pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
			pinch = spread()
			if (event.isTrusted) surface.setPointerCapture(event.pointerId)
		},
		{ signal: events.signal },
	)
	surface.addEventListener(
		"pointermove",
		event => {
			let previous = pointers.get(event.pointerId)
			if (!previous) return
			pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
			if (pointers.size > 1) {
				let distance = spread()
				if (pinch > 0) view.zoom *= distance / pinch
				pinch = distance
			} else {
				view.x += event.clientX - previous.x
				view.y += event.clientY - previous.y
			}
			paint()
		},
		{ signal: events.signal },
	)
	for (let type of ["pointerup", "pointercancel"])
		surface.addEventListener(
			type,
			event => {
				if (event instanceof PointerEvent) pointers.delete(event.pointerId)
				pinch = spread()
			},
			{ signal: events.signal },
		)
	surface.addEventListener(
		"wheel",
		event => {
			event.preventDefault()
			view.zoom *= Math.exp(-event.deltaY * 0.002)
			paint()
		},
		{ signal: events.signal, passive: false },
	)
	surface.addEventListener(
		"keydown",
		event => {
			let step = event.shiftKey ? 40 : 10
			let moves: Record<string, () => void> = {
				ArrowLeft: () => (view.x += step),
				ArrowRight: () => (view.x -= step),
				ArrowUp: () => (view.y += step),
				ArrowDown: () => (view.y -= step),
				"+": () => (view.zoom *= 1.1),
				"=": () => (view.zoom *= 1.1),
				"-": () => (view.zoom /= 1.1),
			}
			let move = moves[event.key]
			if (!move) return
			event.preventDefault()
			move()
			paint()
		},
		{ signal: events.signal },
	)
	function spread() {
		let [first, second] = [...pointers.values()]
		return first && second
			? Math.hypot(first.x - second.x, first.y - second.y)
			: 0
	}
	return {
		crop: () => cropAvatar(picture, layout().crop),
		dispose: () => events.abort(),
	}
}
