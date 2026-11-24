# Web-Userscripts

Monorepo for my userscripts and small browser tools. Prettier and ESLint are configured once at the root and apply to every project.

| Project                                           | Site                                     | What it does                                                          |
| ------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| [novelai-chunk-gallery](./novelai-chunk-gallery/) | [novelai.net](https://novelai.net/image) | Replaces the Prompt Chunks popup with a searchable thumbnail gallery. |

## Install

1. Install a userscript manager such as [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. Click a script's install link below; your manager will offer to install it. Scripts update themselves from this repo.

| Script                       | Install                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NovelAI Prompt Chunk Gallery | [novelai-chunk-gallery.user.js](https://raw.githubusercontent.com/SmileyTatsu/Web-Userscripts/main/novelai-chunk-gallery/novelai-chunk-gallery.user.js) |

## Development

```sh
pnpm install
pnpm check   # Prettier check + ESLint
pnpm format  # Prettier write
```

## AI Disclosure

Blatantly vibecoded, do not use if you care (smh).
