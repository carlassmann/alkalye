# Syntwin theme

A portable Alkalye theme for readable Syntwin documents and talks. It uses the current application palette and canonical mark from `/Users/carlassmann/Developer/syntwin-mono`.

`build.ts` packages `overrides.css`, embeds the canonical Syntwin mark as a CSS data URI, validates the generated Markdown source, and writes `styles.css`, `source.md`, and `../syntwin.zip`. Alkalye supplies its built-in baseline at render time.

Run from the repository root:

```bash
bun themes/syntwin/build.ts /path/to/syntwin-mono
```

Without a path, the build reads a sibling `../syntwin-mono`. `SYNTWIN_MONO_PATH` is also supported.

Import `themes/syntwin.zip` in **Settings → Themes**. The ZIP includes local Geist and Geist Mono variable font files, their licenses, the manifest, generated source, document template, and both sample Markdown files. Documents show the logo at the top left and `syntwin.ai` centered below the content; the footer repeats at the bottom of every printed page. Slides retain Alkalye’s automatic content sizing and use a faint canonical mark and wordmark watermark at the bottom left of every slide.

Brand provenance:

- palette: `src/styles/global.css` under `html.app`
- wordmark and canonical mark: `src/app/components/app-brand.tsx`, `src/app/shared/ui/brand-mark.tsx`
