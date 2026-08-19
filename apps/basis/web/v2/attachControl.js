/**
 * attachControl — the projector-driven "+" attach affordance (lights J4).
 *
 * Builds the composer's attach control from `renderAttachments(manifest).attachMenu`
 * (the ATTACHMENT projector, a family-(b) peer of renderSlash). It REPLACES the
 * hand-coded 📎 file button that BOTH the prikbord composer (`circleNoticeboard.js`)
 * and the circle composer (`circleView.js`) used to hard-wire — the exact drift a
 * projector should own (invariants #3/#4: one manifest declaration, every surface).
 *
 * Each menu entry taps to `{opId,args}` → dispatch, EXACTLY like a slash command
 * ("attach a photo" = the `embed-file` op firing). Two dispatch paths:
 *   · the FILE entry (`attachFileOpId`, default `embed-file`) routes back through the
 *     host's media pipeline (`onAttach` → createMediaEmbed / sealed upload) — the
 *     pre-projector 📎 behaviour, unchanged;
 *   · every OTHER entry calls `onAttachCommand(entry)`, which the host maps to
 *     `callSkill`/`dispatchReady` (params gathered via the existing form machinery
 *     when the op declares them).
 *
 * Pure DOM builder (a web idiom, so it lives in the web shell, not shared `src/`).
 * Returns a DocumentFragment the caller appends into its composer row, or `null`
 * when there is nothing usable to render (no wired file path AND no dispatchable
 * entries) — so a p0/p1 sealed-only circle with no menu shows no affordance, byte-
 * for-byte as before.
 *
 * @param {object}   o
 * @param {Array<{label?:string,opId:string,params?:any[],itemType?:string,group?:string}>} [o.attachMenu]
 *   the projected entries (`renderAttachments(manifest).attachMenu`).
 * @param {string}   [o.attachFileOpId='embed-file']  which entry uses the media pipeline.
 * @param {(file:File)=>void} [o.onAttach]        media pipeline for the file entry.
 * @param {(entry:object)=>void} [o.onAttachCommand]  {opId}→dispatch for every other entry.
 * @param {string}   [o.fileAccept]               file-input `accept` for the picker.
 * @param {(suffix:string)=>string} o.cls         class namer (per-composer namespace).
 * @param {(key:string)=>string} [o.tr]           locale resolver (labels are keys, invariant #8).
 * @param {string}   [o.menuLabelKey]             aria/title locale key for the "+" trigger.
 * @returns {DocumentFragment|null}
 */
export function buildAttachControl({
  attachMenu = [],
  attachFileOpId = 'embed-file',
  onAttach,
  onAttachCommand,
  fileAccept = 'image/png,image/jpeg,image/webp',
  cls,
  tr = (k) => k,
  menuLabelKey,
} = {}) {
  const t = typeof tr === 'function' ? tr : (k) => k;
  const namer = typeof cls === 'function' ? cls : (s) => s;
  const hasFile = typeof onAttach === 'function';
  const hasCmd = typeof onAttachCommand === 'function';

  // An entry is usable iff its dispatch path is wired: the file entry needs the
  // media pipeline (onAttach); every other entry needs onAttachCommand.
  const entries = (Array.isArray(attachMenu) ? attachMenu : []).filter((e) =>
    e && (e.opId === attachFileOpId ? hasFile : hasCmd));

  // Back-compat: the host wired the media pipeline but passed no projected menu
  // (or the projector produced none) → a lone file entry, the pre-projector 📎.
  if (!entries.length && hasFile) entries.push({ opId: attachFileOpId });
  if (!entries.length) return null;

  const frag = document.createDocumentFragment();

  // Hidden file input — the media pipeline's picker (kept from the 📎 era). A user
  // gesture must open it, so the trigger/menu-item CLICKS it directly (not the host).
  let fileInput = null;
  if (hasFile) {
    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = fileAccept;
    fileInput.className = namer('file');
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      if (f) onAttach(f);
      fileInput.value = '';
    });
    frag.appendChild(fileInput);
  }

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = namer('attach');
  trigger.textContent = '+';
  if (menuLabelKey) {
    trigger.title = t(menuLabelKey);
    trigger.setAttribute('aria-label', t(menuLabelKey));
  }
  frag.appendChild(trigger);

  const runEntry = (entry) => {
    if (entry.opId === attachFileOpId && hasFile) { fileInput.click(); return; }
    if (hasCmd) onAttachCommand(entry);
  };

  // A lone file entry keeps the one-tap 📎 UX: "+" opens the picker directly (no
  // dropdown to choose from). Only a real menu (2+ entries, or a non-file entry)
  // needs the popup.
  const soloFile = entries.length === 1 && entries[0].opId === attachFileOpId && hasFile;
  if (soloFile) {
    trigger.addEventListener('click', () => fileInput.click());
    return frag;
  }

  const menu = document.createElement('div');
  menu.className = namer('attach-menu');
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  for (const entry of entries) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = namer('attach-item');
    item.setAttribute('role', 'menuitem');
    item.dataset.opId = entry.opId;
    if (entry.itemType) item.dataset.itemType = entry.itemType;
    item.textContent = t(entry.label ?? entry.opId);
    item.addEventListener('click', () => { menu.hidden = true; syncExpanded(); runEntry(entry); });
    menu.appendChild(item);
  }

  const syncExpanded = () => trigger.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
  trigger.setAttribute('aria-haspopup', 'menu');
  syncExpanded();
  trigger.addEventListener('click', () => { menu.hidden = !menu.hidden; syncExpanded(); });

  frag.appendChild(menu);
  return frag;
}
