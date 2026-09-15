# File Organization

Enforced by `local/exported-top-down` ESLint rule.

## Tool/API Modules (.ts)

AI tool definitions go last in the file.

## Local files

`src/app/lib/local-file.ts` owns file and directory handles. `src/app/features/assets/lib/local-assets.ts` owns sibling `assets/` files and Markdown link conversion. On disk, local asset filenames are their IDs; editor links use `asset:`. Saves preserve existing `./assets/` spelling by filename and occurrence order.
