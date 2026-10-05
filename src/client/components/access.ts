import { html, joinMarkup } from "../language"
import { publicMember } from "../../shared/workspace"
import { pickerMarkup } from "./menu"

export function documentAccessMarkup(
	owner: string,
	fields: Record<string, string>,
	subject: string,
	link: string,
	name: (subject: string) => string,
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
		<p>Owner <span>${owner === subject ? "You" : name(owner)}</span></p>
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
								<span data-access-person="${field.slice(7)}"
									>${name(field.slice(7))}</span
								><span>${value}</span
								><button type="button" data-remove-access="${field.slice(7)}">
									Remove
								</button>
							</li>`,
					),
			)}
		</ul>
		<details>
			<summary>Add by account ID</summary>
			<label
				>Account ID<input name="member" pattern="[\\w-]+" autocomplete="off"
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
		</details>
	</section>`
}
