import { co } from "jazz-tools"
import { UserAccount } from "@/schema"
import { Theme } from "./schema"
import { createThemeSourceDocument } from "./source"

export {
	createDefaultTheme,
	getDefaultDocumentCss,
	getDefaultThemeCss,
	getDefaultThemeSource,
	getSlideshowBaseCss,
}

let defaultDocumentTypographyCss = `
  .content {
    color: var(--tw-prose-body);
    max-width: 65ch;
    :where(p):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      margin-top: 1.25em;
      margin-bottom: 1.25em;
    }
    :where([class~="lead"]):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      color: var(--tw-prose-lead);
      font-size: 1.25em;
      line-height: 1.6;
      margin-top: 1.2em;
      margin-bottom: 1.2em;
    }
    :where(a):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      color: var(--tw-prose-links);
      text-decoration: underline;
      font-weight: 500;
    }
    :where(strong):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      color: var(--tw-prose-bold);
      font-weight: 600;
    }
    :where(a strong):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      color: inherit;
    }
    :where(blockquote strong):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      color: inherit;
    }
    :where(thead th strong):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      color: inherit;
    }
    :where(ol):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      list-style-type: decimal;
      margin-top: 1.25em;
      margin-bottom: 1.25em;
      padding-inline-start: 1.625em;
    }
    :where(ol[type="A"]):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      list-style-type: upper-alpha;
    }
    :where(ol[type="a"]):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      list-style-type: lower-alpha;
    }
    :where(ol[type="A" s]):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      list-style-type: upper-alpha;
    }
    :where(ol[type="a" s]):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      list-style-type: lower-alpha;
    }
    :where(ol[type="I"]):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      list-style-type: upper-roman;
    }
    :where(ol[type="i"]):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      list-style-type: lower-roman;
    }
    :where(ol[type="I" s]):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      list-style-type: upper-roman;
    }
    :where(ol[type="i" s]):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      list-style-type: lower-roman;
    }
    :where(ol[type="1"]):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      list-style-type: decimal;
    }
    :where(ul):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      list-style-type: disc;
      margin-top: 1.25em;
      margin-bottom: 1.25em;
      padding-inline-start: 1.625em;
    }
    :where(ol > li):not(:where([class~="not-prose"],[class~="not-prose"] *))::marker {
      font-weight: 400;
      color: var(--tw-prose-counters);
    }
    :where(ul > li):not(:where([class~="not-prose"],[class~="not-prose"] *))::marker {
      color: var(--tw-prose-bullets);
    }
    :where(dt):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      color: var(--tw-prose-headings);
      font-weight: 600;
      margin-top: 1.25em;
    }
    :where(hr):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      border-color: var(--tw-prose-hr);
      border-top-width: 1px;
      margin-top: 3em;
      margin-bottom: 3em;
    }
    :where(blockquote):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      font-weight: 500;
      font-style: italic;
      color: var(--tw-prose-quotes);
      border-inline-start-width: 0.25rem;
      border-inline-start-color: var(--tw-prose-quote-borders);
      quotes: "\\201C""\\201D""\\2018""\\2019";
      margin-top: 1.6em;
      margin-bottom: 1.6em;
      padding-inline-start: 1em;
    }
    :where(blockquote p:first-of-type):not(:where([class~="not-prose"],[class~="not-prose"] *))::before {
      content: open-quote;
    }
    :where(blockquote p:last-of-type):not(:where([class~="not-prose"],[class~="not-prose"] *))::after {
      content: close-quote;
    }
    :where(h1):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      color: var(--tw-prose-headings);
      font-weight: 800;
      font-size: 2.25em;
      margin-top: 0;
      margin-bottom: 0.8888889em;
      line-height: 1.1111111;
    }
    :where(h1 strong):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      font-weight: 900;
      color: inherit;
    }
    :where(h2):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      color: var(--tw-prose-headings);
      font-weight: 700;
      font-size: 1.5em;
      margin-top: 2em;
      margin-bottom: 1em;
      line-height: 1.3333333;
    }
    :where(h2 strong):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      font-weight: 800;
      color: inherit;
    }
    :where(h3):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      color: var(--tw-prose-headings);
      font-weight: 600;
      font-size: 1.25em;
      margin-top: 1.6em;
      margin-bottom: 0.6em;
      line-height: 1.6;
    }
    :where(h3 strong):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      font-weight: 700;
      color: inherit;
    }
    :where(h4):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      color: var(--tw-prose-headings);
      font-weight: 600;
      margin-top: 1.5em;
      margin-bottom: 0.5em;
      line-height: 1.5;
    }
    :where(h4 strong):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      font-weight: 700;
      color: inherit;
    }
    :where(img):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      margin-top: 2em;
      margin-bottom: 2em;
    }
    :where(picture):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      display: block;
      margin-top: 2em;
      margin-bottom: 2em;
    }
    :where(video):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      margin-top: 2em;
      margin-bottom: 2em;
    }
    :where(kbd):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      font-weight: 500;
      font-family: inherit;
      color: var(--tw-prose-kbd);
      box-shadow: 0 0 0 1px var(--tw-prose-kbd-shadows), 0 3px 0 var(--tw-prose-kbd-shadows);
      font-size: 0.875em;
      border-radius: 0.3125rem;
      padding-top: 0.1875em;
      padding-inline-end: 0.375em;
      padding-bottom: 0.1875em;
      padding-inline-start: 0.375em;
    }
    :where(code):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      color: var(--tw-prose-code);
      font-weight: 600;
      font-size: 0.875em;
    }
    :where(code):not(:where([class~="not-prose"],[class~="not-prose"] *))::before {
      content: "\`";
    }
    :where(code):not(:where([class~="not-prose"],[class~="not-prose"] *))::after {
      content: "\`";
    }
    :where(a code):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      color: inherit;
    }
    :where(h1 code):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      color: inherit;
    }
    :where(h2 code):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      color: inherit;
      font-size: 0.875em;
    }
    :where(h3 code):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      color: inherit;
      font-size: 0.9em;
    }
    :where(h4 code):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      color: inherit;
    }
    :where(blockquote code):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      color: inherit;
    }
    :where(thead th code):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      color: inherit;
    }
    :where(pre):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      color: var(--tw-prose-pre-code);
      background-color: var(--tw-prose-pre-bg);
      overflow-x: auto;
      font-weight: 400;
      font-size: 0.875em;
      line-height: 1.7142857;
      margin-top: 1.7142857em;
      margin-bottom: 1.7142857em;
      border-radius: 0.375rem;
      padding-top: 0.8571429em;
      padding-inline-end: 1.1428571em;
      padding-bottom: 0.8571429em;
      padding-inline-start: 1.1428571em;
    }
    :where(pre code):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      background-color: transparent;
      border-width: 0;
      border-radius: 0;
      padding: 0;
      font-weight: inherit;
      color: inherit;
      font-size: inherit;
      font-family: inherit;
      line-height: inherit;
    }
    :where(pre code):not(:where([class~="not-prose"],[class~="not-prose"] *))::before {
      content: none;
    }
    :where(pre code):not(:where([class~="not-prose"],[class~="not-prose"] *))::after {
      content: none;
    }
    :where(table):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      width: 100%;
      table-layout: auto;
      margin-top: 2em;
      margin-bottom: 2em;
      font-size: 0.875em;
      line-height: 1.7142857;
    }
    :where(thead):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      border-bottom-width: 1px;
      border-bottom-color: var(--tw-prose-th-borders);
    }
    :where(thead th):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      color: var(--tw-prose-headings);
      font-weight: 600;
      vertical-align: bottom;
      padding-inline-end: 0.5714286em;
      padding-bottom: 0.5714286em;
      padding-inline-start: 0.5714286em;
    }
    :where(tbody tr):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      border-bottom-width: 1px;
      border-bottom-color: var(--tw-prose-td-borders);
    }
    :where(tbody tr:last-child):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      border-bottom-width: 0;
    }
    :where(tbody td):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      vertical-align: baseline;
    }
    :where(tfoot):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      border-top-width: 1px;
      border-top-color: var(--tw-prose-th-borders);
    }
    :where(tfoot td):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      vertical-align: top;
    }
    :where(th, td):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      text-align: start;
    }
    :where(figure > *):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      margin-top: 0;
      margin-bottom: 0;
    }
    :where(figcaption):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      color: var(--tw-prose-captions);
      font-size: 0.875em;
      line-height: 1.4285714;
      margin-top: 0.8571429em;
    }
    --tw-prose-body: oklch(37.3% 0.034 259.733);
    --tw-prose-headings: oklch(21% 0.034 264.665);
    --tw-prose-lead: oklch(44.6% 0.03 256.802);
    --tw-prose-links: oklch(21% 0.034 264.665);
    --tw-prose-bold: oklch(21% 0.034 264.665);
    --tw-prose-counters: oklch(55.1% 0.027 264.364);
    --tw-prose-bullets: oklch(87.2% 0.01 258.338);
    --tw-prose-hr: oklch(92.8% 0.006 264.531);
    --tw-prose-quotes: oklch(21% 0.034 264.665);
    --tw-prose-quote-borders: oklch(92.8% 0.006 264.531);
    --tw-prose-captions: oklch(55.1% 0.027 264.364);
    --tw-prose-kbd: oklch(21% 0.034 264.665);
    --tw-prose-kbd-shadows: color-mix(in oklab, oklch(21% 0.034 264.665) 10%, transparent);
    --tw-prose-code: oklch(21% 0.034 264.665);
    --tw-prose-pre-code: oklch(92.8% 0.006 264.531);
    --tw-prose-pre-bg: oklch(27.8% 0.033 256.848);
    --tw-prose-th-borders: oklch(87.2% 0.01 258.338);
    --tw-prose-td-borders: oklch(92.8% 0.006 264.531);
    --tw-prose-invert-body: oklch(87.2% 0.01 258.338);
    --tw-prose-invert-headings: #fff;
    --tw-prose-invert-lead: oklch(70.7% 0.022 261.325);
    --tw-prose-invert-links: #fff;
    --tw-prose-invert-bold: #fff;
    --tw-prose-invert-counters: oklch(70.7% 0.022 261.325);
    --tw-prose-invert-bullets: oklch(44.6% 0.03 256.802);
    --tw-prose-invert-hr: oklch(37.3% 0.034 259.733);
    --tw-prose-invert-quotes: oklch(96.7% 0.003 264.542);
    --tw-prose-invert-quote-borders: oklch(37.3% 0.034 259.733);
    --tw-prose-invert-captions: oklch(70.7% 0.022 261.325);
    --tw-prose-invert-kbd: #fff;
    --tw-prose-invert-kbd-shadows: rgb(255 255 255 / 10%);
    --tw-prose-invert-code: #fff;
    --tw-prose-invert-pre-code: oklch(87.2% 0.01 258.338);
    --tw-prose-invert-pre-bg: rgb(0 0 0 / 50%);
    --tw-prose-invert-th-borders: oklch(44.6% 0.03 256.802);
    --tw-prose-invert-td-borders: oklch(37.3% 0.034 259.733);
    font-size: 1rem;
    line-height: 1.75;
    :where(picture > img):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      margin-top: 0;
      margin-bottom: 0;
    }
    :where(li):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      margin-top: 0.5em;
      margin-bottom: 0.5em;
    }
    :where(ol > li):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      padding-inline-start: 0.375em;
    }
    :where(ul > li):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      padding-inline-start: 0.375em;
    }
    :where(.content > ul > li p):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      margin-top: 0.75em;
      margin-bottom: 0.75em;
    }
    :where(.content > ul > li > p:first-child):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      margin-top: 1.25em;
    }
    :where(.content > ul > li > p:last-child):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      margin-bottom: 1.25em;
    }
    :where(.content > ol > li > p:first-child):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      margin-top: 1.25em;
    }
    :where(.content > ol > li > p:last-child):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      margin-bottom: 1.25em;
    }
    :where(ul ul, ul ol, ol ul, ol ol):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      margin-top: 0.75em;
      margin-bottom: 0.75em;
    }
    :where(dl):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      margin-top: 1.25em;
      margin-bottom: 1.25em;
    }
    :where(dd):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      margin-top: 0.5em;
      padding-inline-start: 1.625em;
    }
    :where(hr + *):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      margin-top: 0;
    }
    :where(h2 + *):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      margin-top: 0;
    }
    :where(h3 + *):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      margin-top: 0;
    }
    :where(h4 + *):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      margin-top: 0;
    }
    :where(thead th:first-child):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      padding-inline-start: 0;
    }
    :where(thead th:last-child):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      padding-inline-end: 0;
    }
    :where(tbody td, tfoot td):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      padding-top: 0.5714286em;
      padding-inline-end: 0.5714286em;
      padding-bottom: 0.5714286em;
      padding-inline-start: 0.5714286em;
    }
    :where(tbody td:first-child, tfoot td:first-child):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      padding-inline-start: 0;
    }
    :where(tbody td:last-child, tfoot td:last-child):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      padding-inline-end: 0;
    }
    :where(figure):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      margin-top: 2em;
      margin-bottom: 2em;
    }
    :where(.content > :first-child):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      margin-top: 0;
    }
    :where(.content > :last-child):not(:where([class~="not-prose"],[class~="not-prose"] *)) {
      margin-bottom: 0;
    }
  }

`.trim()

let defaultDocumentColorsCss = `
:scope[data-appearance="light"] {
	background: #ffffff;
	color: oklch(0.145 0 0);
}

:scope[data-appearance="dark"] {
	background: #0a0a0a;
	color: oklch(0.985 0 0);
}

.document {
	margin-inline: auto;
	max-width: 65ch;
	padding: 2rem 1.5rem;
	--foreground: oklch(0.145 0 0);
	--border: oklch(0.922 0 0);
	--radius: 0.625rem;
}

.document .content {
	--tw-prose-body: oklch(37.1% 0 0);
	--tw-prose-headings: oklch(20.5% 0 0);
	--tw-prose-lead: oklch(43.9% 0 0);
	--tw-prose-links: oklch(20.5% 0 0);
	--tw-prose-bold: oklch(20.5% 0 0);
	--tw-prose-counters: oklch(55.6% 0 0);
	--tw-prose-bullets: oklch(87% 0 0);
	--tw-prose-hr: oklch(92.2% 0 0);
	--tw-prose-quotes: oklch(20.5% 0 0);
	--tw-prose-quote-borders: oklch(92.2% 0 0);
	--tw-prose-captions: oklch(55.6% 0 0);
	--tw-prose-kbd: oklch(20.5% 0 0);
	--tw-prose-kbd-shadows: color-mix(in oklab, oklch(20.5% 0 0) 10%, transparent);
	--tw-prose-code: oklch(20.5% 0 0);
	--tw-prose-pre-code: oklch(92.2% 0 0);
	--tw-prose-pre-bg: oklch(26.9% 0 0);
	--tw-prose-th-borders: oklch(87% 0 0);
	--tw-prose-td-borders: oklch(92.2% 0 0);
}

.document[data-appearance="dark"] {
	--foreground: oklch(0.985 0 0);
	--border: oklch(1 0 0 / 10%);
	--radius: 0.625rem;
}

.document[data-appearance="dark"] .content {
	--tw-prose-body: oklch(87% 0 0);
	--tw-prose-headings: #fff;
	--tw-prose-lead: oklch(70.8% 0 0);
	--tw-prose-links: #fff;
	--tw-prose-bold: #fff;
	--tw-prose-counters: oklch(70.8% 0 0);
	--tw-prose-bullets: oklch(43.9% 0 0);
	--tw-prose-hr: oklch(37.1% 0 0);
	--tw-prose-quotes: oklch(97% 0 0);
	--tw-prose-quote-borders: oklch(37.1% 0 0);
	--tw-prose-captions: oklch(70.8% 0 0);
	--tw-prose-kbd: #fff;
	--tw-prose-kbd-shadows: rgb(255 255 255 / 10%);
	--tw-prose-code: #fff;
	--tw-prose-pre-code: oklch(87% 0 0);
	--tw-prose-pre-bg: rgb(0 0 0 / 50%);
	--tw-prose-th-borders: oklch(43.9% 0 0);
	--tw-prose-td-borders: oklch(37.1% 0 0);
}

.document .content :is(h1, h2, h3, h4, h5, h6, th) {
	font-weight: 600;
}

.document .content a {
	color: var(--foreground);
}

.document .content code::before,
.document .content code::after {
	content: none;
}

.document .content pre {
	border: 1px solid var(--border);
	border-radius: var(--radius);
	padding: 1rem;
}
`.trim()

function getDefaultDocumentCss(): string {
	return [
		getDefaultDocumentTypographyCss(),
		getDefaultDocumentColorsCss(),
	].join("\n\n")
}

function getDefaultDocumentTypographyCss(): string {
	return wrapDefaultThemeLayer(defaultDocumentTypographyCss)
}

function getDefaultDocumentColorsCss(): string {
	return wrapDefaultThemeLayer(defaultDocumentColorsCss)
}

function wrapDefaultThemeLayer(css: string): string {
	return `@layer theme-base {\n${css}\n}`
}

function getDefaultThemeCss(): string {
	return [getDefaultDocumentCss(), getSlideshowBaseCss()].join("\n\n")
}

function getDefaultThemeSource(): string {
	return (
		[
			"# Default theme\n\nThis is the CSS used by Alkalye's built-in document and slideshow rendering. Edit it to make this theme your own. Local light and dark previews set `data-appearance`; optional `html document` and `html slide` fences need one `data-content` slot.",
			"## Document typography\n\n```css theme\n" +
				getDefaultDocumentTypographyCss() +
				"\n```",
			"## Document layout and colors\n\n```css theme\n" +
				getDefaultDocumentColorsCss() +
				"\n```",
			"## Slideshow\n\n```css theme\n" + getSlideshowBaseCss() + "\n```",
		].join("\n\n") + "\n"
	)
}

async function createDefaultTheme(account: co.loaded<typeof UserAccount>) {
	let loaded = await account.$jazz.ensureLoaded({
		resolve: { root: { themes: true } },
	})
	let root = loaded.root
	if (!root) throw new Error("Personal themes are not loaded")

	let owner = root.$jazz.owner
	let themes = root.themes
	let name = `Custom theme ${(themes?.length ?? 0) + 1}`
	let now = new Date()
	let theme = Theme.create(
		{
			version: 1,
			name,
			type: "both",
			css: co.plainText().create(getDefaultThemeCss(), owner),
			createdAt: now,
			updatedAt: now,
		},
		owner,
	)
	let source = await createThemeSourceDocument(loaded, {
		themeId: theme.$jazz.id,
		name,
		source: getDefaultThemeSource(),
	})
	theme.$jazz.set("sourceDocId", source.$jazz.id)

	if (!themes) {
		themes = co.list(Theme).create([], owner)
		root.$jazz.set("themes", themes)
	}
	themes.$jazz.push(theme)
	return theme
}

function getSlideshowBaseCss(): string {
	return `
:where([data-mode="slideshow"]) {
	background: var(--preset-background, var(--background));
	color: var(--preset-foreground, var(--foreground));
}

:where([data-mode="slideshow"][data-appearance="light"]) {
	background: var(--preset-background, #ffffff);
	color: var(--preset-foreground, #000000);
}

:where([data-mode="slideshow"][data-appearance="dark"]) {
	background: var(--preset-background, #000000);
	color: var(--preset-foreground, #ffffff);
}

:where([data-mode="slideshow"] .slideshow-grid) {
	font-size: var(--slide-body-size);
}

:where([data-mode="slideshow"] .slideshow-cell) {
	display: flex;
	min-height: 0;
	min-width: 0;
	max-width: 100%;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	text-align: center;
	overflow-wrap: normal;
	word-break: normal;
}

:where([data-mode="slideshow"] a) {
	color: var(--preset-link, var(--preset-accent, currentColor));
	text-decoration: underline;
}

:where([data-mode="slideshow"] code) {
	font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace);
	font-size: 0.85em;
	background: var(--preset-code-background, rgba(127, 127, 127, 0.15));
	padding: 0.15em 0.4em;
	border-radius: 0.25rem;
}

:where([data-mode="slideshow"] pre code) {
	background: none;
	padding: 0;
}

:where([data-mode="slideshow"] h1) {
	font-size: calc(var(--slide-h1-size) * 1);
	margin: 0 0 0.3em;
	line-height: 1.2;
}

:where([data-mode="slideshow"] h2) {
	font-size: calc(var(--slide-h1-size) * 0.85);
	margin: 0 0 0.3em;
	line-height: 1.2;
}

:where([data-mode="slideshow"] h3) {
	font-size: calc(var(--slide-h1-size) * 0.7);
	margin: 0 0 0.3em;
	line-height: 1.2;
}

:where([data-mode="slideshow"] h4) {
	font-size: calc(var(--slide-h1-size) * 0.6);
	margin: 0 0 0.3em;
	line-height: 1.2;
}

:where([data-mode="slideshow"] h5) {
	font-size: calc(var(--slide-h1-size) * 0.5);
	margin: 0 0 0.3em;
	line-height: 1.2;
}

:where([data-mode="slideshow"] h6) {
	font-size: calc(var(--slide-h1-size) * 0.45);
	margin: 0 0 0.3em;
	line-height: 1.2;
}

:where([data-mode="slideshow"] p) {
	font-size: var(--slide-body-size);
	margin: 0 0 0.3em;
	line-height: 1.4;
}

:where([data-mode="slideshow"] ol) {
	list-style: decimal;
	list-style-position: outside;
}

:where([data-mode="slideshow"] ul) {
	list-style: disc;
	list-style-position: outside;
}

:where([data-mode="slideshow"] :is(ol, ul)) {
	font-size: var(--slide-body-size);
	margin: 0.5em 0;
	padding-left: 1.2em;
	line-height: 1.4;
	text-align: left;
}

:where([data-mode="slideshow"] li) {
	margin: 0 0 0.2em;
}

:where([data-mode="slideshow"] blockquote) {
	font-size: var(--slide-body-size);
	margin: 0.5em 0;
	padding-left: 0.5em;
	line-height: 1.4;
	text-align: left;
	font-style: italic;
	border-left: calc(4px * var(--slide-scale, 1)) solid var(--preset-accent, currentColor);
}

:where([data-mode="slideshow"] table) {
	width: 100%;
	border-collapse: collapse;
	text-align: left;
	font-size: calc(var(--slide-body-size) * 0.8);
	margin: 0.5em 0;
	line-height: 1.2;
	white-space: nowrap;
}

:where([data-mode="slideshow"] table tr) {
	border-bottom-width: calc(1px * var(--slide-scale, 1));
	border-bottom-style: solid;
	border-bottom-color: var(--border);
}

:where([data-mode="slideshow"] table :is(th, td)) {
	padding: 0.3em 0.5em;
	white-space: nowrap;
	word-break: normal;
	vertical-align: top;
}

:where([data-mode="slideshow"] th) {
	font-weight: 600;
}

:where([data-mode="slideshow"] .slideshow-codeblock) {
	font-size: calc(var(--slide-body-size) * 0.6);
	margin: 0.5em 0;
	max-width: 100%;
	text-align: left;
}

:where([data-mode="slideshow"] .slideshow-codeblock pre) {
	margin: 0;
	max-width: 100%;
	white-space: pre;
	padding: 0.6em;
	border-radius: 0.5rem;
	background: var(--preset-code-background, rgba(127, 127, 127, 0.15));
	border: 1px solid rgba(127, 127, 127, 0.3);
}

:where([data-mode="slideshow"] pre.slideshow-codeblock) {
	max-width: 100%;
	white-space: pre;
	padding: 0.6em;
	border-radius: 0.5rem;
	background: var(--preset-code-background, rgba(127, 127, 127, 0.15));
	border: 1px solid rgba(127, 127, 127, 0.3);
}

:where([data-mode="slideshow"] .slideshow-image-container) {
	flex: 1 1 auto;
	width: 100%;
	min-height: 50%;
	display: flex;
	align-items: center;
	justify-content: center;
	overflow: hidden;
}

:where([data-mode="slideshow"] .slideshow-image-placeholder) {
	background: var(--preset-code-background, rgba(127, 127, 127, 0.15));
}

:where([data-mode="slideshow"] .slideshow-image) {
	width: 100%;
	height: 100%;
	object-fit: contain;
}

:where([data-mode="slideshow"] video.slideshow-image) {
	width: 100%;
	height: 100%;
}

:where([data-mode="slideshow"] .highlighted),
:where([data-mode="slideshow"] mark.highlighted) {
	background: var(--highlight-background, oklch(from var(--brand, #6366f1) l c h / 0.15));
	border: 1px solid var(--highlight-border, var(--brand, #6366f1));
	border-radius: 0.15em;
	padding: 0.05em 0.1em;
	box-decoration-break: clone;
	-webkit-box-decoration-break: clone;
	color: inherit;
}
`.trim()
}
