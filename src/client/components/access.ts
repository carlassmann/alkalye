import { html, joinMarkup } from "../language"
import { publicMember } from "../../shared/workspace"
import { pickerMarkup } from "./menu"

export function documentAccessMarkup(
	owner: string,
	fields: Record<string, string>,
	subject: string,
	link: string,
) {
	let published = Boolean(fields["access:" + publicMember])
	return html`<section data-access>
		<div class="public-access">
			<h3>Public access</h3>
			<p class="muted">
				${
					published
						? "Anyone with this link can read the document after signing in."
						: "Only people you invite can open this document."
				}
			</p>
			${
				published
					? html`<input readonly value="${link}" aria-label="Public link" />`
					: ""
			}
			<button type="button" data-public-toggle="${published ? "" : "reader"}">
				${published ? "Make private" : "Make public"}
			</button>
		</div>
		<p>Owner <code>${owner}</code></p>
		<p>
			Your account
			<input readonly value="${subject}" aria-label="Your account ID" />
		</p>
		<p>Workspace members also retain their workspace permissions.</p>
		<ul>
			${joinMarkup(
				Object.entries(fields)
					.filter(
						([field, value]) =>
							field.startsWith("access:") &&
							field !== "access:" + publicMember &&
							value,
					)
					.map(
						([field, value]) =>
							html`<li>
								<code>${field.slice(7)}</code><span>${value}</span>
							</li>`,
					),
			)}
		</ul>
		<label
			>Account ID<input
				name="member"
				required
				pattern="[\\w-]+"
				autocomplete="off"
		/></label>
		<label
			>Permission${pickerMarkup(
				"role",
				"Permission",
				[
					{ value: "writer", label: "Writer" },
					{ value: "reader", label: "Reader" },
					{ value: "remove", label: "Remove document access" },
				],
				"writer",
			)}</label
		>
	</section>`
}
