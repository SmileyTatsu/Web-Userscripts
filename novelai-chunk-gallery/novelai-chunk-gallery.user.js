// ==UserScript==
// @name         NovelAI Prompt Chunk Gallery
// @namespace    https://github.com/SmileyTatsu
// @version      0.4.0
// @description  Replaces the Prompt Chunks popup on novelai.net/image with a searchable thumbnail gallery.
// @author       SmileyTatsu
// @homepage     https://github.com/SmileyTatsu/Web-Userscripts/tree/main/novelai-chunk-gallery
// @homepageURL  https://github.com/SmileyTatsu/Web-Userscripts/tree/main/novelai-chunk-gallery
// @supportURL   https://github.com/SmileyTatsu/Web-Userscripts/issues
// @downloadURL  https://raw.githubusercontent.com/SmileyTatsu/Web-Userscripts/main/novelai-chunk-gallery/novelai-chunk-gallery.user.js
// @updateURL    https://raw.githubusercontent.com/SmileyTatsu/Web-Userscripts/main/novelai-chunk-gallery/novelai-chunk-gallery.user.js
// @match        https://novelai.net/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
  'use strict';
  if (window.__ncgLoaded) return;
  window.__ncgLoaded = true;

  /* ───────────────────────── CONFIG: every site-specific selector lives here ───────────────────────── */
  const CONFIG = {
    panelId: 'promptChunkContainer',
    // Fallback for the toolbar button; replaced by what the script learns from your first native click.
    iconSelector: '.sc-3fbd69ac-142',
    chunkSel:
      'div[draggable="true"][color][title*="Click to insert"], div[color][title$="Click to insert"]',
    headerSel: 'div[draggable="true"][color]',
    headerMarker: 'button[title="Edit Category"]',
    editChunkSel: 'button[title="Edit Chunk"]',
    titleSuffix: /\n\nClick to insert(, drag to reorder)?$/,
    noEditorText: 'Click in a prompt field first',
    thumbW: 320,
    thumbH: 468, // 832x1216 aspect
    addChunkSel: 'button[title="Add Prompt Chunk"]',
    addCatSel: 'button[title="Add Category"]',
    formNameSel: 'input[type="text"]',
    formTextSel: 'textarea',
    formCatSel: 'select',
    btn: { save: 'Save', cancel: 'Cancel', del: 'Delete' },
    hotkey: { alt: true, key: 'g' },
    // The native panel reorders with HTML5 drag-and-drop: the dragged element's dragstart fills the
    // DataTransfer with these MIME types and the drop target applies the move.
    macroMime: 'application/x-prompt-chunk-macro',
    catMime: 'application/x-prompt-chunk-category',
    // Our own types for dragging inside the gallery. Drag payload values are protected while a drag is
    // in flight, so the kind lives in the MIME type instead of the data.
    dragChunkMime: 'application/x-ncg-chunk',
    dragCatMime: 'application/x-ncg-cat',
  };

  /* ───────────────────────── storage (Tampermonkey GM_* with localStorage fallback) ───────────────────────── */
  const hasGM = typeof GM_getValue === 'function';
  const st = {
    get: (k, d) => {
      try {
        if (hasGM) return GM_getValue(k, d);
        const v = localStorage.getItem(`ncg:${k}`);
        return v == null ? d : JSON.parse(v);
      } catch {
        return d;
      }
    },
    set: (k, v) => {
      try {
        if (hasGM) GM_setValue(k, v);
        else localStorage.setItem(`ncg:${k}`, JSON.stringify(v));
      } catch (e) {
        console.warn('[ncg] save failed', e);
      }
    },
    del: (k) => {
      try {
        if (hasGM) GM_deleteValue(k);
        else localStorage.removeItem(`ncg:${k}`);
      } catch {}
    },
    keys: () => {
      try {
        return hasGM
          ? GM_listValues()
          : Object.keys(localStorage)
              .filter((k) => k.startsWith('ncg:'))
              .map((k) => k.slice(4));
      } catch {
        return [];
      }
    },
  };

  const prefs = Object.assign(
    { intercept: true, cols: 6, view: 'grid', sort: 'native', iconSel: '' },
    st.get('prefs', {}),
  );
  const savePrefs = () => st.set('prefs', prefs);
  const store = st.get('meta', null) || { v: 1, entries: {} };
  const saveStore = () => st.set('meta', store);
  const thumbs = new Map(); // id -> dataURL
  for (const k of st.keys()) if (k.startsWith('thumb:')) thumbs.set(k.slice(6), st.get(k));

  /* ───────────────────────── utils ───────────────────────── */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const hash = (s) => {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  };
  const getPanel = () => document.getElementById(CONFIG.panelId);
  async function waitFor(fn, ms = 2000, step = 40) {
    const t0 = Date.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() - t0 > ms) return null;
      await sleep(step);
    }
  }
  const queue = (() => {
    let p = Promise.resolve();
    return (fn) => (p = p.then(fn, fn));
  })();

  /* ───────────────────────── native panel driver ───────────────────────── */
  const hideStyle = document.createElement('style');
  hideStyle.textContent = `html.ncg-hide #${CONFIG.panelId}{visibility:hidden!important;pointer-events:none!important}`;
  document.documentElement.appendChild(hideStyle);

  let iconEl = null;
  let busy = 0; // >0 while the script itself drives the native panel
  let lastDown = { t: 0, shift: false, target: null };

  const iconTokens = (el) => [...el.classList].filter((c) => /^sc-[0-9a-f]+-\d+$/.test(c));
  function findIcon() {
    if (iconEl && iconEl.isConnected) return iconEl;
    for (const sel of [prefs.iconSel, CONFIG.iconSelector]) {
      if (!sel) continue;
      let el = null;
      try {
        el = document.querySelector(sel);
      } catch {}
      if (el) return (iconEl = el);
    }
    return null;
  }

  addEventListener(
    'pointerdown',
    (e) => {
      lastDown = { t: Date.now(), shift: e.shiftKey, target: e.target };
    },
    true,
  );

  async function openNative({ hidden = true } = {}) {
    if (getPanel()) return getPanel();
    const icon = findIcon();
    if (!icon) return null;
    busy++;
    if (hidden) document.documentElement.classList.add('ncg-hide');
    icon.click();
    const p = await waitFor(getPanel, 2000);
    if (!p) {
      busy--;
      document.documentElement.classList.remove('ncg-hide');
    }
    return p;
  }
  async function closeNative() {
    const icon = findIcon();
    if (getPanel() && icon) {
      icon.click();
      await waitFor(() => !getPanel(), 400);
    }
    if (getPanel()) {
      // click-outside fallback
      for (const t of ['mousedown', 'mouseup', 'click'])
        document.body.dispatchEvent(new MouseEvent(t, { bubbles: true }));
      await waitFor(() => !getPanel(), 400);
    }
    if (getPanel()) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await waitFor(() => !getPanel(), 300);
    }
    document.documentElement.classList.remove('ncg-hide');
    if (busy > 0) busy--;
  }

  /* ───────────────────────── scraping ───────────────────────── */
  const chunkInfo = (el) => ({
    label: (el.querySelector('span')?.textContent ?? '').trim(),
    expansion: (el.getAttribute('title') ?? '').replace(CONFIG.titleSuffix, ''),
    color: el.getAttribute('color') || '#6B7280',
    official: !/drag to reorder$/.test(el.getAttribute('title') ?? ''),
  });
  const headers = (panel) =>
    [...panel.querySelectorAll(CONFIG.headerSel)].filter((h) =>
      h.querySelector(CONFIG.headerMarker),
    );
  const headerInfo = (h) => {
    const spans = h.querySelectorAll(':scope > span');
    return {
      label: (spans[1]?.textContent ?? '').trim(),
      count: parseInt(spans[2]?.textContent ?? '0', 10) || 0,
      color: h.getAttribute('color'),
    };
  };
  const bodyChunks = (h) => [...(h.nextElementSibling?.querySelectorAll(CONFIG.chunkSel) ?? [])];

  async function expandCategory(h) {
    const { count } = headerInfo(h);
    if (!count || bodyChunks(h).length >= count) return false;
    (h.querySelector(':scope > span') ?? h).click();
    await waitFor(() => bodyChunks(h).length >= count, 600);
    return true;
  }

  async function scrape(panel) {
    const cats = [],
      chunks = [],
      expanded = [];
    const hs = headers(panel);
    for (const h of hs) {
      if (await expandCategory(h)) expanded.push(h);
    }
    const inCat = new Set();
    for (const h of hs) {
      const hi = headerInfo(h);
      cats.push(hi);
      for (const el of bodyChunks(h)) {
        inCat.add(el);
        chunks.push({ ...chunkInfo(el), cat: hi.label });
      }
    }
    // chunks outside any category (uncategorised + official), kept in DOM order
    for (const el of panel.querySelectorAll(CONFIG.chunkSel)) {
      if (inCat.has(el)) continue;
      const ci = chunkInfo(el);
      chunks.push({ ...ci, cat: ci.official ? '__official' : '' });
    }
    for (const h of expanded.reverse()) (h.querySelector(':scope > span') ?? h).click(); // restore collapsed state
    return { cats, chunks };
  }

  function reconcile(scraped) {
    const metas = Object.values(store.entries),
      used = new Set();
    const items = scraped.map((s) => ({ s, h: hash(s.expansion), m: null }));
    const pass = (match) => {
      for (const it of items) {
        if (it.m) continue;
        const m = metas.find((x) => !used.has(x.id) && match(x, it));
        if (m) {
          it.m = m;
          used.add(m.id);
        }
      }
    };
    pass((x, it) => x.label === it.s.label && x.hash === it.h);
    pass((x, it) => x.label === it.s.label);
    pass((x, it) => x.hash === it.h);
    for (const it of items) {
      if (!it.m) {
        it.m = { id: uid(), fav: false, uses: 0, last: 0, tags: [] };
        store.entries[it.m.id] = it.m;
        used.add(it.m.id);
      }
      it.m.label = it.s.label;
      it.m.hash = it.h;
      it.s.id = it.m.id;
    }
    saveStore();
    return scraped;
  }

  let model = st.get('snapshot', { cats: [], chunks: [] }); // cached so the gallery opens instantly
  async function refreshModel(panelAlreadyOpen) {
    const panel = panelAlreadyOpen ? getPanel() : await openNative();
    if (!panel) return false;
    try {
      const sc = await scrape(panel);
      model = { cats: sc.cats, chunks: reconcile(sc.chunks) };
      st.set('snapshot', model);
    } finally {
      await closeNative();
    }
    return true;
  }

  /* ───────────────────────── insert / edit through the native panel ───────────────────────── */
  function findChunkEl(panel, entry) {
    const all = [...panel.querySelectorAll(CONFIG.chunkSel)].filter(
      (el) => chunkInfo(el).label === entry.label,
    );
    return all.find((el) => chunkInfo(el).expansion === entry.expansion) ?? all[0] ?? null;
  }
  async function locate(panel, entry) {
    let el = findChunkEl(panel, entry);
    if (el) return { el, expanded: null };
    const h = headers(panel).find((x) => headerInfo(x).label === entry.cat);
    if (h && (await expandCategory(h))) {
      el = findChunkEl(panel, entry);
      if (el) return { el, expanded: h };
    }
    return { el: null, expanded: null };
  }

  function insertChunk(entry) {
    return queue(async () => {
      const panel = await openNative();
      if (!panel) return { ok: false, reason: 'native-panel' };
      const { el, expanded } = await locate(panel, entry);
      let ok = false,
        reason = 'not-found';
      if (el) {
        el.click();
        await sleep(120);
        ok = !document.body.innerText.includes(CONFIG.noEditorText);
        reason = ok ? '' : 'no-editor';
      }
      if (expanded) (expanded.querySelector(':scope > span') ?? expanded).click();
      await closeNative();
      if (ok) {
        const m = store.entries[entry.id];
        if (m) {
          m.uses = (m.uses || 0) + 1;
          m.last = Date.now();
          saveStore();
        }
      }
      return { ok, reason };
    });
  }

  async function openNativeVisible() {
    const p = await openNative({ hidden: false });
    if (busy > 0) busy--;
    return p;
  }

  /* Drive the native edit form (hidden) so the gallery can create / edit / delete chunks itself. */
  const setVal = (el, v) => {
    let proto = HTMLInputElement.prototype;
    if (el instanceof HTMLTextAreaElement) proto = HTMLTextAreaElement.prototype;
    else if (el instanceof HTMLSelectElement) proto = HTMLSelectElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const btnByText = (root, t) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === t);
  const hexRe = /^#?[0-9a-f]{6}$/i;

  function nativeEdit({ kind = 'chunk', entry, cat, values, remove }) {
    return queue(async () => {
      const panel = await openNative();
      if (!panel) return { ok: false, reason: 'native-panel' };
      const formOpen = () => panel.querySelector(CONFIG.formNameSel); // present for chunk AND category forms
      let expandedLabel = null;
      try {
        let trigger;
        if (kind === 'category') {
          trigger = cat
            ? headers(panel)
                .find((h) => headerInfo(h).label === cat.label)
                ?.querySelector(CONFIG.headerMarker)
            : panel.querySelector(CONFIG.addCatSel);
        } else if (entry) {
          const loc = await locate(panel, entry);
          if (loc.expanded) expandedLabel = headerInfo(loc.expanded).label;
          trigger = loc.el?.querySelector(CONFIG.editChunkSel);
        } else trigger = panel.querySelector(CONFIG.addChunkSel);
        if (!trigger) return { ok: false, reason: 'not-found' };
        trigger.click();
        const name = await waitFor(formOpen, 1500);
        if (!name) return { ok: false, reason: 'no-form' };
        if (remove) {
          const b = btnByText(panel, CONFIG.btn.del);
          if (!b) return { ok: false, reason: 'no-button' };
          b.click();
        } else {
          const ta = kind === 'chunk' ? panel.querySelector(CONFIG.formTextSel) : null,
            sel = kind === 'chunk' ? panel.querySelector(CONFIG.formCatSel) : null;
          const hex = [...panel.querySelectorAll('input')].find(
            (i) => i !== name && hexRe.test(i.value),
          );
          setVal(name, values.label);
          if (ta) setVal(ta, values.expansion);
          if (sel) {
            const opt = [...sel.options].find(
              (o) => o.textContent.trim() === (values.cat || '') || (!values.cat && o.value === ''),
            );
            if (opt) setVal(sel, opt.value);
          }
          if (hex && values.color) setVal(hex, values.color);
          await sleep(80);
          if (name.value !== values.label || (ta && ta.value !== values.expansion))
            return { ok: false, reason: 'form-rejected' };
          const save = btnByText(panel, CONFIG.btn.save);
          if (!save) return { ok: false, reason: 'no-button' };
          save.click();
        }
        const ok = !!(await waitFor(() => !formOpen(), 4000));
        if (!ok) return { ok: false, reason: 'save-failed' };
        if (kind === 'chunk') {
          if (remove && entry) {
            delete store.entries[entry.id];
            delThumb(entry.id);
            saveStore();
          } else if (entry) {
            const m = store.entries[entry.id];
            if (m) {
              m.label = values.label;
              m.hash = hash(values.expansion);
              saveStore();
            }
          }
        }
        await sleep(120);
        if (expandedLabel) {
          const h = headers(panel).find((x) => headerInfo(x).label === expandedLabel);
          if (h && bodyChunks(h).length) (h.querySelector(':scope > span') ?? h).click();
        }
        const sc = await scrape(panel);
        model = { cats: sc.cats, chunks: reconcile(sc.chunks) };
        st.set('snapshot', model);
        return { ok: true, reason: '' };
      } finally {
        if (formOpen()) btnByText(panel, CONFIG.btn.cancel)?.click(); // never leave a half-open native form behind
        await closeNative();
      }
    });
  }

  /* ───────────────────────── reorder by replaying the native drag-and-drop ───────────────────────── */
  const fireDrag = (el, type, dt, x = 0, y = 0) =>
    el.dispatchEvent(
      new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
        clientX: x,
        clientY: y,
      }),
    );

  /*
   * The native panel reorders with HTML5 drag-and-drop: dragstart on the item writes {id, sourceCategory,
   * index} for the DataTransfer, dragover/drop on the target applies the move (and saves it on dragend), and
   * the drop position comes from clientX against the target's mid-point. Replaying one synthetic drag is
   * therefore enough to move an item, and the site itself computes the indices.
   */
  function nativeDrag(from, to, half, refetch) {
    if (!from || !to || from === to) return false;
    const dt = new DataTransfer();
    dt.setDragImage = () => {}; // setDragImage is only meaningful in a real drag session
    fireDrag(from, 'dragstart', dt);
    const types = [...dt.types];
    if (!types.includes(CONFIG.macroMime) && !types.includes(CONFIG.catMime)) return false;
    const r = to.getBoundingClientRect();
    // A collapsed category keeps its children in the DOM without a layout box; the native handler then
    // compares against a zero rect, so any negative x means "before" and any positive x "after".
    let x = half === 'after' ? 1 : -1;
    if (r.width) x = half === 'after' ? r.right - 2 : r.left + 2;
    const y = r.height ? r.top + r.height / 2 : 0;
    fireDrag(to, 'dragover', dt, x, y);
    fireDrag(to, 'drop', dt, x, y);
    // The move can re-render the list and replace the dragged element, and the native handlers save on
    // dragend, so fall back to a fresh lookup of the same item.
    const src = from.isConnected ? from : refetch?.();
    fireDrag(src ?? from, 'dragend', dt);
    return true;
  }

  async function readOrder(panel) {
    await sleep(300); // the site persists the move asynchronously after the drop
    const sc = await scrape(panel);
    model = { cats: sc.cats, chunks: reconcile(sc.chunks) };
    st.set('snapshot', model);
  }

  /* target: { entry, after } drops next to a chunk, { cat } appends to a category ('' = uncategorized). */
  function moveChunkNative(source, target) {
    return queue(async () => {
      const panel = await openNative();
      if (!panel) return { ok: false, reason: 'native-panel' };
      try {
        const src = (await locate(panel, source)).el;
        if (!src) return { ok: false, reason: 'not-found' };
        let to = null;
        let half = 'after';
        if (target.cat === undefined) {
          to = (await locate(panel, target.entry)).el;
          half = target.after ? 'after' : 'before';
        } else if (target.cat) {
          to = headers(panel).find((h) => headerInfo(h).label === target.cat) ?? null;
        } else {
          // Uncategorized has no header: appending after its last chunk is the same move.
          const last = [...model.chunks].reverse().find((c) => !c.cat);
          if (!last) return { ok: false, reason: 'not-found' };
          if (last.id === source.id) return { ok: true, reason: '' };
          to = (await locate(panel, last)).el;
        }
        if (!to) return { ok: false, reason: 'not-found' };
        const retry = () => findChunkEl(panel, source);
        let ok = nativeDrag(src, to, half, retry);
        if (!ok) {
          await sleep(500); // a save in flight disables dragging for a moment
          ok = nativeDrag(src, to, half, retry);
        }
        if (!ok) return { ok: false, reason: 'drag-failed' };
        await readOrder(panel);
        return { ok: true, reason: '' };
      } finally {
        await closeNative();
      }
    });
  }

  /* Dragging a category onto another moves it to the target's slot, exactly like the native panel. */
  function moveCatNative(from, to) {
    return queue(async () => {
      const panel = await openNative();
      if (!panel) return { ok: false, reason: 'native-panel' };
      try {
        const hs = headers(panel);
        const src = hs.find((h) => headerInfo(h).label === from);
        const dst = hs.find((h) => headerInfo(h).label === to);
        if (!src || !dst) return { ok: false, reason: 'not-found' };
        const refetch = () => headers(panel).find((h) => headerInfo(h).label === from);
        let ok = nativeDrag(src, dst, 'before', refetch);
        if (!ok) {
          await sleep(500); // a save in flight disables dragging for a moment
          ok = nativeDrag(src, dst, 'before', refetch);
        }
        if (!ok) return { ok: false, reason: 'drag-failed' };
        await readOrder(panel);
        return { ok: true, reason: '' };
      } finally {
        await closeNative();
      }
    });
  }

  /* ───────────────────────── thumbnails ───────────────────────── */
  async function toThumb(blob) {
    const bmp = await createImageBitmap(blob);
    const W = CONFIG.thumbW,
      H = CONFIG.thumbH,
      ratio = W / H;
    let sw = bmp.width,
      sh = sw / ratio;
    if (sh > bmp.height) {
      sh = bmp.height;
      sw = sh * ratio;
    }
    const sx = (bmp.width - sw) / 2,
      sy = (bmp.height - sh) / 2;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    c.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, W, H);
    bmp.close?.();
    let url = c.toDataURL('image/webp', 0.82);
    if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/jpeg', 0.85);
    return url;
  }
  function setThumb(id, url) {
    thumbs.set(id, url);
    st.set(`thumb:${id}`, url);
  }
  function delThumb(id) {
    thumbs.delete(id);
    st.del(`thumb:${id}`);
  }

  function grabCurrentImage() {
    const host = document.getElementById('ncg-host');
    const cands = [...document.querySelectorAll('img,canvas')]
      .filter((el) => {
        if (host?.contains(el) || getPanel()?.contains(el)) return false;
        const r = el.getBoundingClientRect(),
          cs = getComputedStyle(el);
        return (
          r.width >= 128 &&
          r.height >= 128 &&
          cs.visibility !== 'hidden' &&
          cs.display !== 'none' &&
          r.bottom > 0 &&
          r.right > 0 &&
          r.top < innerHeight &&
          r.left < innerWidth
        );
      })
      .sort((a, b) => {
        const ra = a.getBoundingClientRect(),
          rb = b.getBoundingClientRect();
        return rb.width * rb.height - ra.width * ra.height;
      });
    return cands[0] ?? null;
  }
  async function blobFromEl(el) {
    if (el instanceof HTMLCanvasElement) return await new Promise((r) => el.toBlob(r));
    try {
      return await (await fetch(el.currentSrc || el.src)).blob();
    } catch {
      const c = document.createElement('canvas');
      c.width = el.naturalWidth;
      c.height = el.naturalHeight;
      c.getContext('2d').drawImage(el, 0, 0);
      return await new Promise((r) => c.toBlob(r));
    }
  }

  /* ───────────────────────── gallery UI (shadow DOM) ───────────────────────── */
  const svg = (inner, sz = 16, fill = 'none') =>
    `<svg viewBox="0 0 24 24" width="${sz}" height="${sz}" fill="${fill}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const ICON = {
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    insert: '<polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    image:
      '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>',
    pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
    trash:
      '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    refresh:
      '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
    list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    ext: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    upload:
      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
    folderPlus:
      '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/><line x1="12" x2="12" y1="10" y2="16"/><line x1="9" x2="15" y1="13" y2="13"/>',
    dice: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><path d="M16 8h.01"/><path d="M8 8h.01"/><path d="M8 16h.01"/><path d="M16 16h.01"/><path d="M12 12h.01"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  };
  const ic = (n, sz = 16, fill) => svg(ICON[n], sz, fill);

  let host = null,
    root = null,
    ui = null;
  const state = { q: '', cat: '__all', hoverId: null, open: false, menuFor: null, dragCat: null };

  const CSS = `
  :host{all:initial}
  /* Page CSS (e.g. \`div{color:...}\`) beats :host rules, so font and color are set on every root element inside the shadow tree. */
  .ov,.menu,.pv{font:14px/1.4 "Segoe UI",system-ui,-apple-system,"Helvetica Neue",Roboto,Arial,sans-serif;color:#e8e9f3}
  *{box-sizing:border-box}
  *::-webkit-scrollbar{width:10px;height:10px}
  *::-webkit-scrollbar-track,*::-webkit-scrollbar-corner{background:transparent}
  *::-webkit-scrollbar-button{display:none}
  *::-webkit-scrollbar-thumb{background:#34376e;border:2px solid transparent;border-radius:6px;background-clip:content-box}
  *::-webkit-scrollbar-thumb:hover{background:#4a4e9a;background-clip:content-box}
  @supports not selector(::-webkit-scrollbar){*{scrollbar-width:thin;scrollbar-color:#34376e transparent}}
  .ov{color-scheme:dark}
  [hidden]{display:none!important}
  .ov{position:fixed;inset:0;z-index:2147483000;background:rgba(5,6,16,.72);display:flex;align-items:center;justify-content:center}
  .win{position:relative;width:min(1320px,95vw);height:min(900px,92vh);background:#0f1022;border:1px solid #2b2d52;border-radius:10px;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.6);overflow:hidden}
  svg{display:block}
  .top{display:flex;gap:6px;align-items:center;padding:8px 12px;border-bottom:1px solid #23254a;background:#13142b}
  .top h1{font-size:15px;margin:0 10px 0 0;font-weight:600;white-space:nowrap}
  .sw{flex:1;min-width:120px;position:relative;display:flex;align-items:center}
  .sw svg{position:absolute;left:9px;opacity:.5;pointer-events:none}
  input[type=search]{width:100%;background:#0a0b1a;border:1px solid #2b2d52;color:inherit;border-radius:6px;padding:7px 10px 7px 32px;font:inherit;outline:none}
  input[type=search]:focus,.dlg input:focus,.dlg textarea:focus,.dlg select:focus{border-color:#7a7df0}
  select,option{background:#0a0b1a;color:#e8e9f3;font:inherit}
  select{border:1px solid #2b2d52;border-radius:6px;padding:6px 8px;cursor:pointer;outline:none}
  button{font:inherit;color:inherit;cursor:pointer}
  .ib{background:transparent;border:0;border-radius:6px;width:30px;height:30px;display:flex;align-items:center;justify-content:center;color:#a9abc9;padding:0}
  .ib:hover{background:#23254a;color:#fff}
  .ib.on{color:#fff;background:#2a2d6b}
  .sep{width:1px;height:20px;background:#2b2d52;margin:0 4px}
  .cols{display:flex;align-items:center;gap:6px;color:#8c8eb0;font-size:12px}
  input[type=range]{width:84px;accent-color:#7a7df0}
  .cols.off{opacity:.35;pointer-events:none}
  .body{flex:1;display:flex;min-height:0}
  .side{width:190px;border-right:1px solid #23254a;overflow:auto;padding:8px;background:#0c0d1e;flex:none}
  .side div{padding:6px 8px;border-radius:6px;cursor:pointer;display:flex;justify-content:space-between;gap:6px;color:#9ea0c2}
  .side div:hover{background:#17183a}
  .side div.sel{background:#23265a;color:#fff}
  .side small{opacity:.6}
  .side .ed{display:none;width:22px;height:22px;margin:-2px -4px -2px 0}
  .side div:hover .ed{display:flex}
  .side div:hover small.n{display:none}
  .side .ed.ib{border-radius:5px}
  .side div[draggable=true]{cursor:grab}
  .side div.dragging{opacity:.5}
  .side div.drop{background:#23265a;color:#fff}
  .side div.ov-before{box-shadow:inset 0 2px 0 #7a7df0}
  .side div.ov-after{box-shadow:inset 0 -2px 0 #7a7df0}
  .side hr{border:0;border-top:1px solid #23254a;margin:6px 0}
  .main{flex:1;overflow:auto;padding:12px}
  .grid{display:grid;grid-template-columns:repeat(var(--cols),minmax(0,1fr));gap:10px}
  .card{position:relative;background:#15163a;border:1px solid #26285a;border-radius:8px;overflow:hidden;cursor:pointer;min-width:0}
  .card:hover{border-color:#5d60c7}
  .card.drop{outline:2px dashed #7a7df0}
  .card.dragging{opacity:.45}
  .card.ov-before{box-shadow:inset 3px 0 0 #7a7df0}
  .card.ov-after{box-shadow:inset -3px 0 0 #7a7df0}
  .thumb{aspect-ratio:832/1216;background-size:cover;background-position:center;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;color:rgba(255,255,255,.8)}
  .meta{padding:6px 8px;display:flex;flex-direction:column;gap:1px;min-width:0}
  .name{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:6px}
  .dot{width:8px;height:8px;border-radius:50%;flex:none}
  .sub{font-size:11px;opacity:.55;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:14px}
  .favmark{position:absolute;top:6px;left:6px;color:#ffd24d;pointer-events:none;filter:drop-shadow(0 1px 2px rgba(0,0,0,.7))}
  .acts{position:absolute;top:5px;right:5px;display:flex;gap:2px;opacity:0;transition:opacity .12s}
  .card:hover .acts,.card:focus-within .acts{opacity:1}
  .acts button{width:24px;height:24px;border:0;border-radius:5px;background:rgba(10,11,26,.8);color:#cfd1ee;display:flex;align-items:center;justify-content:center;padding:0}
  .acts button:hover{background:#3a3d8f;color:#fff}
  .acts .star.on{color:#ffd24d}
  .list{display:flex;flex-direction:column;gap:6px}
  .list .card{display:flex;align-items:center}
  .list .thumb{width:40px;aspect-ratio:832/1216;flex:none;font-size:13px}
  .list .meta{flex:1;padding:4px 12px}
  .list .acts{top:50%;transform:translateY(-50%);right:8px}
  .list .favmark{top:50%;left:auto;right:96px;transform:translateY(-50%)}
  .empty{opacity:.6;padding:40px;text-align:center}
  .pv{position:fixed;z-index:2147483600;max-width:440px;max-height:60vh;overflow:hidden;background:#0a0b1a;border:1px solid #5d60c7;border-radius:8px;padding:10px 12px;box-shadow:0 8px 30px rgba(0,0,0,.6);pointer-events:none;white-space:pre-wrap;word-break:break-word;font:12px/1.45 ui-monospace,Consolas,monospace;color:#dfe0f5}
  .pv b{display:block;font:600 13px system-ui;margin-bottom:6px;color:#fff}
  .menu{position:fixed;z-index:2147483700;min-width:200px;background:#13142b;border:1px solid #2f3260;border-radius:8px;padding:4px;box-shadow:0 8px 30px rgba(0,0,0,.6)}
  .menu button{display:flex;align-items:center;gap:10px;width:100%;background:transparent;border:0;border-radius:5px;padding:7px 10px;text-align:left;color:#d6d8f0}
  .menu button:hover{background:#23265a}
  .menu button.danger{color:#ff8a8a}
  .toast{position:absolute;bottom:34px;left:50%;transform:translateX(-50%);background:#23265a;border:1px solid #5d60c7;padding:7px 14px;border-radius:8px;opacity:0;transition:opacity .2s;pointer-events:none;max-width:70%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .toast.show{opacity:1}
  .hint{font-size:11px;opacity:.5;padding:6px 12px;border-top:1px solid #23254a;background:#0c0d1e}
  .busy .main,.busy .side{opacity:.5;pointer-events:none}
  .dlgbg{position:absolute;inset:0;background:rgba(5,6,16,.6);display:flex;align-items:center;justify-content:center;z-index:5}
  .dlg{width:min(560px,92%);max-height:94%;overflow:auto;background:#13142b;border:1px solid #2f3260;border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:12px}
  .dlg h2{margin:0;font-size:15px}
  .dlg label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9ea0c2}
  .dlg input[type=text],.dlg textarea,.dlg select{background:#0a0b1a;border:1px solid #2b2d52;color:#e8e9f3;border-radius:6px;padding:7px 9px;font:inherit;font-size:13px;outline:none}
  .dlg textarea{resize:vertical;min-height:140px;font-family:ui-monospace,Consolas,monospace;font-size:12px}
  .dlg.wide{width:min(760px,94%)}
  .dcols{display:flex;gap:16px}
  .dimg{width:150px;flex:none;display:flex;flex-direction:column;gap:6px;align-items:center}
  .dprev{width:150px;aspect-ratio:832/1216;border:1px solid #2b2d52;border-radius:8px;background-size:cover;background-position:center;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:700;color:rgba(255,255,255,.8)}
  .dprev.drop{outline:2px dashed #7a7df0}
  .dibtns{display:flex;gap:2px}
  .dhint{font-size:11px;opacity:.5;text-align:center}
  .dfields{flex:1;min-width:0;display:flex;flex-direction:column;gap:12px}
  .dlg .r2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .dlg .cr{display:flex;gap:6px;align-items:center}
  .dlg input[type=color]{width:34px;height:32px;padding:0;border:1px solid #2b2d52;border-radius:6px;background:#0a0b1a}
  .dlg .cr input[type=text]{flex:1;min-width:0}
  .dlg .btns{display:flex;gap:8px;align-items:center}
  .dlg .btns .sp{flex:1}
  .tb{background:#1b1d3d;border:1px solid #2f3260;border-radius:6px;padding:6px 14px}
  .tb:hover{border-color:#7a7df0}
  .tb.pri{background:#3a3d8f;border-color:#5d60c7}
  .tb.dg{background:transparent;border-color:transparent;color:#ff8a8a}
  .tb.dg.arm{border-color:#ff8a8a}
  .tb:disabled{opacity:.5;pointer-events:none}
  `;

  function ensureUI() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'ncg-host';
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style>
    <div class="ov"><div class="win">
      <div class="top">
        <h1>Prompt Chunks</h1>
        <div class="sw">${ic('search', 15)}<input type="search" placeholder="Search name, text or category" id="q"></div>
        <select id="sort" title="Sort (drag to reorder needs Native order)"><option value="native">Native order</option><option value="name">Name A–Z</option><option value="uses">Most used</option></select>
        <div class="cols" id="colsw" title="Cards per row"><input type="range" id="cols" min="2" max="10" step="1"><span id="colsn"></span></div>
        <button class="ib" id="view" title="Grid / list"></button>
        <span class="sep"></span>
        <button class="ib" id="add" title="New chunk">${ic('plus')}</button>
        <button class="ib" id="addcat" title="New category">${ic('folderPlus')}</button>
        <button class="ib" id="rescan" title="Reload chunks from the native panel">${ic('refresh')}</button>
        <button class="ib" id="native" title="Open the native panel">${ic('ext')}</button>
        <button class="ib" id="close" title="Close (Esc)">${ic('x')}</button>
      </div>
      <div class="body"><div class="side" id="side"></div><div class="main" id="main"></div></div>
      <div class="hint">Click a card to copy its text · hover for Edit, Favorite and More (Insert into prompt lives in More; Shift keeps this open) · hover + Ctrl+V or drop an image to set a thumbnail · drag cards (or a sidebar category) to reorder in Native order · Alt+G toggles</div>
      <div class="toast" id="toast"></div>
      <div class="dlgbg" id="dlgbg" hidden></div>
    </div></div><div class="pv" id="pv" hidden></div><div class="menu" id="menu" hidden></div>`;
    const $ = (s) => root.querySelector(s);
    ui = {
      q: $('#q'),
      sort: $('#sort'),
      cols: $('#cols'),
      colsn: $('#colsn'),
      colsw: $('#colsw'),
      view: $('#view'),
      side: $('#side'),
      main: $('#main'),
      toast: $('#toast'),
      pv: $('#pv'),
      menu: $('#menu'),
      dlg: $('#dlgbg'),
      ov: $('.ov'),
      win: $('.win'),
    };

    ui.ov.addEventListener('mousedown', (e) => {
      if (!ui.menu.hidden && !e.composedPath().includes(ui.menu)) hideMenu();
      if (e.target === ui.ov && ui.dlg.hidden) closeGallery();
    });
    $('#close').onclick = closeGallery;
    ui.q.oninput = () => {
      state.q = ui.q.value;
      render();
    };
    ui.q.onkeydown = (e) => {
      if (e.key === 'Enter') {
        const f = visible()[0];
        if (f) doInsert(f, true);
      }
    };
    if (prefs.sort === 'recent') prefs.sort = 'native';
    ui.sort.onchange = () => {
      prefs.sort = ui.sort.value;
      savePrefs();
      render();
    };
    ui.cols.oninput = () => {
      prefs.cols = +ui.cols.value;
      savePrefs();
      applyCols();
    };
    ui.view.onclick = () => {
      prefs.view = prefs.view === 'grid' ? 'list' : 'grid';
      savePrefs();
      render();
    };
    $('#rescan').onclick = () => rescan(true);
    $('#add').onclick = () => openEditor(null);
    $('#addcat').onclick = () => openCatEditor(null);
    $('#native').onclick = async () => {
      closeGallery();
      await queue(() => openNativeVisible());
    };
    addEventListener('paste', onPaste, true);
    // Site shortcuts (w/a/s/d/f/q/+/-/1) only skip real inputs via document.activeElement, which is this host <div> from
    // the page's point of view, so they would swallow letters typed here. Keep key events inside the shadow root.
    for (const t of ['keydown', 'keyup', 'keypress'])
      root.addEventListener(t, (e) => e.stopPropagation());
  }

  function applyCols() {
    ui.main.style.setProperty('--cols', prefs.cols);
    ui.colsn.textContent = prefs.cols;
    ui.cols.value = prefs.cols;
  }

  let toastT;
  function toast(msg) {
    if (!ui) return;
    ui.toast.textContent = msg;
    ui.toast.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => ui.toast.classList.remove('show'), 2400);
  }

  function visible() {
    const q = state.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let list = model.chunks.map((c, i) => ({ ...c, i, m: store.entries[c.id] || {} }));
    const c = state.cat;
    if (c === '__fav') list = list.filter((x) => x.m.fav);
    else if (c === '__official') list = list.filter((x) => x.cat === '__official');
    else if (c === '__none') list = list.filter((x) => !x.cat);
    else if (c !== '__all') list = list.filter((x) => x.cat === c);
    if (q.length)
      list = list.filter((x) => {
        const hay = `${x.label} ${x.expansion} ${x.cat || ''} ${(x.m.tags || []).join(
          ' ',
        )}`.toLowerCase();
        return q.every((t) => hay.includes(t));
      });
    const s = prefs.sort;
    if (c !== '__recent') {
      if (s === 'name')
        list.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
      else if (s === 'uses') list.sort((a, b) => (b.m.uses || 0) - (a.m.uses || 0) || a.i - b.i);
    }
    return list;
  }

  const esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
    );
  const initials = (l) => (l.match(/[\p{L}\p{N}]/gu) || ['?']).slice(0, 2).join('').toUpperCase();
  const flat = (color) => `color-mix(in srgb, ${color} 45%, #15163a)`;

  /* reordering inside the gallery: our own drag types, replayed on the native panel by moveChunkNative/moveCatNative */
  const dragKind = (dt) => {
    if (!dt) return null;
    const types = [...dt.types];
    if (types.includes(CONFIG.dragChunkMime)) return 'chunk';
    if (types.includes(CONFIG.dragCatMime)) return 'cat';
    return null;
  };
  const catIndex = (label) => model.cats.findIndex((c) => c.label === label);

  async function moveChunkTo(id, target) {
    const src = model.chunks.find((c) => c.id === id);
    if (!src || src.cat === '__official') return;
    ui.win.classList.add('busy');
    const r = await moveChunkNative(src, target);
    ui.win.classList.remove('busy');
    render();
    toast(r.ok ? `Moved “${src.label}”` : failMsg(r.reason));
  }

  async function moveChunkIntoCat(id, cat) {
    const src = model.chunks.find((c) => c.id === id);
    if (!src || src.cat === '__official') return;
    if (src.cat === cat) {
      const same = model.chunks.filter((c) => c.cat === cat);
      if (same[same.length - 1]?.id === id) return toast('Already last in that category.');
    }
    await moveChunkTo(id, { cat });
  }

  async function moveCatTo(from, to) {
    ui.win.classList.add('busy');
    const r = await moveCatNative(from, to);
    ui.win.classList.remove('busy');
    render();
    toast(r.ok ? 'Category moved.' : failMsg(r.reason));
  }

  /* kind: 'cat' = a real category (draggable + drop target), 'drop' = drop target only, '' = plain row */
  function wireSideRow(el, key, kind) {
    el.onclick = () => {
      state.cat = key;
      render();
    };
    if (kind === 'cat') {
      el.ondragstart = (e) => {
        e.dataTransfer.setData(CONFIG.dragCatMime, key);
        e.dataTransfer.effectAllowed = 'move';
        el.classList.add('dragging');
        state.dragCat = key;
      };
      el.ondragend = () => {
        el.classList.remove('dragging');
        state.dragCat = null;
        ui.side
          .querySelectorAll('.ov-before,.ov-after,.drop')
          .forEach((r) => r.classList.remove('ov-before', 'ov-after', 'drop'));
      };
    }
    if (!kind) return;
    el.ondragover = (e) => {
      const what = dragKind(e.dataTransfer);
      if (!what || (what === 'cat' && kind !== 'cat')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (what === 'chunk') el.classList.add('drop');
      // the native panel moves the dragged category to the hovered row's slot, so the marker shows where it lands
      const s = catIndex(state.dragCat);
      const r = catIndex(key);
      el.classList.toggle('ov-after', s >= 0 && r >= 0 && s < r);
      el.classList.toggle('ov-before', s >= 0 && r >= 0 && s > r);
    };
    el.ondragleave = () => el.classList.remove('drop', 'ov-before', 'ov-after');
    el.ondrop = (e) => {
      e.preventDefault();
      el.classList.remove('drop', 'ov-before', 'ov-after');
      const what = dragKind(e.dataTransfer);
      if (what === 'cat') {
        const from = e.dataTransfer.getData(CONFIG.dragCatMime);
        if (from && from !== key) moveCatTo(from, key);
      } else if (what === 'chunk') {
        const id = e.dataTransfer.getData(CONFIG.dragChunkMime);
        if (id) moveChunkIntoCat(id, key === '__none' ? '' : key);
      }
    };
  }

  function renderSide() {
    const ch = model.chunks;
    const n = (f) => ch.filter(f).length;
    const row = (key, label, count, kind) =>
      `<div data-k="${esc(key)}"${kind === 'cat' ? ' draggable="true"' : ''} class="${state.cat === key ? 'sel' : ''}"><span>${esc(label)}</span><small class="n">${count}</small>${
        kind === 'cat'
          ? `<button class="ib ed" data-ec="${esc(key)}" title="Edit category">${ic('pencil', 13)}</button>`
          : ''
      }</div>`;
    const kinds = new Map();
    let h = '';
    const add = (key, label, count, kind = '') => {
      kinds.set(key, kind);
      h += row(key, label, count, kind);
    };
    add('__all', 'All', ch.length);
    add(
      '__fav',
      'Favorites',
      n((c) => store.entries[c.id]?.fav),
    );
    h += '<hr>';
    if (n((c) => !c.cat))
      add(
        '__none',
        'Uncategorized',
        n((c) => !c.cat),
        'drop',
      );
    for (const c of model.cats)
      add(
        c.label,
        c.label,
        n((x) => x.cat === c.label),
        'cat',
      );
    if (n((c) => c.cat === '__official'))
      h += `<hr>${row(
        '__official',
        'Official',
        n((c) => c.cat === '__official'),
      )}`;
    ui.side.innerHTML = h;
    for (const el of ui.side.querySelectorAll('[data-k]'))
      wireSideRow(el, el.dataset.k, kinds.get(el.dataset.k) || '');
    ui.side.querySelectorAll('[data-ec]').forEach(
      (b) =>
        (b.onclick = (e) => {
          e.stopPropagation();
          openCatEditor(model.cats.find((c) => c.label === b.dataset.ec));
        }),
    );
  }

  function render() {
    if (!ui) return;
    hidePreview();
    hideMenu();
    ui.sort.value = prefs.sort;
    ui.view.innerHTML = prefs.view === 'grid' ? ic('list') : ic('grid');
    ui.view.title = prefs.view === 'grid' ? 'Switch to list' : 'Switch to grid';
    ui.colsw.classList.toggle('off', prefs.view !== 'grid');
    applyCols();
    renderSide();
    const list = visible();
    if (!list.length) {
      ui.main.innerHTML = `<div class="empty">${model.chunks.length ? 'No chunks match.' : 'No chunks loaded yet. Press reload, or click the toolbar button once.'}</div>`;
      return;
    }
    ui.main.innerHTML = `<div class="${prefs.view === 'grid' ? 'grid' : 'list'}">${list
      .map((x) => {
        const t = thumbs.get(x.id);
        const bg = t ? `background-image:url(${t})` : `background-color:${flat(esc(x.color))}`;
        const sub =
          x.cat === '__official'
            ? 'Official'
            : [x.cat, x.m.uses ? `${x.m.uses}×` : ''].filter(Boolean).join(' · ');
        return `<div class="card" data-id="${x.id}">
        <div class="thumb" style="${bg}">${t ? '' : esc(initials(x.label))}</div>
        ${x.m.fav ? `<span class="favmark">${ic('star', 14, 'currentColor')}</span>` : ''}
        <div class="acts">
          ${x.cat === '__official' ? '' : `<button data-a="edit" title="Edit">${ic('pencil', 14)}</button>`}
          <button data-a="fav" class="star ${x.m.fav ? 'on' : ''}" title="Favorite">${ic('star', 14, x.m.fav ? 'currentColor' : 'none')}</button>
          <button data-a="more" title="More">${ic('more', 14)}</button>
        </div>
        <div class="meta"><div class="name"><i class="dot" style="background:${esc(x.color)}"></i><span>${esc(x.label)}</span></div><div class="sub">${esc(sub)}</div></div></div>`;
      })
      .join('')}</div>`;
    const byId = new Map(list.map((x) => [x.id, x]));
    const reorderable = prefs.sort === 'native'; // other sorts would hide the move
    ui.main.querySelectorAll('.card').forEach((card) => {
      const x = byId.get(card.dataset.id);
      const movable = reorderable && x.cat !== '__official' && !!x.id;
      card.onclick = (e) => {
        const b = e.target.closest('[data-a]');
        if (b) {
          e.stopPropagation();
          return action(b.dataset.a, x, e, b);
        }
        copyText(x);
      };
      card.onmouseenter = () => {
        state.hoverId = x.id;
        schedulePreview(card, x);
      };
      card.onmouseleave = () => {
        if (state.hoverId === x.id) state.hoverId = null;
        hidePreview();
      };
      const half = (e) => {
        const r = card.getBoundingClientRect();
        return e.clientX > r.left + r.width / 2 ? 'after' : 'before';
      };
      if (movable) {
        card.draggable = true;
        card.ondragstart = (e) => {
          e.dataTransfer.setData(CONFIG.dragChunkMime, x.id);
          e.dataTransfer.effectAllowed = 'move';
          card.classList.add('dragging');
          hidePreview();
        };
        card.ondragend = () => {
          card.classList.remove('dragging');
          // a drag can end anywhere; no dragleave fires for the card that was last hovered
          ui.main
            .querySelectorAll('.ov-before,.ov-after')
            .forEach((el) => el.classList.remove('ov-before', 'ov-after'));
          ui.side
            .querySelectorAll('.drop,.ov-before,.ov-after,.dragging')
            .forEach((el) => el.classList.remove('drop', 'ov-before', 'ov-after', 'dragging'));
          state.dragCat = null;
        };
      }
      card.ondragover = (e) => {
        e.preventDefault();
        const kind = dragKind(e.dataTransfer);
        if (kind !== 'chunk') return card.classList.add('drop'); // image drop
        const side = half(e);
        card.classList.toggle('ov-after', side === 'after');
        card.classList.toggle('ov-before', side === 'before');
      };
      card.ondragleave = () => card.classList.remove('drop', 'ov-before', 'ov-after');
      card.ondrop = (e) => {
        e.preventDefault();
        const side = half(e);
        card.classList.remove('drop', 'ov-before', 'ov-after');
        const kind = dragKind(e.dataTransfer);
        if (kind === 'cat') return; // a category has no meaning on a card
        const id = kind === 'chunk' ? e.dataTransfer.getData(CONFIG.dragChunkMime) : '';
        if (id) {
          if (id !== x.id) moveChunkTo(id, { entry: x, after: side === 'after' });
          return;
        }
        onDrop(e, x);
      };
    });
  }

  let pvT;
  function schedulePreview(card, x) {
    clearTimeout(pvT);
    pvT = setTimeout(() => {
      if (!card.isConnected || !ui.menu.hidden) return;
      ui.pv.innerHTML = `<b>${esc(x.label)}</b>${esc(x.expansion)}`;
      ui.pv.hidden = false;
      const r = card.getBoundingClientRect(),
        w = ui.pv.offsetWidth,
        h = ui.pv.offsetHeight;
      let left = r.right + 10;
      if (left + w > innerWidth - 8) left = Math.max(8, r.left - w - 10);
      const top = Math.min(Math.max(8, r.top), innerHeight - h - 8);
      ui.pv.style.left = `${left}px`;
      ui.pv.style.top = `${top}px`;
    }, 300);
  }
  function hidePreview() {
    clearTimeout(pvT);
    if (ui) ui.pv.hidden = true;
  }

  /* context menu ("more") */
  function hideMenu() {
    if (ui) {
      ui.menu.hidden = true;
      state.menuFor = null;
    }
  }
  function openMenu(btn, x) {
    hidePreview();
    const items = [
      ['insert', 'insert', 'Insert into prompt'],
      ['copy', 'copy', 'Copy text'],
      ['file', 'upload', 'Thumbnail from file'],
      ['grab', 'scan', 'Thumbnail from current image'],
      thumbs.has(x.id) && ['rmthumb', 'x', 'Remove thumbnail'],
    ].filter(Boolean);
    ui.menu.innerHTML = items
      .map(([a, i, l]) => `<button data-m="${a}">${ic(i, 15)}<span>${l}</span></button>`)
      .join('');
    ui.menu.hidden = false;
    state.menuFor = x.id;
    const r = btn.getBoundingClientRect(),
      w = ui.menu.offsetWidth,
      h = ui.menu.offsetHeight;
    ui.menu.style.left = `${Math.max(8, Math.min(r.right - w, innerWidth - w - 8))}px`;
    ui.menu.style.top = `${r.bottom + 4 + h > innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4}px`;
    ui.menu.querySelectorAll('[data-m]').forEach(
      (b) =>
        (b.onclick = (e) => {
          e.stopPropagation();
          hideMenu();
          action(b.dataset.m, x, e, btn);
        }),
    );
  }

  async function copyText(x) {
    try {
      await navigator.clipboard.writeText(x.expansion);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = x.expansion;
      ta.style.cssText = 'position:fixed;opacity:0';
      root.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {}
      ta.remove();
    }
    const m = store.entries[x.id];
    if (m) {
      m.uses = (m.uses || 0) + 1;
      saveStore();
    }
    toast(`Copied “${x.label}”`);
  }

  async function action(a, x, e, btn) {
    if (a === 'insert') doInsert(x, e.shiftKey);
    else if (a === 'more')
      state.menuFor === x.id && !ui.menu.hidden ? hideMenu() : openMenu(btn, x);
    else if (a === 'copy') copyText(x);
    else if (a === 'fav') {
      const m = store.entries[x.id];
      m.fav = !m.fav;
      saveStore();
      render();
    } else if (a === 'file') {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/*';
      inp.onchange = () => inp.files[0] && applyThumb(x, inp.files[0]);
      inp.click();
    } else if (a === 'grab') {
      const el = grabCurrentImage();
      if (!el) return toast('No large image found on the page.');
      try {
        const b = await blobFromEl(el);
        if (!b) throw new Error('no image data');
        await applyThumb(x, b);
      } catch {
        toast('Could not read that image (blocked by the browser).');
      }
    } else if (a === 'rmthumb') {
      delThumb(x.id);
      render();
    } else if (a === 'edit') openEditor(x);
  }

  /* create / edit dialogs (applied through the hidden native form) */
  let dlgPaste = null;
  function closeDlg() {
    if (!ui) return;
    ui.dlg.hidden = true;
    ui.dlg.innerHTML = '';
    dlgPaste = null;
  }
  const HEX6 = /^#[0-9a-f]{6}$/i;
  function randomColor() {
    // pleasant, readable on the dark UI: random hue, fixed saturation/lightness band
    const h = Math.random() * 360,
      sat = (55 + Math.random() * 20) / 100,
      l = (55 + Math.random() * 10) / 100;
    const a = sat * Math.min(l, 1 - l),
      f = (n) => {
        const k = (n + h / 30) % 12;
        return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
      };
    return `#${[f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }
  function wireColor(scope, onChange) {
    const col = scope.querySelector('#f-color'),
      hex = scope.querySelector('#f-hex');
    const set = (v) => {
      hex.value = v;
      if (HEX6.test(v)) col.value = v.toLowerCase();
      onChange?.();
    };
    col.oninput = () => set(col.value);
    hex.oninput = () => set(hex.value);
    scope.querySelector('#f-rand').onclick = () => set(randomColor());
    return { col, hex };
  }

  function openEditor(x) {
    const isNew = !x;
    const cats = model.cats.map((c) => c.label);
    let cur = '';
    if (x) cur = x.cat && x.cat !== '__official' ? x.cat : '';
    else if (cats.includes(state.cat)) cur = state.cat;
    const color = x?.color && HEX6.test(x.color) ? x.color : '#6B7280';
    const orig = {
      label: x?.label ?? '',
      expansion: x?.expansion ?? '',
      cat: cur,
      color: color.toLowerCase(),
    };
    let pend; // image change: undefined = untouched, null = remove, string = new thumbnail
    ui.dlg.innerHTML = `<div class="dlg wide">
      <h2>${isNew ? 'New chunk' : 'Edit chunk'}</h2>
      <div class="dcols">
        <div class="dimg">
          <div class="dprev" id="f-prev" title="Drop an image here"></div>
          <div class="dibtns">
            <button class="ib" id="f-file" title="Upload image">${ic('upload', 15)}</button>
            <button class="ib" id="f-grab" title="Use the image currently on the page">${ic('scan', 15)}</button>
            <button class="ib" id="f-rm" title="Remove image">${ic('x', 15)}</button>
          </div>
          <div class="dhint">Drop or paste (Ctrl+V)</div>
        </div>
        <div class="dfields">
          <label>Name<input type="text" id="f-name" value="${esc(orig.label)}"></label>
          <label>Text<textarea id="f-text">${esc(orig.expansion)}</textarea></label>
          <div class="r2">
            <label>Category<select id="f-cat"><option value="">Uncategorized</option>${cats.map((c) => `<option ${c === cur ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
            <label>Color<div class="cr"><input type="color" id="f-color" value="${orig.color}"><input type="text" id="f-hex" maxlength="7" value="${color}"><button class="ib" id="f-rand" type="button" title="Random color">${ic('dice', 16)}</button></div></label>
          </div>
        </div>
      </div>
      <div class="btns">${isNew ? '' : '<button class="tb dg" id="f-del">Delete</button>'}<span class="sp"></span><button class="tb" id="f-cancel">Cancel</button><button class="tb pri" id="f-save">Save</button></div></div>`;
    ui.dlg.hidden = false;
    const $ = (q) => ui.dlg.querySelector(q);
    const prev = $('#f-prev');
    const { hex } = wireColor(ui.dlg, () => renderPrev());

    function renderPrev() {
      const url = pend === undefined ? x && thumbs.get(x.id) : pend;
      prev.style.backgroundImage = url ? `url(${url})` : 'none';
      prev.style.backgroundColor = url ? '' : flat(HEX6.test(hex.value) ? hex.value : '#6B7280');
      prev.textContent = url ? '' : initials($('#f-name').value || '?');
    }
    const setPend = async (blob) => {
      try {
        pend = await toThumb(blob);
        renderPrev();
      } catch {
        toast('That file is not a readable image.');
      }
    };
    renderPrev();
    $('#f-name').addEventListener('input', renderPrev);
    dlgPaste = setPend;
    $('#f-file').onclick = () => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/*';
      inp.onchange = () => inp.files[0] && setPend(inp.files[0]);
      inp.click();
    };
    $('#f-grab').onclick = async () => {
      const el = grabCurrentImage();
      if (!el) return toast('No large image found on the page.');
      try {
        const b = await blobFromEl(el);
        if (!b) throw new Error('no image data');
        await setPend(b);
      } catch {
        toast('Could not read that image (blocked by the browser).');
      }
    };
    $('#f-rm').onclick = () => {
      pend = null;
      renderPrev();
    };
    prev.ondragover = (e) => {
      e.preventDefault();
      prev.classList.add('drop');
    };
    prev.ondragleave = () => prev.classList.remove('drop');
    prev.ondrop = async (e) => {
      e.preventDefault();
      prev.classList.remove('drop');
      const b = await blobFromDrop(e);
      b ? setPend(b) : toast('No image in that drop.');
    };

    const lock = (on) => ui.dlg.querySelectorAll('button').forEach((b) => (b.disabled = on));
    const finishImage = (id) => {
      if (!id) return;
      if (typeof pend === 'string') setThumb(id, pend);
      else if (pend === null) delThumb(id);
    };
    $('#f-cancel').onclick = closeDlg;
    $('#f-save').onclick = async () => {
      const label = $('#f-name').value.trim(),
        expansion = $('#f-text').value.trim();
      if (!label) return toast('Name is required.');
      if (!expansion) return toast('Text is required.');
      const c = HEX6.test(hex.value) ? hex.value : orig.color;
      const values = { label, expansion, cat: $('#f-cat').value, color: c };
      const changed =
        isNew ||
        label !== orig.label ||
        expansion !== orig.expansion ||
        values.cat !== orig.cat ||
        c.toLowerCase() !== orig.color;
      lock(true);
      $('#f-save').textContent = 'Applying…';
      let id = x?.id;
      if (changed) {
        const r = await nativeEdit({ entry: x, values });
        if (!r.ok) {
          lock(false);
          $('#f-save').textContent = 'Save';
          return toast(failMsg(r.reason));
        }
        if (isNew)
          id = model.chunks.find(
            (m) => m.label === label && hash(m.expansion) === hash(expansion),
          )?.id;
      }
      finishImage(id);
      closeDlg();
      render();
      toast(isNew ? 'Chunk created.' : 'Chunk saved.');
    };
    const del = $('#f-del');
    if (del)
      del.onclick = async () => {
        if (!del.classList.contains('arm')) {
          del.classList.add('arm');
          del.textContent = 'Click again to delete';
          return;
        }
        lock(true);
        const r = await nativeEdit({ entry: x, remove: true });
        if (!r.ok) {
          lock(false);
          return toast(failMsg(r.reason));
        }
        closeDlg();
        render();
        toast('Chunk deleted.');
      };
    $('#f-name').focus();
  }

  function openCatEditor(c) {
    const isNew = !c;
    const color = c?.color && HEX6.test(c.color) ? c.color : '#6B7280';
    ui.dlg.innerHTML = `<div class="dlg" style="width:min(420px,92%)">
      <h2>${isNew ? 'New category' : 'Edit category'}</h2>
      <label>Name<input type="text" id="f-name" value="${esc(c?.label ?? '')}"></label>
      <label>Color<div class="cr"><input type="color" id="f-color" value="${color.toLowerCase()}"><input type="text" id="f-hex" maxlength="7" value="${color}"><button class="ib" id="f-rand" type="button" title="Random color">${ic('dice', 16)}</button></div></label>
      ${isNew ? '' : '<div class="dhint" style="text-align:left">Deleting a category keeps its chunks (they move to Uncategorized).</div>'}
      <div class="btns">${isNew ? '' : '<button class="tb dg" id="f-del">Delete</button>'}<span class="sp"></span><button class="tb" id="f-cancel">Cancel</button><button class="tb pri" id="f-save">Save</button></div></div>`;
    ui.dlg.hidden = false;
    const $ = (q) => ui.dlg.querySelector(q);
    const { hex } = wireColor(ui.dlg);
    const lock = (on) => ui.dlg.querySelectorAll('button').forEach((b) => (b.disabled = on));
    $('#f-cancel').onclick = closeDlg;
    $('#f-save').onclick = async () => {
      const label = $('#f-name').value.trim();
      if (!label) return toast('Name is required.');
      if (model.cats.some((m) => m.label === label && m !== c))
        return toast('A category with that name already exists.');
      lock(true);
      $('#f-save').textContent = 'Applying…';
      const r = await nativeEdit({
        kind: 'category',
        cat: c,
        values: { label, color: HEX6.test(hex.value) ? hex.value : color },
      });
      if (!r.ok) {
        lock(false);
        $('#f-save').textContent = 'Save';
        return toast(failMsg(r.reason));
      }
      if (c && state.cat === c.label) state.cat = label;
      closeDlg();
      render();
      toast(isNew ? 'Category created.' : 'Category saved.');
    };
    const del = $('#f-del');
    if (del)
      del.onclick = async () => {
        if (!del.classList.contains('arm')) {
          del.classList.add('arm');
          del.textContent = 'Click again to delete';
          return;
        }
        lock(true);
        const r = await nativeEdit({ kind: 'category', cat: c, remove: true });
        if (!r.ok) {
          lock(false);
          return toast(failMsg(r.reason));
        }
        if (state.cat === c.label) state.cat = '__all';
        closeDlg();
        render();
        toast('Category deleted.');
      };
    $('#f-name').focus();
  }
  function failMsg(r) {
    const msgs = {
      'native-panel': 'Could not open the native panel.',
      'not-found': 'Chunk not found in the native panel — reload and retry.',
      'no-form': 'The native edit form did not open.',
      'no-button': 'Could not find the native Save/Delete button.',
      'form-rejected': 'The native form did not accept the values.',
      'save-failed': 'The native form did not confirm the save.',
      'drag-failed': 'The native panel did not accept the drag.',
    };
    return msgs[r] || 'Failed.';
  }

  async function applyThumb(x, blob) {
    try {
      setThumb(x.id, await toThumb(blob));
      render();
      toast(`Thumbnail set for “${x.label}”`);
    } catch (e) {
      console.warn('[ncg]', e);
      toast('That file is not a readable image.');
    }
  }
  function findById(id) {
    return model.chunks.find((c) => c.id === id);
  }
  async function onPaste(e) {
    if (!state.open) return;
    const f = [...(e.clipboardData?.files ?? [])].find((file) => file.type.startsWith('image/'));
    if (!f) return;
    if (!ui.dlg.hidden) {
      if (dlgPaste) {
        e.preventDefault();
        e.stopPropagation();
        dlgPaste(f);
      }
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const x = state.hoverId && findById(state.hoverId);
    if (!x) return toast('Hover a card first, then paste.');
    applyThumb(x, f);
  }
  async function blobFromDrop(e) {
    const f = [...(e.dataTransfer?.files ?? [])].find((file) => file.type.startsWith('image/'));
    if (f) return f;
    const url = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain');
    if (url && /^(https?:|blob:|data:image)/.test(url.trim())) {
      try {
        return await (await fetch(url.trim())).blob();
      } catch {
        return null;
      }
    }
    return null;
  }
  async function onDrop(e, x) {
    const b = await blobFromDrop(e);
    b ? applyThumb(x, b) : toast('No image in that drop.');
  }

  async function doInsert(x, keepOpen) {
    ui.win.classList.add('busy');
    const r = await insertChunk(x);
    ui.win.classList.remove('busy');
    if (r.ok) {
      if (keepOpen) {
        render();
        toast(`Inserted “${x.label}”`);
      } else closeGallery();
    } else
      toast(
        {
          'no-editor': 'Click in a prompt field first, then insert.',
          'not-found': 'Chunk not found in the native panel — press reload.',
        }[r.reason] || 'Could not open the native panel.',
      );
  }

  async function rescan(manual) {
    if (!ui) return;
    ui.win.classList.add('busy');
    const ok = await queue(() => refreshModel(false));
    ui.win.classList.remove('busy');
    if (!ok) {
      toast(
        findIcon()
          ? 'Could not open the native panel.'
          : 'Click the Prompt Chunks toolbar button once so the script can learn where it is.',
      );
    } else if (manual) toast(`${model.chunks.length} chunks loaded.`);
    render();
  }

  function openGallery() {
    ensureUI();
    if (!host.isConnected) document.documentElement.appendChild(host);
    state.open = true;
    state.hoverId = null;
    render();
    ui.q.focus();
    rescan(false);
  }
  function closeGallery() {
    state.open = false;
    hidePreview();
    hideMenu();
    closeDlg();
    host?.remove();
  }
  const toggleGallery = () => (state.open ? closeGallery() : openGallery());
  // Escape closes the top-most layer: menu, then dialog, then gallery
  const editable = (el) =>
    !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
  addEventListener(
    'keydown',
    (e) => {
      if (!state.open) return;
      if (e.key !== 'Escape') {
        // focus is on the page body (e.g. after clicking a card): plain keys must not pan/zoom the canvas behind the overlay
        if (!e.ctrlKey && !e.metaKey && !e.altKey && !editable(e.composedPath()[0]))
          e.stopPropagation();
        return;
      }
      e.stopPropagation();
      if (!ui.menu.hidden) hideMenu();
      else if (!ui.dlg.hidden) closeDlg();
      else closeGallery();
    },
    true,
  );

  /* ───────────────────────── interception of the native panel ───────────────────────── */
  // Selector-free: whenever the native panel appears without us driving it, take over.
  let wasOpen = false;
  async function onPanelOpened(at) {
    const down = lastDown;
    // `at` is taken inside the MutationObserver callback (microtask), so background-tab timer throttling cannot skew it
    const fromUser =
      at - down.t >= 0 && at - down.t < 900 && down.target && !getPanel()?.contains(down.target);
    if (!prefs.intercept || down.shift || !fromUser) return; // Shift+click keeps the native panel
    busy++; // we own the panel now
    document.documentElement.classList.add('ncg-hide'); // hidden before first paint
    // learn the toolbar button from this real click
    if (down.target instanceof Element && !iconEl?.isConnected) {
      iconEl = down.target;
      const toks = iconTokens(iconEl);
      if (toks.length) {
        prefs.iconSel = `.${toks.join('.')}`;
        savePrefs();
      }
    }
    ensureUI();
    document.documentElement.appendChild(host);
    state.open = true;
    render();
    ui.win.classList.add('busy');
    await queue(async () => {
      try {
        const sc = await scrape(getPanel());
        model = { cats: sc.cats, chunks: reconcile(sc.chunks) };
        st.set('snapshot', model);
      } catch (e) {
        console.warn('[ncg] scrape failed', e);
      }
      await closeNative();
    });
    ui.win.classList.remove('busy');
    render();
    ui.q.focus();
  }
  new MutationObserver(() => {
    const open = !!getPanel();
    if (open && !wasOpen && busy === 0) {
      wasOpen = true;
      onPanelOpened(Date.now());
    } else wasOpen = open;
  }).observe(document.documentElement, { childList: true, subtree: true });

  addEventListener(
    'keydown',
    (e) => {
      const h = CONFIG.hotkey;
      if (e.altKey === !!h.alt && e.key.toLowerCase() === h.key && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        toggleGallery();
      }
    },
    true,
  );
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Open chunk gallery', toggleGallery);
    GM_registerMenuCommand('Toggle replacing the native panel', () => {
      prefs.intercept = !prefs.intercept;
      savePrefs();
      alert(`Gallery replaces native panel: ${prefs.intercept}`);
    });
  }

  window.__ncg = {
    dbg: () => ({
      busy,
      wasOpen,
      down: { ...lastDown, target: String(lastDown.target?.className) },
      now: Date.now(),
    }),
    CONFIG,
    model: () => model,
    store,
    thumbs,
    scrape,
    openGallery,
    closeGallery,
    insertChunk,
    refreshModel,
  };
  console.log('[ncg] Prompt Chunk Gallery loaded');
})();
