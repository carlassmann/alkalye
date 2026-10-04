import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as FiberSet from "effect/FiberSet"
import { InvitationRevoked } from "../../shared/invitations"
import type { InvitationAcceptance } from "../../shared/invitations"
import { setMarkup } from "../dom"
import { html, translate } from "../language"

export interface InvitationScreenOptions {
	readonly name: () => string
	readonly describe: Effect.Effect<
		{
			kind: "document" | "workspace"
			title: string
			role: string
			owner: string
		},
		unknown
	>
	readonly accept: Effect.Effect<InvitationAcceptance, unknown>
	readonly switchAccount: Effect.Effect<unknown, unknown>
	readonly accepted: (
		acceptance: InvitationAcceptance,
	) => Effect.Effect<void, unknown>
}

export function mountInvitationScreen(
	host: Element,
	options: InvitationScreenOptions,
) {
	let screen = new InvitationScreenElement()
	screen.configure(options)
	host.replaceChildren(screen)
	return screen
}

// The link holder sees what they are joining and with which account before
// anything changes; joining is explicit rather than a side effect of opening.
export class InvitationScreenElement extends HTMLElement {
	private options: InvitationScreenOptions | undefined
	private lifetime: Fiber.Fiber<void, never> | undefined
	configure(options: InvitationScreenOptions) {
		this.options = options
		this.dataset.invitationScreen = ""
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
					host.addEventListener(
						"click",
						event => {
							if (!(event.target instanceof Element)) return
							let control = event.target.closest<HTMLButtonElement>("button")
							if (!control || control.disabled) return
							control.disabled = true
							if (control.dataset.invitationAccept !== undefined) run(join)
							else if (control.dataset.invitationAccount !== undefined)
								run(
									options.switchAccount.pipe(
										Effect.andThen(describe),
										Effect.catchCause(cause => failed(cause)),
									),
								)
						},
						{ signal: events.signal },
					)
					function show(markup: ReturnType<typeof html>) {
						setMarkup(
							host,
							html`<section class="invitation-card">${markup}</section>`,
						)
					}
					let describe = Effect.gen(function* () {
						show(html`<p class="muted" role="status">Loading invitation…</p>`)
						let invitation = yield* options.describe
						show(
							html`<p class="invitation-mark" aria-hidden="true">
									${invitation.kind === "document" ? "≡" : "▤"}
								</p>
								<h1>You've been invited</h1>
								<p>
									${invitation.owner}
									${translate(
										invitation.role === "writer"
											? "invites you to edit"
											: "invites you to read",
									)}
									<strong>${invitation.title}</strong>.
								</p>
								<p class="muted">
									${translate("You will join as")}
									<strong>${options.name()}</strong>.
								</p>
								<div class="invitation-actions">
									<button type="button" class="primary" data-invitation-accept>
										${
											invitation.kind === "document"
												? translate("Open document")
												: translate("Join workspace")
										}</button
									><button type="button" data-invitation-account>
										Use another account
									</button>
								</div>`,
						)
					}).pipe(Effect.catchCause(cause => failed(cause)))
					let join = Effect.gen(function* () {
						show(html`<p class="muted" role="status">Joining…</p>`)
						let acceptance = yield* options.accept
						show(
							html`<h1>Invitation accepted</h1>
								<p class="muted">Opening…</p>`,
						)
						yield* options.accepted(acceptance)
					}).pipe(Effect.catchCause(cause => failed(cause)))
					yield* describe
					yield* Effect.never
					function failed(cause: Cause.Cause<unknown>) {
						return Effect.sync(() => {
							if (!Cause.hasFails(cause) && !Cause.hasDies(cause)) return
							let error = Cause.squash(cause)
							show(
								error instanceof InvitationRevoked
									? html`<h1>This invitation was revoked</h1>
											<p class="muted">Ask the owner for a new link.</p>
											<a class="button" href="/app">Go to Alkalye</a>`
									: html`<h1>This invitation cannot be opened</h1>
											<p class="invitation-error">
												${error instanceof Error ? error.message : String(error)}
											</p>
											<p class="muted">
												The link may be incomplete or no longer valid.
											</p>
											<a class="button" href="/app">Go to Alkalye</a>`,
							)
						})
					}
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
customElements.define("alkalye-invitation", InvitationScreenElement)
