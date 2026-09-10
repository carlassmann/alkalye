# Agent Instructions

Offline-capable PWA built with Jazz (local-first sync), Astro, and React.

## Essentials

- **Bun** - use `bun install`, `bun add`, `bun run` (no npm/yarn)
- **Verify:** `bun run check` (lint, types, format, tests)
- **React Compiler** - never use `useMemo`, `useCallback`, `React.memo`

## Architecture

- **Framework:** Astro 5 with React 19 integration
- **Routing:** Tanstack Router (auto-generated route tree)
- **Data:** Jazz (CoValues for documents, spaces, themes, presence)
- **Storage:** IndexedDB via idb-keyval + Jazz sync
- **PWA:** vite-plugin-pwa with offline caching and file handlers
- **Testing:** Vitest + happy-dom/jsdom

## Style

- High information density
- Top-down readability
- `let` over `const`, `function` over arrow for named functions
- No default exports
- No `any`, no type casts - fix types properly
- Comments explain WHY, not WHAT (prefer no comments)

## Detailed Guides

- [TypeScript](docs/typescript.md) - general coding style, types, tryCatch
- [React Components](docs/react-components.md) - handler factories, routes, forms
- [Jazz Patterns](docs/jazz.md) - CoValue types, queries
- [File Organization](docs/file-organization.md) - module structure, exports
- [Theme authoring](public/docs/theming-guide.md) - Markdown theme sources, styling hooks, templates, and validation

<!-- effect-solutions:start -->

## Effect Best Practices

**IMPORTANT:** Always consult effect-solutions before writing Effect code.

1. Run `effect-solutions list` to see available guides
2. Run `effect-solutions show <topic>...` for relevant patterns (supports multiple topics)
3. Search `.reference/effect/` for real implementations (run `effect-solutions setup` first)

Topics: quick-start, project-setup, tsconfig, basics, services-and-layers, data-modeling, error-handling, config, testing, cli.

Never guess at Effect patterns - check the guide first.

## Local Effect Source

The Effect repository is cloned to `.reference/effect/` for reference.
Use this to explore APIs, find usage examples, and understand implementation details when docs aren't enough.

<!-- effect-solutions:end -->
