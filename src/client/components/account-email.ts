import type * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import * as FiberSet from "effect/FiberSet"
import type { BrowserAccount } from "../browser-account"
import { setMarkup } from "../dom"
import { html } from "../language"
import { icon } from "../icons"

interface EmailOptions {
	account: Context.Service.Shape<typeof BrowserAccount>
	prepareRestore: Effect.Effect<unknown, unknown>
}
export class AccountEmailElement extends HTMLElement {
	private options: EmailOptions | undefined
	private lifetime: Fiber.Fiber<void, never> | undefined
	configure(options: EmailOptions) {
		this.options = options
		if (this.isConnected) this.connectedCallback()
	}
	connectedCallback() {
		this.dataset.accountEmail = ""
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
						events => Effect.sync(() => events.abort()),
					)
					let mode: "link" | "signIn" = "link"
					let challenge: { id: string; expires: number } | undefined
					let enabled = false
					let busy = false
					let linkedEmail: string | null = null
					let restoring = false
					setMarkup(
						host,
						html`<section class="settings-section">
							<h2>Email sign-in</h2>
							<p class="section-description">
								Use a one-time code to open your account on another device. No
								password.
							</p>
							<div class="settings-panel">
								<div class="settings-block">
									<p data-email-current role="status">
										Checking email sign-in…
									</p>
									<button type="button" class="ghost" data-email-unlink hidden>
										Unlink email
									</button>
									<p class="muted">
										Linking stores an encrypted recovery key on this server.
										Anyone with access to your email can restore this account.
										Your recovery key still works offline.
									</p>
									<div
										class="email-modes"
										role="group"
										aria-label="Email action"
									>
										<button
											type="button"
											class="outline"
											data-email-mode="link"
											aria-pressed="true"
										>
											${icon("mail")}Link this account
										</button>
										<button
											type="button"
											class="ghost"
											data-email-mode="signIn"
											aria-pressed="false"
										>
											Sign in to another account
										</button>
									</div>
									<form data-email-form>
										<label class="block-label"
											>Email<input
												name="email"
												type="email"
												autocomplete="email"
												maxlength="254"
												required
												disabled
										/></label>
										<p class="muted" data-email-description>
											Link your current account before signing in on another
											device.
										</p>
										<div data-email-verification hidden>
											<label class="block-label"
												>Eight-digit code<input
													name="code"
													inputmode="numeric"
													autocomplete="one-time-code"
													pattern="[0-9]{8}"
													maxlength="8"
											/></label>
										</div>
										<div class="settings-actions">
											<button
												type="submit"
												class="outline"
												data-email-submit
												disabled
											>
												Send code</button
											><button
												type="button"
												class="ghost"
												data-email-reset
												hidden
											>
												Use another email
											</button>
										</div>
										<p data-email-message role="status" aria-live="polite"></p>
									</form>
								</div>
							</div>
						</section>`,
					)
					let form = host.querySelector("form")
					let address = host.querySelector('input[name="email"]')
					let code = host.querySelector('input[name="code"]')
					let submit = host.querySelector("[data-email-submit]")
					let verification = host.querySelector("[data-email-verification]")
					let reset = host.querySelector("[data-email-reset]")
					let message = host.querySelector("[data-email-message]")
					let current = host.querySelector("[data-email-current]")
					let description = host.querySelector("[data-email-description]")
					if (
						!(form instanceof HTMLFormElement) ||
						!(address instanceof HTMLInputElement) ||
						!(code instanceof HTMLInputElement) ||
						!(submit instanceof HTMLButtonElement) ||
						!(verification instanceof HTMLElement) ||
						!(reset instanceof HTMLButtonElement) ||
						!message ||
						!current ||
						!description
					)
						return
					let elements = {
						form,
						address,
						code,
						submit,
						verification,
						reset,
						message,
						current,
						description,
					}
					function update() {
						elements.address.disabled = !enabled || busy || Boolean(challenge)
						elements.submit.disabled = !enabled || busy
						elements.code.disabled = busy
						elements.code.required = Boolean(challenge)
						elements.verification.hidden = !challenge
						elements.reset.hidden = !challenge
						elements.reset.disabled = busy
						elements.submit.textContent = busy
							? "Working…"
							: challenge
								? mode === "link"
									? "Verify email"
									: "Sign in"
								: "Send code"
						let unlink = host.querySelector("[data-email-unlink]")
						if (unlink instanceof HTMLButtonElement) {
							unlink.hidden = !linkedEmail
							unlink.disabled = busy
						}
						elements.description.textContent =
							mode === "link"
								? "Link your current account before signing in on another device."
								: "Use the email already linked to your account. Local documents on this device are preserved."
						for (let button of host.querySelectorAll("[data-email-mode]"))
							if (button instanceof HTMLButtonElement) {
								button.disabled =
									busy ||
									!enabled ||
									(button.dataset.emailMode === "link" &&
										options.account.state.current().status === "signedOut")
								button.setAttribute(
									"aria-pressed",
									String(button.dataset.emailMode === mode),
								)
								button.className =
									button.dataset.emailMode === mode ? "outline" : "ghost"
							}
					}
					function resetChallenge() {
						challenge = undefined
						elements.code.value = ""
						elements.message.textContent = ""
						update()
					}
					host.addEventListener(
						"click",
						event => {
							if (!(event.target instanceof Element) || busy) return
							let button = event.target.closest("[data-email-mode]")
							if (button instanceof HTMLElement) {
								mode = button.dataset.emailMode === "signIn" ? "signIn" : "link"
								resetChallenge()
							}
							if (event.target.closest("[data-email-reset]")) resetChallenge()
							if (event.target.closest("[data-email-unlink]")) {
								busy = true
								update()
								run(
									options.account.email.unlink.pipe(
										Effect.tap(() =>
											Effect.sync(() => {
												linkedEmail = null
												elements.current.textContent =
													"No email linked to this account"
												resetChallenge()
												elements.message.textContent =
													"Email unlinked. Your recovery key and documents are unchanged."
											}),
										),
										Effect.catch(error =>
											Effect.sync(() => {
												elements.message.textContent =
													error instanceof Error
														? error.message
														: "Could not unlink email"
											}),
										),
										Effect.ensuring(
											Effect.sync(() => {
												busy = false
												update()
											}),
										),
									),
								)
							}
						},
						{ signal: events.signal },
					)
					elements.form.addEventListener(
						"submit",
						event => {
							event.preventDefault()
							if (busy || !enabled || !elements.form.reportValidity()) return
							busy = true
							update()
							elements.message.textContent = ""
							run(
								Effect.gen(function* () {
									if (!challenge) {
										challenge = yield* mode === "link"
											? options.account.email.requestLink(
													elements.address.value.trim(),
												)
											: options.account.email.requestSignIn(
													elements.address.value.trim(),
												)
										elements.message.textContent =
											"Check your inbox. This code expires in five minutes."
										update()
									} else if (mode === "link") {
										let linked = yield* options.account.email.verifyLink(
											challenge.id,
											elements.code.value,
										)
										linkedEmail = linked.email
										elements.current.textContent = "Linked to " + linked.email
										resetChallenge()
										elements.message.textContent =
											"Email verified. Use it to sign in on another device."
									} else {
										yield* options.prepareRestore
										let verified = yield* options.account.email.verifySignIn(
											challenge.id,
											elements.code.value,
										)
										restoring = true
										resetChallenge()
										yield* options.account.restore(verified.recovery)
										location.assign("/app")
									}
								}).pipe(
									Effect.catch(error =>
										Effect.sync(() => {
											elements.message.textContent = restoring
												? "Could not restore the account. Request a new code to try again."
												: error instanceof Error
													? error.message
													: "Could not complete email sign-in; try again"
											restoring = false
										}),
									),
									Effect.ensuring(
										Effect.sync(() => {
											busy = false
											update()
											if (challenge && !elements.code.value)
												elements.code.focus()
										}),
									),
								),
							)
						},
						{ signal: events.signal },
					)
					yield* options.account.email.availability.pipe(
						Effect.tap(availability =>
							Effect.sync(() => {
								enabled = availability.enabled
								elements.current.textContent = enabled
									? "No email linked to this account"
									: "Email sign-in is not configured on this server."
								update()
							}),
						),
						Effect.catch(() =>
							Effect.sync(() => {
								elements.current.textContent =
									"Email sign-in is unavailable while offline."
								update()
							}),
						),
					)
					if (enabled && options.account.state.current().status !== "signedOut")
						yield* options.account.email.status().pipe(
							Effect.tap(status =>
								Effect.sync(() => {
									linkedEmail = status.email
									elements.current.textContent = status.email
										? "Linked to " + status.email
										: "No email linked to this account"
									update()
								}),
							),
							Effect.catch(() => Effect.void),
						)
					if (options.account.state.current().status === "signedOut") {
						mode = "signIn"
						update()
					}
					yield* options.account.state.changes.pipe(
						Stream.runForEach(state =>
							Effect.sync(() => {
								if (state.status === "signedOut" && mode === "link") {
									mode = "signIn"
									resetChallenge()
								}
								update()
							}),
						),
						Effect.forkScoped,
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
customElements.define("alkalye-account-email", AccountEmailElement)
