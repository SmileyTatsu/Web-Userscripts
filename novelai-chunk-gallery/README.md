# NovelAI Prompt Chunk Gallery (v0.4.0)

Install: Tampermonkey -> Create new script -> paste `novelai-chunk-gallery.user.js` (or drag the file into the browser).

Use

- Click the Prompt Chunks toolbar button: the gallery opens instead of the native popup (Shift+click = native popup). Alt+G or the Tampermonkey menu entry also open it.
- **Click a card = copy its text** (counts toward "Most used"). Hover a card for three small buttons: Edit, Favorite, More. More menu: Insert into prompt (Shift keeps the gallery open), Copy text, thumbnail from file / current page image, remove thumbnail.
- Edit / New (+) / Delete use the gallery's own dialog: name, text, category, color (with a dice button for a random color) **and image** (drop, paste, upload, current page image, remove). Image-only changes never touch the native form. The script fills and submits the native form invisibly, so the gallery never closes.
- Categories: folder-plus button in the top bar creates one; hover a category in the sidebar and click the pencil to rename / recolor / delete (chunks inside are kept).
- Reorder (Native order sort): drag a card onto another card to drop it before/after it, also across categories; drag a card onto a sidebar category to send it to the end of that category; drag a category row onto another row to reorder the sidebar. The move is replayed on the native panel and saved to your account, so the native popup shows the same order.
- Thumbnails are 832:1216 vertical. Hover a card and Ctrl+V an image, or drop an image/file on it. Older square thumbnails are center-cropped when shown.
- Slider = cards per row (2-10, stepped; grid view only). Grid/list toggle, sort (native / name / most used), category sidebar, search; Enter in search inserts the first result.
- The top-bar "open in new window" icon opens the native panel (fallback for anything the gallery cannot do).

How it works

- Chunks are E2E-encrypted on NovelAI's side, so the script reads them from the native panel DOM (opened invisibly), inserts by clicking the native button, edits by driving the native form, and reorders by replaying the panel's own HTML5 drag-and-drop (dragstart on the item, dragover/drop on the target). Thumbnails/favorites/usage are stored locally (Tampermonkey storage), matched to chunks by name + text hash.
- All site-specific selectors/strings are in `CONFIG` at the top of the script.

Testing

- `test/mock.html` keeps a real data model of the native panel (order arrays, collapse state) and implements its markup, forms, insert and drag-and-drop; open via file:// and click the blue button.
- Verified against the mock only. Live behaviour (React events, async save) is inferred from the bundle and not yet verified on the site.

Not done yet: tags UI, bulk actions, export/import, duplicate detection.
