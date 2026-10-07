import type * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as FiberSet from "effect/FiberSet"
import * as Schema from "effect/Schema"
import { AgentScopeSchema } from "../../shared/agent-access"
import { AccessRoleSchema } from "../../shared/workspace"
import type { BrowserAccount } from "../browser-account"
import type { BrowserLibrary } from "../browser-library"
import { setMarkup } from "../dom"
import { html, joinMarkup } from "../language"
import { icon } from "../icons"
import { pickerMarkup } from "./menu"

interface AgentOptions {
	account: Context.Service.Shape<typeof BrowserAccount>
	library: Context.Service.Shape<typeof BrowserLibrary>
	workspace?: string
	consent?: string
	report(error: unknown): void
}

// Settings → Connections: the MCP endpoint, OAuth consent requests, personal
// connection tokens and every connected client, as in the original.
export class AccountAgentsElement extends HTMLElement {
	private options: AgentOptions | undefined
	private lifetime: Fiber.Fiber<void, never> | undefined
	configure(options: AgentOptions) {
		this.options = options
		if (this.isConnected) this.connectedCallback()
	}
	connectedCallback() {
		this.dataset.accountAgents = ""
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
					let spaces = options.library.state.current().library.workspaces
					let endpoint = new URL("/mcp", options.account.origin).href
					setMarkup(
						host,
						html`<form class="settings-section" data-agent-root>
							<h2>API keys &amp; MCP</h2>
							<div class="settings-panel">
								<div class="settings-row stacked">
									${icon("globe")}
									<div>
										<p class="row-title">Connect any MCP client</p>
										<p class="muted">
											Use this URL in ChatGPT, Claude, Cursor, or any other
											MCP-compatible client.
										</p>
										<div class="copy-field">
											<code id="mcp-endpoint">${endpoint}</code
											><button type="button" data-agent="copy-endpoint">
												${icon("copy")}<span>Copy</span>
											</button>
										</div>
										<p class="muted">
											Connected clients act as you, limited to the workspaces
											and permission you approve. Disconnect a client to stop
											its access.
										</p>
									</div>
								</div>
								<div class="settings-row stacked" data-agent-form>
									${icon(options.consent ? "key-round" : "plug-zap")}
									<div>
										<p class="row-title" id="agent-description">
											${options.consent ? "Loading agent request…" : "Create an API key"}
										</p>
										<p class="muted">
											${options.consent ? "Choose what this client may open. Your own permissions still apply." : "Use the same key for the CLI and MCP clients without OAuth. Keys keep the workspace access and permission limit below."}
										</p>
										${options.consent ? "" : html`<label class="field">Name<input name="agent-name" value="Agent" maxlength="256" required /></label>`}
										<fieldset>
											<legend>Workspace access</legend>
											<label
												><input
													type="checkbox"
													name="agent-all"
													${spaces.length ? "" : "checked"}
												/>All current and future workspaces</label
											>
											${joinMarkup(spaces.map(space => html`<label><input type="checkbox" name="agent-space" value="${space.workspace}" ${space.workspace === (options.workspace || "personal-" + options.account.subject) ? "checked" : ""} />${space.name}</label>`))}
										</fieldset>
										<label class="field"
											>Permission
											limit${pickerMarkup(
												"agent-ceiling",
												"Permission limit",
												[
													{ value: "reader", label: "Reader" },
													{ value: "writer", label: "Writer" },
													{ value: "owner", label: "Owner" },
												],
												"writer",
											)}</label
										>
										<div class="agent-buttons">
											<button type="button" class="primary" data-agent="create">
												${options.consent ? "Allow access" : "Create API key"}</button
											>${options.consent ? html`<button type="button" data-agent="deny">Deny</button>` : ""}
										</div>
										${options.consent ? "" : html`<label hidden id="agent-token-label" class="field">API key (shown once)<input id="agent-token" readonly /></label><button hidden type="button" data-agent="copy">${icon("copy")}<span>Copy key</span></button>`}
									</div>
								</div>
								${
									options.consent
										? ""
										: html`<div class="settings-row stacked">
												${icon("key-round")}
												<div>
													<p class="row-title">Use your API key</p>
													<p class="muted">
														Set ALKALYE_API_KEY in your environment. You can
														revoke the key below.
													</p>
													<pre
														class="agent-cli"
													><code>export ALKALYE_SERVER=${options.account.origin}
export ALKALYE_API_KEY=YOUR_KEY
bun cli.ts doc list
bun cli.ts doc get DOCUMENT_ID
bun cli.ts doc update DOCUMENT_ID --file note.md --expected-revision REVISION
bun cli.ts mcp</code></pre>
													<p class="muted">
														The CLI uses the same scoped MCP tools. API-key
														commands run online; account login adds offline
														editing and local undo.
													</p>
												</div>
											</div>`
								}
								<ul id="agent-connections" class="agent-connections"></ul>
							</div>
						</form>`,
					)
					host.addEventListener("submit", event => event.preventDefault(), {
						signal: events.signal,
					})
					let busy = false
					let ready = false
					function buttons() {
						for (let button of host.querySelectorAll<HTMLButtonElement>(
							"[data-agent]",
						))
							button.disabled = busy || !ready
					}
					function launch(work: Effect.Effect<unknown, unknown>) {
						if (busy) return
						busy = true
						buttons()
						run(
							work.pipe(
								Effect.catch(error => Effect.sync(() => options.report(error))),
								Effect.ensuring(
									Effect.sync(() => {
										busy = false
										buttons()
									}),
								),
							),
						)
					}
					let load = options.account
						.request(options.account.api.agents.list())
						.pipe(
							Effect.tap(connections =>
								Effect.sync(() => {
									let list = host.querySelector("#agent-connections")
									if (list instanceof HTMLElement)
										setMarkup(
											list,
											html`${joinMarkup(
												connections.map(
													connection =>
														html`<li class="settings-row">
															<div>
																<p class="row-title">${connection.name}</p>
																<p class="muted">
																	API key / MCP
																	${new Date(connection.created).toLocaleDateString()}
																</p>
															</div>
															<button
																type="button"
																data-agent="revoke"
																data-connection="${connection.id}"
															>
																Disconnect
															</button>
														</li>`,
												),
											)}`,
										)
								}),
							),
						)
					host.addEventListener(
						"click",
						event => {
							if (!(event.target instanceof Element)) return
							let button =
								event.target.closest<HTMLButtonElement>("[data-agent]")
							if (!button || busy || !ready) return
							let action = button.dataset.agent
							if (action === "copy" || action === "copy-endpoint") {
								let token = host.querySelector("#agent-token")
								let text =
									action === "copy-endpoint"
										? endpoint
										: token instanceof HTMLInputElement
											? token.value
											: ""
								launch(
									Effect.tryPromise(() =>
										navigator.clipboard.writeText(text),
									).pipe(
										Effect.tap(() =>
											Effect.sync(() => {
												let label = button.querySelector("span")
												if (label) label.textContent = "Copied"
											}),
										),
									),
								)
								return
							}
							if (action === "revoke" && button.dataset.connection) {
								launch(
									options.account
										.request(
											options.account.api.agents.revoke({
												params: { id: button.dataset.connection },
											}),
										)
										.pipe(Effect.andThen(load)),
								)
								return
							}
							if (action !== "create" && action !== "deny") return
							launch(
								Effect.gen(function* () {
									let form = host.querySelector("form") ?? host.closest("form")
									if (!form) return
									let data = new FormData(form)
									let workspaces = yield* Schema.decodeUnknownEffect(
										AgentScopeSchema,
									)(
										action === "deny" || data.has("agent-all")
											? "all"
											: data.getAll("agent-space"),
									)
									let ceiling = yield* Schema.decodeUnknownEffect(
										AccessRoleSchema,
									)(data.get("agent-ceiling"))
									if (options.consent) {
										let consent = yield* options.account.request(
											options.account.api.agents.consent({
												payload: {
													request: options.consent,
													approve: action === "create",
													workspaces,
													ceiling,
												},
											}),
										)
										yield* Effect.sync(() => location.assign(consent.redirect))
										return
									}
									let created = yield* options.account.request(
										options.account.api.agents.create({
											payload: {
												name: String(data.get("agent-name") ?? "").trim(),
												workspaces,
												ceiling,
											},
										}),
									)
									let token = host.querySelector("#agent-token")
									if (token instanceof HTMLInputElement)
										token.value = created.token
									for (let control of host.querySelectorAll<HTMLElement>(
										"#agent-token-label, [data-agent=copy]",
									))
										control.hidden = false
									yield* load
								}),
							)
						},
						{ signal: events.signal },
					)
					let token = host.querySelector("#agent-token")
					yield* Effect.addFinalizer(() =>
						Effect.sync(() => {
							if (token instanceof HTMLInputElement) token.value = ""
						}),
					)
					buttons()
					if (options.consent) {
						let pending = yield* options.account.request(
							options.account.api.agents.describeConsent({
								query: { request: options.consent },
							}),
						)
						let description = host.querySelector("#agent-description")
						if (description)
							description.textContent =
								pending.name + " wants access to your documents."
						ready = true
						buttons()
					} else {
						yield* load
						ready = true
						buttons()
					}
					return yield* Effect.never
				}),
			).pipe(Effect.catch(error => Effect.sync(() => options.report(error)))),
		)
	}
	disconnectedCallback() {
		let lifetime = this.lifetime
		this.lifetime = undefined
		if (lifetime) Effect.runFork(Fiber.interrupt(lifetime))
	}
	connectedMoveCallback() {}
}
customElements.define("alkalye-account-agents", AccountAgentsElement)
