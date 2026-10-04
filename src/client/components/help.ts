import { openDialogSession } from "../dialog-session"
import * as Effect from "effect/Effect"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import { fetchResponse } from "../../platform/http"
import type { Task } from "../../platform/tasks"
import type { Markup } from "../language"
import { html, joinMarkup, translate } from "../language"
import { keyboardShortcuts, replaceShortcutTokens } from "../shortcuts"

import { element } from "../dom"
export function openHelp(
	dialog: HTMLDialogElement,
	showDialog: (title: string, body: string | Markup) => void,
	createDocument: (title: string, content: string) => Task,
	report: (error: unknown) => void,
) {
	return Effect.gen(function* () {
		showDialog(
			"Alkalye",
			html`<p>
					Your words, on your devices. Write offline; changes sync when you
					reconnect.
				</p>
				<section data-help>
					<details>
						<summary>Keyboard shortcuts</summary>
						<dl class="help-shortcuts">
							${joinMarkup(
								keyboardShortcuts(
									navigator.platform.includes("Mac") ? "mac" : "other",
								).map(
									shortcut =>
										html`<div>
											<dt>${translate(shortcut.label)}</dt>
											<dd><kbd>${shortcut.keys}</kbd></dd>
										</div>`,
								),
								"",
							)}
							<div>
								<dt>Move / duplicate line</dt>
								<dd><kbd>Alt + ↑ / ↓</kbd> <kbd>Shift + Alt + ↑ / ↓</kbd></dd>
							</div>
							<div>
								<dt>Add cursor</dt>
								<dd><kbd>Ctrl / ⌘ + Alt + ↑ / ↓</kbd></dd>
							</div>
							<div>
								<dt>Select next occurrence</dt>
								<dd><kbd>Ctrl / ⌘ + D</kbd></dd>
							</div>
							<div>
								<dt>Undo / redo</dt>
								<dd><kbd>Ctrl / ⌘ + Z</kbd> <kbd>Ctrl / ⌘ + Shift + Z</kbd></dd>
							</div>
							<div>
								<dt>Leave the editor</dt>
								<dd><kbd>Escape, Tab</kbd></dd>
							</div>
							<div>
								<dt>Follow a document link</dt>
								<dd><kbd>Ctrl / ⌘ + click</kbd></dd>
							</div>
						</dl>
					</details>
					<p>
						<a href="/changelog" target="_blank" rel="noopener">What’s new ↗</a>
					</p>
				</section>
				<h3>Learn by editing</h3>
				<button type="button" id="tutor-alkalye">Alkalye tutor</button>
				<button type="button" id="tutor-markdown">Markdown tutor</button
				><button type="button" id="tutor-presentations">
					Presentation tutor
				</button>
				<p class="muted">
					Presentation slides use headings, code, images, tables and indented
					text. Other text is speaker notes. Separate slides with ---.
				</p>`,
		)

		let session = yield* openDialogSession(dialog, report)
		for (let slug of ["alkalye", "markdown", "presentations"])
			element(`#tutor-${slug}`).onclick = () =>
				session.run(
					Effect.gen(function* () {
						let response = yield* fetchResponse(`/docs/tutor-${slug}.md`).pipe(
							Effect.flatMap(HttpClientResponse.filterStatusOk),
						)
						let content = yield* response.text
						yield* createDocument(
							`${slug} tutor`,
							replaceShortcutTokens(content),
						)
						dialog.close()
					}),
				)
	})
}
