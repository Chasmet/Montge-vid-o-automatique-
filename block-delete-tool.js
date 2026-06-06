/* V46 - Vider un bloc importé dans la Bibliothèque */
(function () {
  const PANEL_ID = "blockDeleteToolPanel";
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

      if (!groups.has(block)) {
        groups.set(block, []);
      }

      groups.get(block).push(item);
    }

    return Array.from(groups.entries())
      .map(([name, items]) => ({
        name,
        count: items.length,
        size: items.reduce((total, item) => {
          return total + Number(item.size || item.blob?.size || 0);
        }, 0),
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
        min-height: 48px;
        border: 1px solid rgba(248, 113, 113, .5);
        border-radius: 15px;
        background: linear-gradient(135deg, #ef4444, #991b1b);
        color: white;
        font-weight: 950;
        font-size: 15px;
      }

      .bdt-delete:active {
        transform: scale(.98);
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

      const searchInput = screen.querySelector(
        'input[placeholder*="Rechercher"], input[placeholder*="rechercher"]'
      );

      const searchBox = searchInput?.closest("div, section");

      if (searchBox?.parentElement) {
        searchBox.parentElement.insertBefore(panel, searchBox.nextSibling);
      } else {
        screen.prepend(panel);
      }
    }

    panel.innerHTML = buildPanelHtml();
  }

  async function emptyBlock(blockName) {
    if (busy) return;

    const name = getBlockName(blockName);
    const group = getImportedGroups().find((item) => item.name === name);

    if (!group) {
      toast("Bloc introuvable.");
      return;
    }

    const confirmed = confirm(
      `Vider le bloc "${group.name}" ?\n\n${group.count} ${mediaLabel()} seront retirés de l’application.\nLes fichiers source restent dans CHK.`
    );

    if (!confirmed) {
      toast("Suppression annulée.");
      return;
    }

    busy = true;

    try {
      for (const id of group.ids) {
        await mediaDelete(id);
      }

      await hydrateCache();

      if (typeof render === "function") {
        render();
      }

      setTimeout(injectPanel, 200);

      toast(`${group.count} ${mediaLabel()} supprimé${group.count > 1 ? "s" : ""}.`);
    } catch (error) {
      console.error(error);
      toast("Erreur pendant la suppression du bloc.");
    } finally {
      busy = false;
    }
  }

  document.addEventListener(
    "click",
    (event) => {
      const button = event.target.closest(".bdt-delete");
      if (!button) return;

      event.preventDefault();
      event.stopPropagation();

      emptyBlock(button.dataset.blockName || "");
    },
    true
  );

  setInterval(injectPanel, 1200);
  window.addEventListener("pageshow", injectPanel);
})();
