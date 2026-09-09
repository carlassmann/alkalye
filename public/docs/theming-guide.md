# Creating themes in Alkalye

Use this guide when asking an agent to create or edit a theme. It describes the Markdown source format used by the theme workbench. A `.theme.md` file contains the complete theme, including embedded fonts and images. Legacy ZIP packages can still be imported.

## Start from the default

1. In Settings > Themes, choose **New custom theme**, then open its workbench. **New from default** in an existing workbench creates a separate theme.
2. Paste or edit the Markdown source in the workbench. It keeps `theme-source` bound to the destination theme, including when you replace the entire source or paste from another theme. When editing the source as an ordinary document, preserve this generated link.
3. Edit the CSS fences in Alkalye's editor. Start by appending a small override fence to the baseline.
4. Switch between Document and Slideshow, select sample content or a real document, and check Light and Dark. These controls affect the preview, not your app appearance or the selected document's theme.
5. Drag the divider to resize. Minimize/maximize controls preserve the current session's split size. Keyboard users can focus the divider and use arrow keys, Home, or End.

The baseline contains the actual CSS used by Alkalye's default document and slideshow renderers. Its sections cover document typography, document layout and colors, and slideshow styling. Document defaults use `@layer theme-base`; ordinary unlayered overrides take precedence. Keep the baseline until you deliberately replace its behavior.

The workbench saves source edits locally and updates the compiled theme. Editing that theme changes every document using it. Create a separate theme for experiments you do not want applied elsewhere.

## Markdown source format

A theme is an ordinary Markdown source document linked to a separate theme record. Prose can explain design decisions. Only these exact, case-sensitive fence annotations compile:

| Fence           | Count        | Meaning                                           |
| --------------- | ------------ | ------------------------------------------------- |
| `css theme`     | Zero or more | Concatenated in source order                      |
| `html document` | Zero or one  | Optional wrapper around rendered document content |
| `html slide`    | Zero or one  | Optional wrapper around the current slide         |

Use exactly three opening backticks. Ordinary `css` or `html` fences, tilde fences, and four-backtick examples do not compile. Keep HTML and CSS in separate fences. HTML fences containing `<style>` are rejected. Every HTML template needs exactly one content slot after sanitization. `data-content` is preferred; `data-document` is a supported alias.

For example, append this to an existing generated source, below its baseline fences:

````markdown
## Reading typography

```css theme
.document .content {
	font-family: Georgia, serif;
	line-height: 1.75;
}

.document .content h1 {
	letter-spacing: -0.035em;
}
```
````

Unclosed recognized fences, duplicate HTML templates, and missing or multiple slots show errors with source locations. The preview keeps the last successfully compiled theme while those errors exist. CSS syntax errors are different: the browser may ignore invalid rules without showing a workbench error. Removing a valid fence removes its contribution; an empty source is not a reset to the saved baseline.

**Open source** opens the same source document in the ordinary editor. A Markdown file with CSS fences alone does not register a new theme. Create it through Settings or import a theme package first.

## Styling hooks

Use these hooks instead of Alkalye's utility classes or generated IDs:

| Selector                          | Meaning                                              |
| --------------------------------- | ---------------------------------------------------- |
| `.theme`                          | Theme wrapper in either renderer                     |
| `.document`                       | Document wrapper only                                |
| `.document .content`              | Rendered Markdown article, including media           |
| `.theme[data-mode="slideshow"]`   | Slideshow theme wrapper                              |
| `.slide`                          | Current slide container                              |
| `.slide .content`                 | Automatically sized slide content grid               |
| `.slideshow-cell`                 | A visual block within that grid                      |
| `.theme[data-appearance="light"]` | Wrapper using light appearance                       |
| `.theme[data-appearance="dark"]`  | Wrapper using dark appearance                        |
| `[data-theme]`                    | Wrapper carrying the theme's display name            |
| `:scope`                          | Outer CSS scope boundary, useful for the full canvas |

Do not use `article` to distinguish documents from slides. Both renderers can contain article elements. Prefer `.document` and `.slide`.

Simplified document structure, without a custom template:

```html
<div data-theme-scope="generated" data-appearance="light">
	<div class="theme document" data-theme="Your theme" data-appearance="light">
		<article class="content">Rendered Markdown and media</article>
	</div>
</div>
```

Simplified slideshow structure for a Markdown source theme:

```html
<div data-theme-scope="generated" data-mode="slideshow" data-appearance="light">
	<article
		class="theme"
		data-mode="slideshow"
		data-theme="Your theme"
		data-appearance="light"
	>
		<div class="slide">
			<div class="content slideshow-grid">
				<div class="slideshow-cell">Rendered visual block</div>
			</div>
		</div>
	</article>
</div>
```

Alkalye wraps source-theme CSS in a native CSS `@scope` boundary. You do not need to write that wrapper yourself. `:root` is rewritten to `:scope`. Do not target `html`, `body`, `.dark`, editor controls, or a generated `data-theme-scope` value. Use `:scope` explicitly when targeting the boundary itself; ordinary selectors target its descendants. Imported legacy themes without a source link may follow older scoping behavior.

Theme CSS is not an iframe sandbox. Allowed font imports and font-face rules can exist outside the scope. Avoid global assumptions about fonts, layer names, or the surrounding app.

## Light and dark colors

Use `data-appearance`, not the app's `.dark` class or only `prefers-color-scheme`. The workbench can preview light content while the app is dark, and vice versa.

This additional fence defines a document palette and a matching canvas. It overrides the baseline's prose colors explicitly, including headings, links, and inline code:

````markdown
```css theme
:scope[data-appearance="light"] {
	--paper: #faf8f2;
	--ink: #282820;
	--accent: #6b3a16;
	--rule: #d7d2c4;
	background: var(--paper);
}

:scope[data-appearance="dark"] {
	--paper: #191b18;
	--ink: #e8e9df;
	--accent: #efbb85;
	--rule: #474b41;
	background: var(--paper);
}

.document {
	background: var(--paper);
	--foreground: var(--ink);
	--border: var(--rule);
}

.document .content {
	color: var(--ink);
	--tw-prose-headings: var(--ink);
	--tw-prose-bold: var(--ink);
	--tw-prose-quotes: var(--ink);
	--tw-prose-code: var(--ink);
	--tw-prose-counters: var(--ink);
	--tw-prose-bullets: var(--rule);
	--tw-prose-hr: var(--rule);
	--tw-prose-quote-borders: var(--rule);
	--tw-prose-th-borders: var(--rule);
	--tw-prose-td-borders: var(--rule);
}

.document .content a {
	color: var(--accent);
}
```
````

For a shared palette, add `.theme[data-mode="slideshow"] { background: var(--paper); color: var(--ink); }` in that CSS fence. Scope document typography to `.document` so it does not constrain slide sizing.

Fenced code uses syntax-highlighted token colors chosen by the renderer for the effective appearance. Changing a parent `color` does not recolor every token. Check code blocks separately in both appearances. The full default source lists the remaining `--tw-prose-*` values if you need finer control.

## Optional HTML wrappers

Start with CSS. Add HTML when you need a frame, header, or footer around content. Templates are HTML fragments, not executable components. They have no JavaScript, interpolation language, document-title variable, or per-heading layout engine.

````markdown
```html document
<section class="reading-frame">
	<header class="reading-label">Field notes</header>
	<main data-content></main>
</section>
```

```css theme
.document .reading-frame {
	border-top: 3px solid currentColor;
	padding-top: 1rem;
}

.document .reading-label {
	font:
		0.75rem system-ui,
		sans-serif;
	letter-spacing: 0.1em;
	text-transform: uppercase;
}
```
````

The slot receives the existing rendered content, including its `.content` wrapper and live media components. Leave it empty in the template. Do not duplicate `.theme`, `.document`, or `.content` wrappers yourself.

A slide template needs a height layout that gives its slot room for automatic sizing:

````markdown
```html slide
<section class="slide-frame">
	<main data-content></main>
	<footer data-slide-number></footer>
</section>
```

```css theme
.slide .slide-frame {
	display: grid;
	grid-template-rows: minmax(0, 1fr) auto;
	height: 100%;
	padding: 1rem;
}

.slide .slide-frame > [data-content] {
	min-height: 0;
	min-width: 0;
}

.slide .slide-frame > footer {
	text-align: right;
	font:
		0.75rem system-ui,
		sans-serif;
}
```
````

`data-slide-number` receives the current slide number. Keep it under the content slot's immediate parent, as in this example. Alkalye supplies `--slide-h1-size`, `--slide-body-size`, and `--slide-scale` on the slide content grid. Preserve the default sizing rules unless you intend to replace them, and test after resizing the pane.

HTML is sanitized. Scripts, event handlers, iframes, embeds, forms, and buttons are removed. Source templates reject style elements; put CSS in its own fence. Ordinary HTTPS image and link URLs can remain; sanitization does not make remote resources available offline.

## Applying and sharing

Use the document's theme picker to apply a theme. It writes the theme selection using its stable ID. Display-name selection through frontmatter is also supported:

```yaml
---
theme: My theme
---
```

Do not confuse a document's `theme` selection with the theme source's `theme-source` link. Settings can choose separate default document and slideshow themes; explicit document selections override defaults. Existing `theme-id` values should be preserved alongside their `theme` selection. Names and IDs do not grant another account access to a theme.

Export from Settings to download one `.theme.md` file. It contains the editable CSS/HTML fences, embedded assets, and theme metadata. Import creates a new theme and linked source document while preserving the source prose and fence grouping. Account-specific source IDs are removed from exports. Older ZIP themes remain importable; export them as Markdown to make them portable.

Optional `json theme metadata` fence preserves the theme name, author, description, type (`preview`, `slideshow`, or `both`), and color presets. An optional `thumbnail` stores a base64 PNG, JPEG, WebP, or GIF data URL (up to 2 MB). CLI `--name` overrides its name.

````markdown
```json theme metadata
{ "name": "My theme", "author": "Me", "type": "both" }
```
````

## Embedded assets

Store fonts and images in separate `base64 asset <path> <mime-type>` fences. Paths are local identifiers inside the Markdown, not filesystem paths. Refer to them as `asset:<path>` in CSS URLs or HTML attributes. The compiler replaces those references with data URLs, so copying the entire Markdown carries its assets to another account or machine.

````markdown
```css theme
@font-face {
	font-family: "Reading";
	src: url("asset:fonts/reading.woff2") format("woff2");
	font-weight: 100 900;
}
.document {
	font-family: "Reading", sans-serif;
}
```

```base64 asset fonts/reading.woff2 font/woff2
BASE64_ENCODED_FONT_BYTES
```
````

Replace the placeholder with the font's actual Base64 bytes. Payloads can wrap across lines. Each decoded asset is limited to 2 MB; all assets together to 5 MB. Keep font and image licenses in the same Markdown as prose. Missing references, invalid payloads, duplicate paths, and unsupported MIME types are validation errors; they do not replace a working theme.

Supported asset MIME types are `font/woff2`, `font/woff`, `font/ttf`, `font/otf`, `image/png`, `image/jpeg`, `image/webp`, `image/gif`, and `image/svg+xml`. Use embedded assets or system fonts for offline themes. External URLs still depend on the network. CSS sanitization removes dangerous script-like constructs and restricts external font imports.

The repository’s `themes/syntwin.theme.md` is a complete working example. Its optional document and talk samples live separately under `themes/examples/`; they are not required to use the theme.

## CLI workflow for agents

Authenticate the CLI to the same account and deployment as the browser. Themes belong to the account's theme library.

```sh
alkalye theme list --json
alkalye theme create --name "My theme" --source theme.theme.md --json
alkalye theme get <theme-id> --json
alkalye theme update <theme-id> --source theme.theme.md --json
alkalye theme delete <theme-id> --json
```

Create and update validate the source fences and HTML templates, sanitize CSS/HTML, and compile the theme immediately. No open workbench is required. Invalid source leaves the existing theme unchanged. Updates keep the theme ID and linked source document, so assigned documents continue to use the theme. Bundled fonts and other existing theme assets remain attached. Pass `--name` on update to rename the theme. Delete removes the theme from the library; its source document remains available.

`theme get --json` returns portable Markdown with embedded assets in `data.source`; save it to a file before editing.

```sh
alkalye theme get <theme-id> --json | jq -r .data.source > theme.theme.md
```

Use the returned workbench URL to inspect the theme with `agent-browser` or another browser automation tool. Check document and slideshow modes, light and dark appearance, different pane sizes, and a real document. For print changes, export and inspect a PDF. CLI validation does not validate CSS syntax or prove the layout works.

Assign through the existing document commands: read the document, set its `theme` frontmatter to the theme ID, then update the document. Preserve the rest of its content. Updating a theme's source through `doc update` alone does not compile it; use `theme update` for an independent CLI workflow.

## Validation and troubleshooting

Use [the document kitchen sink](./kitchen-sink-preview.md) and [the presentation kitchen sink](./kitchen-sink-presentation.md), plus at least one real target document. Presentation content follows [Alkalye's presentation syntax](./tutor-presentations.md); it is not a screenshot of normal document rendering.

Check both renderers and appearances, narrow and wide panes, long headings, lists, tables, links, code blocks, images, and any document media. For slides, click through multiple slides and resize after adding a template. For documents, check scrolling and text selection.

If changes do not appear, verify the exact fence annotation, unchanged `theme-source` link, selected preview target, source error messages, and selector. Inspect computed CSS when rules conflict. CSS syntax is not validated by the source parser. A blank or tiny templated slide usually means its content slot has no usable height.

PDF export uses a separate print document and print styles, currently marked with light appearance. Test the actual export if PDF output matters. Live preview is not proof of print parity. Add `@media print` rules as needed.

## Prompt for your agent

Copy this prompt and supply the existing source document and design brief:

> Read Alkalye's theming guide. Create a theme for my documents using the supplied default-based Markdown source. Preserve its generated frontmatter and theme-source ID. Return the complete edited source with separate css theme, html document, and html slide fences where needed. Start with CSS overrides; add HTML only for an explicit layout need, with one empty data-content slot per template. Use .document and .slide selectors and data-appearance for light/dark. Preserve slide auto-sizing and document media. My visual direction is: [describe typography, colors, density, and examples]. My primary output is: [documents, slides, or both; PDF if needed]. Validate both appearances and narrow/wide layouts in the workbench when available. Report what you actually tested and any limitations.

For repository agents, the implementation references are:

- `src/app/features/themes/lib/default-theme.ts`: shared default CSS and generated source.
- `src/app/features/themes/lib/source.ts`: fence grammar, validation, and source synchronization.
- `src/app/features/themes/lib/sanitize.ts`: sanitization rules and supported font hosts.
- `src/app/features/themes/lib/renderer.ts`: CSS scoping and compiled styles.
- `src/app/features/documents/widgets/preview.tsx`: document content and template slots.
- `src/app/features/presentation/widgets/slideshow.tsx`: slide templates and automatic sizing.
- `src/app/features/themes/lib/upload.ts` and `export.ts`: package format.
