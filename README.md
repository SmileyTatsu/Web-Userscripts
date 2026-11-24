# Web-Userscripts

Monorepo for my userscripts and small browser tools. Prettier and ESLint are configured once at the root and apply to every project.

| Project                                           | Site                                     | What it does                                                          |
| ------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| [novelai-chunk-gallery](./novelai-chunk-gallery/) | [novelai.net](https://novelai.net/image) | Replaces the Prompt Chunks popup with a searchable thumbnail gallery. |

## Install

1. Install a userscript manager such as [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. Open the project's `*.user.js` file, click **Raw**, and your manager will offer to install it. Or create a new script in the manager and paste the file contents.

## Development

```sh
pnpm install
pnpm check   # Prettier check + ESLint
pnpm format  # Prettier write
```

## AI Disclosure

Blatantly vibecoded, do not use if you care (smh).
