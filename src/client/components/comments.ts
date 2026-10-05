import { html, joinMarkup, rawMarkup, translate } from "../language"

import { object, string } from "../../shared/model"
import { button } from "../dom"
import { icon } from "../icons"
export function commentsMarkup(
	comments: readonly {
		id: string
		fields: Record<string, string>
		orphaned?: boolean
	}[],
	disabled = false,
	editable = true,
	selected?: string,
) {
	let discussion = joinMarkup(
		comments.map(comment =>
			commentMarkup(comment, disabled, editable, selected === comment.id),
		),
		"\n",
	)
	return html`<section data-comments>
		<header class="comments-header">
			<strong>${translate("Comments")}</strong
			><span class="comment-count">${comments.length}</span
			>${disabled || !editable ? "" : button("comment", translate("Add comment"), icon("message-square-plus"))}${editable ? button("toggle-comments", disabled ? "Enable comments" : "Disable comments", icon(disabled ? "message-square" : "message-square-off")) : ""}
		</header>
		${
			comments.length
				? discussion
				: html`<div class="comments-empty">
						${icon("message-square-plus")}
						<p>${translate(disabled ? "Comments are off" : "No comments")}</p>
						<small
							>${translate(
								disabled
									? "Turn comments on to discuss this document."
									: "Select text, then add a comment.",
							)}</small
						>
					</div>`
		}
	</section>`
}
function commentMarkup(
	comment: {
		id: string
		fields: Record<string, string>
		orphaned?: boolean
	},
	disabled: boolean,
	editable: boolean,
	selected: boolean,
) {
	let { id, fields } = comment
	let replies = Object.entries(fields)
		.filter(([key]) => key.startsWith("reply:"))
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, value]) => replyMarkup(value))
		.join("\n")
	return html`<article
		class="comment ${fields.resolved === "true" ? "resolved" : ""}"
		data-comment="${id}"
		data-selected="${String(selected)}"
	>
		<blockquote>${fields.quote ?? ""}</blockquote>
		${comment.orphaned ? html`<small class="muted">Commented text deleted</small>` : fields.quote ? button(`jump-comment:${id}`, "Go to text", html`${icon("external-link")}<span>${translate("Go to text")}</span>`) : ""}
		<strong>${fields.author ?? translate("Writer")}</strong>
		<p>${fields.body ?? ""}</p>
		${rawMarkup(replies)}
		${
			editable
				? html`<footer>
						${disabled ? "" : button(`reply:${id}`, translate("Reply"))}${button(`${fields.resolved === "true" ? "reopen" : "resolve"}:${id}`, fields.resolved === "true" ? translate("Reopen") : translate("Resolve"))}${button(`delete-comment:${id}`, translate("Delete"))}
					</footer>`
				: ""
		}
	</article>`
}
function replyMarkup(source: string) {
	try {
		let reply = object(JSON.parse(source))
		return html`<p>
			<strong>${string(reply.author)}</strong><br />${string(reply.body)}
		</p>`
	} catch {
		return html``
	}
}
