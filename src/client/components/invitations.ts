import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as FiberSet from "effect/FiberSet"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import type {
	InvitationRole,
	InvitationSummary,
} from "../../shared/invitations"
import { setMarkup, updateMarkup } from "../dom"
import { html, joinMarkup, translate } from "../language"
import { toast } from "./toast"

export interface InvitationController {
	readonly changes?: Stream.Stream<unknown, unknown>
	readonly list: Effect.Effect<ReadonlyArray<InvitationSummary>, unknown>
	readonly create: (role: InvitationRole) => Effect.Effect<string, unknown>
	readonly revoke: (invitation: string) => Effect.Effect<unknown, unknown>
	readonly remove: (
		invitation: string,
		member: string,
	) => Effect.Effect<unknown, unknown>
	readonly report: (error: unknown) => void
}

export function invitationsElement(controller: InvitationController) {
	let element = new InvitationsElement()
	element.configure(controller)
	return element
}

// Shows link creation, the one-time link, and every active link with the
// people who joined through it. Its scope owns all pending requests.
export class InvitationsElement extends HTMLElement {
	private controller: InvitationController | undefined
	private lifetime: Fiber.Fiber<void, never> | undefined
	configure(controller: InvitationController) {
		this.controller = controller
		this.dataset.invitations = ""
	}
	connectedCallback() {
		let configured = this.controller
		if (!configured || this.lifetime) return
		let controller = configured
		let host = this
		this.lifetime = Effect.runFork(
			Effect.scoped(
				Effect.gen(function* () {
					let run = yield* FiberSet.makeRuntime<never>()
					let events = yield* Effect.acquireRelease(
						Effect.sync(() => new AbortController()),
						abort => Effect.sync(() => abort.abort()),
					)
					let created = ""
					let summaries: ReadonlyArray<InvitationSummary> = []
					let reads = yield* Semaphore.make(1)
					let refresh = Effect.suspend(() => controller.list).pipe(
						Effect.flatMap(next =>
							Effect.sync(() => {
								summaries = next
								render()
							}),
						),
						reads.withPermits(1),
					)
					setMarkup(
						host,
						html`<h3>Invite with a link</h3>
							<p class="muted">
								Anyone who opens the link and signs in joins with its role.
								Revoking a link removes everyone who joined through it.
							</p>
							<div class="invitation-create">
								<button type="button" data-invite-role="writer">
									Create writer link</button
								><button type="button" data-invite-role="reader">
									Create reader link
								</button>
							</div>
							<div class="invitation-link" hidden>
								<input readonly aria-label="Invitation link" />
								<button type="button" data-invitation-copy>Copy</button
								><button type="button" data-invitation-share hidden>
									Share
								</button>
							</div>
							<ul class="invitation-list" aria-live="polite"></ul>`,
					)
					let share = host.querySelector<HTMLButtonElement>(
						"[data-invitation-share]",
					)
					if (share) share.hidden = typeof navigator.share !== "function"
					host.addEventListener(
						"click",
						event => {
							if (!(event.target instanceof Element)) return
							let control = event.target.closest<HTMLButtonElement>("button")
							if (!control || control.disabled) return
							let role = control.dataset.inviteRole
							if (role === "writer" || role === "reader")
								perform(
									control,
									controller.create(role).pipe(
										Effect.tap(link =>
											Effect.sync(() => {
												created = link
												showLink()
											}),
										),
									),
								)
							else if (control.dataset.invitationCopy !== undefined)
								perform(
									control,
									Effect.tryPromise(() =>
										navigator.clipboard.writeText(created),
									).pipe(
										Effect.tap(() =>
											Effect.sync(() => toast(translate("Link copied"))),
										),
									),
									false,
								)
							else if (control.dataset.invitationShare !== undefined)
								perform(
									control,
									Effect.tryPromise(() => navigator.share({ url: created })),
									false,
								)
							else if (control.dataset.revoke)
								perform(control, controller.revoke(control.dataset.revoke))
							else if (control.dataset.removeMember && control.dataset.from)
								perform(
									control,
									controller.remove(
										control.dataset.from,
										control.dataset.removeMember,
									),
								)
						},
						{ signal: events.signal },
					)
					if (controller.changes)
						yield* controller.changes.pipe(
							Stream.debounce("100 millis"),
							Stream.runForEach(() =>
								refresh.pipe(
									Effect.catchCause(cause => reportFailure(controller, cause)),
								),
							),
							Effect.forkScoped({ startImmediately: true }),
						)
					yield* refresh.pipe(
						Effect.catchCause(cause => reportFailure(controller, cause)),
					)
					yield* Effect.never
					function perform(
						control: HTMLButtonElement,
						work: Effect.Effect<unknown, unknown>,
						reload = true,
					) {
						control.disabled = true
						run(
							work.pipe(
								Effect.andThen(reload ? refresh : Effect.void),
								Effect.catchCause(cause => reportFailure(controller, cause)),
								Effect.ensuring(
									Effect.sync(() => {
										control.disabled = false
									}),
								),
							),
						)
					}
					function showLink() {
						let container = host.querySelector<HTMLElement>(".invitation-link")
						let input = container?.querySelector("input")
						if (!container || !input) return
						container.hidden = !created
						input.value = created
						input.select()
					}
					function render() {
						let list = host.querySelector(".invitation-list")
						if (!list) return
						updateMarkup(
							list,
							summaries.length
								? joinMarkup(
										summaries.map(
											summary =>
												html`<li data-invitation="${summary.invitation}">
													<div>
														<strong
															>${
																summary.role === "writer"
																	? translate("Writer link")
																	: translate("Reader link")
															}</strong
														><small
															>${
																summary.members.length
																	? summary.members.length +
																		" " +
																		translate(
																			summary.members.length === 1
																				? "person joined"
																				: "people joined",
																		)
																	: translate("Pending")
															}</small
														>
													</div>
													<button
														type="button"
														data-revoke="${summary.invitation}"
													>
														Revoke
													</button>
													${
														summary.members.length
															? html`<ul>
																	${joinMarkup(
																		summary.members.map(
																			member =>
																				html`<li>
																					<span>${member.name}</span
																					><button
																						type="button"
																						data-from="${summary.invitation}"
																						data-remove-member="${member.member}"
																					>
																						Remove
																					</button>
																				</li>`,
																		),
																	)}
																</ul>`
															: ""
													}
												</li>`,
										),
									)
								: html`<li class="muted">No active links</li>`,
						)
					}
				}).pipe(Effect.catchCause(cause => reportFailure(configured, cause))),
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
customElements.define("alkalye-invitations", InvitationsElement)

function reportFailure(
	controller: InvitationController,
	cause: Cause.Cause<unknown>,
) {
	return Cause.hasFails(cause) || Cause.hasDies(cause)
		? Effect.sync(() => controller.report(Cause.squash(cause)))
		: Effect.void
}
