/* V47 - Vider un bloc importé : confirmation propre + état visible */
(function () {
  const PANEL_ID = "blockDeleteToolPanel";
  const CONFIRM_ID = "blockDeleteConfirmSheet";
  let busy = false;

  function isReady() {
    try {
      return (
        state &&
        state.route === "library" &&
        state.profile &&
        Array.isArray(state.cache?.media) &&
        typeof mediaDelete === "function" &&
        typeof hydrateCache === "function" &&
        typeof getBucketForProject === "function"
      );
    } catch {
      return false;
    }
  }

  function toast(message) {
    try {
      showToast(message);
    } catch {
      alert(message);
    }
  }

  function clean(value) {
    return (value || "").toString().trim();
  }

  function escapeHtml(value) {
    return clean(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function getBlockName(value) {
    try {
      return normalizeBlock(value);
    } catch {
      return clean(value) || "Vrac";
    }
  }

  function getMediaType() {
    return state.libraryType === "image" ? "image" : "video";
  }

  function getMode() {
    return state.libraryMode === "speech" ? "speech" : "music";
  }

  function getBucket() {
    return getBucketForProject(getMode(), getMediaType());
  }

  function mediaLabel() {
    return getMediaType() === "image" ? "images" : "vidéos";
  }

  function sizeText(bytes) {
    const size = Number(bytes || 0);
    if (size < 1024) return `${size} o`;
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} Ko`;
    return `${Math.round(size / 1024 / 1024)} Mo`;
  }

  function getImportedGroups() {
    if (!isReady()) return [];

    const bucket = getBucket();
    const mediaType = getMediaType();
    const groups = new Map();

    for (const item of state.cache.media) {
      if (item.owner !== state.profile) continue;
      if (item.bucket !== bucket) continue;
      if (item.mediaType !== mediaType) continue;

      const block = getBlockName(item.block || "Vrac");
      if (!groups.has(block)) groups.set(block, []);
      groups.get(block).push(item);
    }

    return Array.from(groups.entries())
      .map(([name, items]) => ({
        name,
        count: items.length,
        size: items.reduce((total, item) => total + Number(item.size || item.blob?.size || 0), 0),
        ids: items.map((item) => item.id).filter(Boolean)
      }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.name.localeCompare(b.name, "fr");
      });
  }

  function injectStyle() {
    if (document.getElementById("blockDeleteToolStyle")) return;

    const style = document.createElement("style");
    style.id = "blockDeleteToolStyle";
    style.textContent = `
      #blockDeleteToolPanel {
        margin: 14px 0;
        padding: 14px;
        border-radius: 22px;
        border: 1px solid rgba(248, 113, 113, .35);
        background: linear-gradient(180deg, rgba(127, 29, 29, .25), rgba(15, 23, 42, .92));
      }

      #blockDeleteToolPanel h3 {
        margin: 0 0 6px;
        color: #fff;
        font-size: 20px;
        line-height: 1.2;
      }

      #blockDeleteToolPanel p {
        margin: 0 0 10px;
        color: #cbd5e1;
        font-size: 13px;
        line-height: 1.35;
      }

      .bdt-card {
        padding: 12px;
        margin: 10px 0;
        border-radius: 18px;
        background: rgba(15, 23, 42, .76);
        border: 1px solid rgba(148, 163, 184, .18);
      }

      .bdt-title {
        font-weight: 950;
        color: #fff;
        font-size: 16px;
        line-height: 1.2;
        margin-bottom: 8px;
        word-break: break-word;
      }

      .bdt-meta {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 10px;
      }

      .bdt-meta span {
        padding: 7px 9px;
        border-radius: 999px;
        background: rgba(56, 189, 248, .14);
        border: 1px solid rgba(56, 189, 248, .25);
        color: #bae6fd;
        font-size: 12px;
        font-weight: 900;
      }

      .bdt-delete {
        width: 100%;
        min-height: 52px;
        border: 1px solid rgba(248, 113, 113, .5);
        border-radius: 15px;
        background: linear-gradient(135deg, #ef4444, #991b1b);
        color: white;
        font-weight: 950;
        font-size: 15px;
        transition: transform .12s ease, filter .12s ease, opacity .12s ease;
      }

      .bdt-delete:active {
        transform: scale(.98);
        filter: brightness(1.12);
      }

      .bdt-delete.is-busy {
        opacity: .8;
        pointer-events: none;
      }

      #blockDeleteConfirmSheet {
        position: fixed;
        inset: 0;
        z-index: 999999;
        background: rgba(2, 6, 23, .78);
        display: flex;
        align-items: flex-end;
        justify-content: center;
        padding: 14px;
      }

      .bdt-sheet {
        width: 100%;
        max-width: 560px;
        border-radius: 24px;
        padding: 18px;
        background: #0f172a;
        border: 1px solid rgba(248, 113, 113, .38);
        color: #fff;
        box-shadow: 0 -18px 44px rgba(0, 0, 0, .48);
      }

      .bdt-sheet h3 {
        margin: 0 0 8px;
        font-size: 23px;
        line-height: 1.15;
      }

      .bdt-sheet p {
        margin: 0 0 14px;
        color: #cbd5e1;
        line-height: 1.42;
        font-size: 14px;
      }

      .bdt-progress {
        height: 10px;
        border-radius: 999px;
        background: rgba(148, 163, 184, .22);
        overflow: hidden;
        margin: 12px 0 14px;
        display: none;
      }

      .bdt-progress span {
        display: block;
        height: 100%;
        width: 0%;
        border-radius: inherit;
        background: linear-gradient(90deg, #ef4444, #f97316);
        transition: width .16s ease;
      }

      .bdt-sheet.is-working .bdt-progress {
        display: block;
      }

      .bdt-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }

      .bdt-actions button {
        min-height: 52px;
        border: 0;
        border-radius: 16px;
        color: #fff;
        font-weight: 950;
        font-size: 15px;
      }

      .bdt-cancel {
        background: #334155;
      }

      .bdt-confirm {
        background: linear-gradient(135deg, #ef4444, #991b1b);
      }

      .bdt-actions button:disabled {
        opacity: .68;
      }
    `;

    document.head.appendChild(style);
  }

  function buildPanelHtml() {
    const groups = getImportedGroups();

    return `
      <h3>🧹 Vider un bloc importé</h3>
      <p>Supprime d’un coup les médias importés dans cette vue. Les fichiers source CHK ne sont pas touchés.</p>
      ${
        groups.length
          ? groups
              .map(
                (group) => `
                  <div class="bdt-card">
                    <div class="bdt-title">${escapeHtml(group.name)}</div>
                    <div class="bdt-meta">
                      <span>${group.count} ${mediaLabel()}</span>
                      <span>${sizeText(group.size)}</span>
                    </div>
                    <button class="bdt-delete" type="button" data-block-name="${escapeHtml(group.name)}">
                      Vider ce bloc
                    </button>
                  </div>
                `
              )
              .join("")
          : `<p>Aucun bloc importé dans cette vue.</p>`
      }
    `;
  }

  function injectPanel() {
    if (!isReady()) return;
    injectStyle();

    const screen = document.getElementById("screen");
    if (!screen) return;

    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement("section");
      panel.id = PANEL_ID;

      const searchInput = screen.querySelector('input[placeholder*="Rechercher"], input[placeholder*="rechercher"]');
      const searchBox = searchInput?.closest("div, section");

      if (searchBox?.parentElement) {
        searchBox.parentElement.insertBefore(panel, searchBox.nextSibling);
      } else {
        screen.prepend(panel);
      }
    }

    panel.innerHTML = buildPanelHtml();
  }

  function closeConfirm() {
    const sheet = document.getElementById(CONFIRM_ID);
    if (sheet) sheet.remove();
  }

  function openConfirm(group) {
    closeConfirm();
    injectStyle();

    const backdrop = document.createElement("div");
    backdrop.id = CONFIRM_ID;
    backdrop.innerHTML = `
      <div class="bdt-sheet">
        <h3>Confirmer la suppression</h3>
        <p><strong>${escapeHtml(group.name)}</strong><br>${group.count} ${mediaLabel()} vont être retiré${group.count > 1 ? "s" : ""} de Montage IA. Les fichiers d’origine dans Gestionnaire restent intacts.</p>
        <div class="bdt-progress"><span></span></div>
        <div class="bdt-actions">
          <button class="bdt-cancel" type="button">Annuler</button>
          <button class="bdt-confirm" type="button">Supprimer</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    backdrop.querySelector(".bdt-cancel").onclick = () => {
      if (busy) return;
      closeConfirm();
      toast("Suppression annulée.");
    };
    backdrop.querySelector(".bdt-confirm").onclick = () => runDelete(group, backdrop);
  }

  async function runDelete(group, backdrop) {
    if (busy) return;
    busy = true;

    const sheet = backdrop.querySelector(".bdt-sheet");
    const progress = backdrop.querySelector(".bdt-progress span");
    const buttons = [...backdrop.querySelectorAll("button")];
    buttons.forEach((button) => (button.disabled = true));
    sheet.classList.add("is-working");

    try {
      let done = 0;
      for (const id of group.ids) {
        await mediaDelete(id);
        done++;
        if (progress) progress.style.width = `${Math.round((done / group.ids.length) * 100)}%`;
      }

      await hydrateCache();
      if (typeof render === "function") render();
      closeConfirm();
      setTimeout(injectPanel, 200);
      toast(`${group.count} ${mediaLabel()} supprimé${group.count > 1 ? "s" : ""}.`);
    } catch (error) {
      console.error(error);
      toast("Erreur pendant la suppression du bloc.");
      buttons.forEach((button) => (button.disabled = false));
      sheet.classList.remove("is-working");
    } finally {
      busy = false;
    }
  }

  function emptyBlock(blockName, button) {
    if (busy) return;

    const name = getBlockName(blockName);
    const group = getImportedGroups().find((item) => item.name === name);

    if (!group) {
      toast("Bloc introuvable.");
      return;
    }

    if (button) {
      button.classList.add("is-busy");
      setTimeout(() => button.classList.remove("is-busy"), 450);
    }

    openConfirm(group);
  }

  document.addEventListener(
    "click",
    (event) => {
      const button = event.target.closest(".bdt-delete");
      if (!button) return;

      event.preventDefault();
      event.stopPropagation();

      emptyBlock(button.dataset.blockName || "", button);
    },
    true
  );

  setInterval(injectPanel, 1200);
  window.addEventListener("pageshow", injectPanel);
})();
