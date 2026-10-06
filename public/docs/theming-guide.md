# Creating themes in Alkalye

A theme is a Markdown file containing CSS, optional HTML wrappers, and embedded assets. Write explanations alongside the code. Import or export a `.theme.md` file to carry the complete source between accounts.

## Theme library

**Settings › Editor › Themes** keeps your account's themes. **New custom theme** starts one in the workbench; **Upload theme** imports a `.theme.md` file or a ZIP theme. Each theme can be edited, exported as Markdown or deleted. Under **Default themes**, choose the theme that previews and slideshows use when a document names none.

A document names a theme in frontmatter with `theme: Paper` (matched by name, ignoring case) or `theme-id`, which the document's **Theme** dialog writes. `theme: light` or `theme: dark` only sets the appearance and keeps the default theme. A named theme that is missing, or a preset the theme lacks, shows a warning above the preview.

## Workbench

Open **Theme** in the document tools, choose **New custom theme**, and edit its source. **Open workbench** edits an existing document or library theme. Changes save locally and affect documents using that theme.

The source and preview appear side by side on desktop and stack on smaller screens. Drag the divider to resize them, or focus it and use arrow keys. Home and End select the smallest and largest source panes. Each pane can be minimized, maximized or restored.

Preview sample content or choose one of your documents. Switch between document and slideshow previews, and between light and dark appearances. Previewing a document does not change it. Invalid source still saves; the open workbench keeps its last valid preview and shows a clickable error that selects the source line.

**Open source** opens the source editor on its own page. **Open workbench** returns to the preview. Both pages support reload and browser navigation. Find and replace searches the theme source; Undo changes that source without undoing edits to its surrounding document. **New from default** creates another theme from Alkalye’s starter source.

Preview the current document, sample content, or another document. Switch between Document and Slideshow, Light and Dark, and source/preview/split layouts. The Split slider changes pane width. Previous and Next browse sample slides. These controls change the preview independently of the application's appearance.

## Source format

Only these fence annotations compile:

| Fence | Purpose |
| --- | --- |
| `css theme` | CSS overrides; multiple fences concatenate |
| `html document` | Optional document wrapper |
| `html slide` | Optional slide wrapper |
| `base64 asset <path> <mime>` | Embedded font or image |
| `json theme metadata` | Optional JSON metadata |

Each HTML wrapper needs exactly one empty `data-content` slot. `data-document` is also accepted. Scripts, forms, event attributes, and unsafe URLs are removed when rendering. Put CSS in a CSS fence rather than a `<style>` tag.

````markdown
# My reading theme

System fonts keep this theme available offline.

```css theme
.document .content {
  font-family: Georgia, serif;
  line-height: 1.75;
}
.theme[data-appearance="dark"] {
  color: #ecefec;
  background: #101110;
}
.theme[data-appearance="light"] {
  color: #202923;
  background: #fff;
}
.slide .content h1 { letter-spacing: -0.04em; }
```

```html document
<article class="content" data-content></article>
```

```html slide
<article class="content" data-content></article>
```
````

## Presets

Metadata may also give an `author` and a `type`: `preview`, `slideshow` or `both` (the default), which decides where Settings offers the theme as a default.

Presets pair colors and fonts with a light or dark appearance. Select one in the document's Theme dialog, or set `preset: Paper` in frontmatter. Automatic selection follows appearance.

```json theme metadata
{
  "name": "Reading",
  "presets": [{
    "name": "Paper",
    "appearance": "light",
    "colors": {"background": "#faf6ed", "foreground": "#282921", "accent": "#267d62"},
    "fonts": {"body": "Georgia, serif", "title": "Georgia, serif"}
  }]
}
```

## Browser rendering

Each preview renders inside a ShadowRoot. App component styles stay outside. Alkalye's document and slide baseline lives in `@layer theme-base`; ordinary theme rules take precedence.

Use `.document` for reading, `.slide` for presentations, and `.theme[data-appearance="light"]` or `.theme[data-appearance="dark"]` for appearance. `:root` becomes `:host`; `:scope` becomes `.theme`.

The content slot contains rendered Markdown. Slides use a `.slideshow-grid` with `.slideshow-cell` children. ResizeObserver adjusts slide text to fit. Keep the slot measurable: avoid fixed heights, hidden overflow, and transforms on its content. Check a dense slide as well as a title slide.

## Fonts and images

Embed assets and reference them with `asset:<path>`:

````markdown
```css theme
@font-face {
  font-family: Reading;
  src: url("asset:fonts/reading.woff2") format("woff2");
}
.document .content { font-family: Reading, Georgia, serif; }
```

```base64 asset fonts/reading.woff2 font/woff2
REPLACE_WITH_ACTUAL_BASE64
```
````

The compiler substitutes data URLs. Native FontFace loads embedded fonts. Supported assets include WOFF/WOFF2/TTF/OTF fonts and PNG/JPEG/WebP/AVIF/GIF/SVG images. Paths are identifiers inside the source; absolute paths and `..` segments are rejected. Include licenses as prose.

Legacy ZIP themes containing `theme.css`, `template.html`, or `slide.html` remain importable. Fonts and images are embedded into the resulting Markdown. External resources depend on the network; embedded assets and system fonts work offline.

## Validation

Malformed fences, duplicate wrappers/assets, missing assets, and invalid metadata produce source errors. CSS syntax and visual layout still need browser inspection. Check light/dark, narrow/wide panes, documents/slides, and printed output when print matters.

## CLI

```sh
bun cli.ts theme create --name Reading --file reading.theme.md
bun cli.ts theme update THEME_ID --file reading.theme.md
bun cli.ts theme get THEME_ID
```

Create and update validate the source before saving. Export from the workbench to obtain the editable `.theme.md` file.

## Learn from the implementation

- `src/shared/markdown.ts`: fence grammar, Markdown rendering, theme compilation.
- `src/shared/theme-archive.ts`: legacy ZIP conversion and embedded assets.
- `src/client/components/document-renderer.ts`: ShadowRoot, sanitization, fonts, slide fitting.
- `src/client/components/document-renderer.css`: layered baseline.
- `src/client/components/theme-workbench.ts`: native controls and live preview.

written with GPT-6 in Codex
