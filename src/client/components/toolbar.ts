import { button } from "../dom"
import { icon } from "../icons"
import { html, translate } from "../language"
export function toolbarMarkup() {
	return html` <header data-toolbar class="toolbar">
		<div class="toolbar-side">
			${button("library", translate("Documents"), html`<span class="closed-icon">${icon("list")}</span><span class="open-icon">${icon("panel-left")}</span>`)}<span
				id="document-title"
			>
			</span>
		</div>
		<nav class="formatting" aria-label="Formatting">
			${button("bold", translate("Bold"), icon("bold"))}${button("italic", translate("Italic"), icon("italic"))}${button("code", "Code", icon("code"), 'class="wide-only"')}${button("heading", translate("Heading"), icon("heading"), 'class="wide-only"')}${button("bullet", "Bullet list", icon("list"))}${button("task", "Task list", icon("list-todo"), 'class="wide-only"')}${button("link", "Link", icon("link"), 'class="wide-only"')}${button("syntax-theme", "Syntax colors", icon("code-xml"))}${button("preview", translate("Preview"), icon("eye"))}
		</nav>
		<div class="toolbar-side end">
			${button("toggle-tools", translate("Document tools"), icon("wrench"))}
		</div>
	</header>`
}
