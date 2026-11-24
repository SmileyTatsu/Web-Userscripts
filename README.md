# Web-Userscripts

Monorepo for my userscripts and other small browser tooling. Each project lives in its own folder with its own README. Formatting and linting are shared: one Prettier and one ESLint config at the repo root apply to everything.

## Projects

| Project                                           | Site                                     | What it does                                                                                     | Version | Status                                        |
| ------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------ | ------- | --------------------------------------------- |
| [novelai-chunk-gallery](./novelai-chunk-gallery/) | [novelai.net](https://novelai.net/image) | Replaces the Prompt Chunks popup with a searchable thumbnail gallery (edit, favorites, sorting). | 0.3.2   | Verified on a mock page; live testing pending |

Add a row here whenever a new project is added.

## Install a script

1. Install a userscript manager (Tampermonkey, Violentmonkey).
2. Open the project's `*.user.js` file, copy the raw contents into a new script, or drag the file into the browser.

## Development

Requires Node.js and [pnpm](https://pnpm.io/).

```sh
pnpm install       # once
pnpm format        # Prettier: rewrite files
pnpm lint          # ESLint (includes userscript metadata checks)
pnpm lint:fix      # apply safe ESLint fixes
pnpm check         # format:check + lint, run this before committing
```

### Conventions

- One folder per project, named in lowercase `kebab-case`. A script is `<name>/<name>.user.js`.
- Style is enforced by the root configs: [`prettier.config.js`](./prettier.config.js), [`eslint.config.js`](./eslint.config.js), [`.editorconfig`](./.editorconfig). LF line endings, 2 spaces, single quotes, semicolons, 100 columns.
- Do not add per-project configs unless a project truly needs different rules.
- See [`IDEA.md`](./IDEA.md) for the intended directory layout and script anatomy.
