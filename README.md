# Alkalye

Beautiful, end-to-end encrypted markdown editor with real-time collaboration and presentation mode.

**[alkalye.com](https://alkalye.com)**

## Features

- **E2E Encrypted** — Your documents are encrypted on your device before syncing
- **Real-time Collaboration** — Share documents and edit together with live cursors
- **Presentation Mode** — Turn markdown into slideshows with `mode: present` frontmatter
- **Teleprompter Mode** — Present with auto-scrolling text
- **Offline-First** — Works without internet, syncs when back online (PWA)
- **Focus Mode** — Distraction-free writing environment
- **Media Assets** — Upload and embed images and videos in your documents
- **HTML/CSS Themes** — Custom document themes with HTML templates and CSS styling
- **PDF Export** — Export documents as formatted PDFs
- **Time Machine** — Browse document history and restore previous versions
- **Portable** — Settings stored in frontmatter, export as standard `.md` files anytime

## Tech Stack

- [Jazz](https://jazz.tools) for local-first sync and encryption
- [Astro](https://astro.build) 5 + React 19
- [Tanstack Router](https://tanstack.com/router) for routing
- Tailwind CSS 4 + shadcn/ui (base-lyra style)
- CodeMirror 6 editor

## Development

Requires [Bun](https://bun.sh). Starting your dev environment is as easy as:

```bash
bun install

cp .env.example .env

bunx jazz-sync run # start sync server

bun run dev
```

## Theme authoring

See the [theme authoring guide](public/docs/theming-guide.md) for Markdown theme sources, CSS/HTML hooks, light/dark styling, and a prompt to give your agent.

## CLI

```bash
bun link
alkalye --help
```

## Contributing

Contributions welcome! Please open an issue or PR.

`main` is protected: no direct pushes, and pull requests land as squash merges.

Every pull request adds exactly one entry at the top of
[`public/changelog.json`](public/changelog.json) describing what changed for
readers. Published entries are never edited, reordered or removed — readers
remember how far they have read by position, so touching an old entry replays
old notes for everyone. The entries render at
[alkalye.com/changelog](https://www.alkalye.com/changelog) and drive the
in-app update prompt.

## Local CI

Pull requests require a local CI signoff on their latest commit. Install the
pinned signoff extension once:

```bash
gh extension install basecamp/gh-signoff --pin v0.4.1
```

Push your commit, then run:

```bash
bun run ci
```

The command checks the changelog entry, installs dependencies, runs static
checks, types and unit tests, the production build, and the end-to-end suite
against the local `work` services. It signs off only when `HEAD` and the
working tree still match the state that was tested. The complete run has a
15-minute timeout. Every new commit requires another run. Do not call
`gh signoff` directly.

Set `CI_BASE_URL` to test against an already-running server instead of
restarting the `work` services.

## License

[MIT](./LICENSE)

© 2025 Carl Assmann
