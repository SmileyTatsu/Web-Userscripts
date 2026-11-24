# Web-Userscripts

Monorepo for my userscripts and small browser tools. Prettier and ESLint are configured once at the root and apply to every project.

| Project                                           | Site                                     | What it does                                                          |
| ------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| [novelai-chunk-gallery](./novelai-chunk-gallery/) | [novelai.net](https://novelai.net/image) | Replaces the Prompt Chunks popup with a searchable thumbnail gallery. |

## Development

```sh
pnpm install
pnpm check   # Prettier check + ESLint
pnpm format  # Prettier write
```
