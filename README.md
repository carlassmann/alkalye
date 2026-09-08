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

## License

[MIT](./LICENSE)

© 2025 Carl Assmann
