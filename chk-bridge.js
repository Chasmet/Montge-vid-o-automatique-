/*
  CHK Bridge V4
  Objectif : rendre la Bibliothèque médias plus claire et plus mobile.
  - CHK en haut de la page
  - boutons Images / Vidéos plus lisibles
  - dossiers CHK affichés en cartes
  - création manuelle conservée
  - import sans doublons
*/

const CHK_MANAGER_DB_NAME = "gestionnaire-mobile-db-final-v1";
const CHK_MANAGER_DB_VERSION = 1;
const CHK_MANAGER_STORE = "items";

let chkManagerDbPromise = null;
let chkBridgeInterval = null;
let chkBridgeCurrentSearch = "";
let chkBridgeExpandedFolderId = "";

function chkBridgeOpenManagerDb() {
  if (chkManagerDbPromise) return chkManagerDbPromise;

  chkManagerDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(CHK_MANAGER_DB_NAME, CHK_MANAGER_DB_VERSION);

    request.onerror = () => {
      reject(new Error("Impossible d’ouvrir la bibliothèque du Gestionnaire CHK."));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = () => {
      reject(new Error("La base du Gestionnaire CHK n’existe pas encore."));
    };
  });

  return chkManagerDbPromise;
}

async function chkBridgeGetAllManagerItems() {
  const db = await chkBridgeOpenManagerDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(CHK_MANAGER_STORE, "readonly");
    const store = transaction.objectStore(CHK_MANAGER_STORE);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function chkBridgeEscape(text) {
  return (text || "")
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function chkBridgeGetCurrentType() {
  const select = document.getElementById("libraryTypeSelect");

  if (select?.value === "video") return "video";
  if (select?.value === "image") return "image";

  try {
    return state.libraryType === "video" ? "video" : "image";
  } catch {
    return "image";
  }
}

function chkBridgeGetCurrentMode() {
  const select = document.getElementById("libraryModeSelect");

  if (select?.value === "speech") return "speech";
  if (select?.value === "music") return "music";

  try {
    return state.libraryMode || "music";
  } catch {
    return "music";
  }
}

function chkBridgeSetLibraryType(type) {
  const cleanType = type === "video" ? "video" : "image";
  const select = document.getElementById("libraryTypeSelect");

  if (select) {
    select.value = cleanType;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  try {
    state.libraryType = cleanType;
    render();
  } catch {}
}

function chkBridgeSetLibraryMode(mode) {
  const cleanMode = mode === "speech" ? "speech" : "music";
  const select = document.getElementById("libraryModeSelect");

  if (select) {
    select.value = cleanMode;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  try {
    state.libraryMode = cleanMode;
    render();
  } catch {}
}

function chkBridgeIsCompatibleFile(item, targetType) {
  if (!item || item.type !== "file") return false;

  const mime = item.mimeType || "";
  const name = (item.name || "").toLowerCase();

  if (targetType === "video") {
    return (
      mime.startsWith("video/") ||
      name.endsWith(".mp4") ||
      name.endsWith(".mov") ||
      name.endsWith(".webm") ||
      name.endsWith(".m4v") ||
      name.endsWith(".ogg")
    );
  }

  if (targetType === "image") {
    return (
      mime.startsWith("image/") ||
      name.endsWith(".jpg") ||
      name.endsWith(".jpeg") ||
      name.endsWith(".png") ||
      name.endsWith(".webp")
    );
  }

  return false;
}

function chkBridgeGetFolderChildren(folderId, allItems) {
  return allItems.filter((item) => item.parentId === folderId);
}

function chkBridgeCollectCompatibleFiles(folderId, allItems, targetType) {
  const result = [];
  const children = chkBridgeGetFolderChildren(folderId, allItems);

  for (const child of children) {
    if (child.type === "file" && chkBridgeIsCompatibleFile(child, targetType)) {
      result.push(child);
    }

    if (child.type === "folder") {
      result.push(...chkBridgeCollectCompatibleFiles(child.id, allItems, targetType));
    }
  }

  return result;
}

function chkBridgeBuildPath(folderId, itemsById) {
  const path = [];
  let current = itemsById.get(folderId);

  while (current) {
    path.unshift(current.name || "Dossier");
    if (!current.parentId) break;
    current = itemsById.get(current.parentId);
  }

  return path.join(" > ");
}

function chkBridgeFormatSize(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} o`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value >= 10 * 1024 ? 0 : 1)} Ko`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} Mo`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} Go`;
}

function chkBridgeExistingKeys(bucket) {
  try {
    return new Set(
      state.cache.media
        .filter((item) => item.bucket === bucket)
        .map((item) => `${item.fileName}__${item.size || 0}__${normalizeBlock(item.block || "Vrac")}`)
    );
  } catch {
    return new Set();
  }
}

async function chkBridgeListFolders(targetType) {
  const allItems = await chkBridgeGetAllManagerItems();
  const itemsById = new Map(allItems.map((item) => [item.id, item]));
  const bucket = getBucketForProject(chkBridgeGetCurrentMode(), targetType);
  const existingKeys = chkBridgeExistingKeys(bucket);

  return allItems
    .filter((item) => item.type === "folder")
    .filter((item) => item.id !== "root")
    .map((folder) => {
      const files = chkBridgeCollectCompatibleFiles(folder.id, allItems, targetType);
      const totalSize = files.reduce((sum, item) => sum + Number(item.size || item.blob?.size || 0), 0);
      const alreadyImported = files.filter((file) => {
        const blockName = normalizeBlock(folder.name || "Bloc CHK");
        const size = file.size || file.blob?.size || 0;
        return existingKeys.has(`${file.name}__${size}__${blockName}`);
      }).length;

      return {
        id: folder.id,
        name: folder.name || "Dossier",
        fullPath: chkBridgeBuildPath(folder.id, itemsById),
        count: files.length,
        newCount: Math.max(0, files.length - alreadyImported),
        alreadyImported,
        totalSize,
        files: files.slice(0, 8)
      };
    })
    .filter((folder) => folder.count > 0)
    .sort((a, b) => {
      if (b.newCount !== a.newCount) return b.newCount - a.newCount;
      return a.fullPath.localeCompare(b.fullPath, "fr");
    });
}

function chkBridgeInstallStyles() {
  if (document.getElementById("chkBridgeV4Styles")) return;

  const style = document.createElement("style");
  style.id = "chkBridgeV4Styles";
  style.textContent = `
    #chkBridgeQuickTabs,
    #chkBridgeSection,
    #chkBridgeManualHeader {
      animation: chkFadeUp .22s ease both;
    }

    @keyframes chkFadeUp {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    #chkBridgeQuickTabs {
      display: grid;
      gap: 12px;
      margin: 16px 0 18px;
    }

    .chk-type-tabs,
    .chk-mode-tabs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .chk-tab-btn,
    .chk-mode-btn {
      border: 1px solid rgba(148,163,184,.22);
      border-radius: 20px;
      min-height: 64px;
      padding: 12px;
      color: #f8fafc;
      background: linear-gradient(180deg, rgba(30,41,59,.92), rgba(15,23,42,.92));
      font-size: 17px;
      font-weight: 900;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.03), 0 14px 30px rgba(0,0,0,.18);
    }

    .chk-tab-btn.active,
    .chk-mode-btn.active {
      border-color: rgba(99,102,241,.82);
      background: linear-gradient(135deg, rgba(59,130,246,.95), rgba(147,51,234,.88));
      color: white;
    }

    .chk-mode-btn {
      min-height: 52px;
      font-size: 14px;
      opacity: .96;
    }

    #chkBridgeSection {
      border: 1px solid rgba(34,197,94,.34) !important;
      background: linear-gradient(180deg, rgba(6,78,59,.40), rgba(15,23,42,.96)) !important;
      box-shadow: 0 18px 42px rgba(0,0,0,.22), inset 0 0 0 1px rgba(255,255,255,.04);
      overflow: hidden;
    }

    .chk-bridge-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }

    .chk-bridge-title {
      margin: 0;
      font-size: 26px;
      line-height: 1.1;
      font-weight: 950;
    }

    .chk-bridge-kicker {
      margin: 0 0 6px;
      color: #86efac;
      text-transform: uppercase;
      font-size: 13px;
      letter-spacing: .08em;
      font-weight: 900;
    }

    .chk-bridge-desc {
      margin: 0 0 14px;
      color: rgba(226,232,240,.78);
      font-size: 15px;
      line-height: 1.45;
    }

    .chk-mini-btn {
      border: 1px solid rgba(148,163,184,.22);
      border-radius: 16px;
      background: rgba(15,23,42,.82);
      color: #f8fafc;
      font-weight: 900;
      padding: 12px 14px;
      min-height: 48px;
    }

    .chk-search {
      width: 100%;
      border: 1px solid rgba(148,163,184,.25);
      border-radius: 18px;
      background: rgba(15,23,42,.75);
      color: #f8fafc;
      font-size: 16px;
      padding: 15px 16px;
      margin: 4px 0 14px;
      outline: none;
    }

    .chk-search:focus {
      border-color: rgba(34,197,94,.68);
      box-shadow: 0 0 0 4px rgba(34,197,94,.12);
    }

    .chk-folder-list {
      display: grid;
      gap: 12px;
    }

    .chk-folder-card {
      border: 1px solid rgba(148,163,184,.20);
      border-radius: 22px;
      background: rgba(15,23,42,.66);
      padding: 14px;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.03);
    }

    .chk-folder-main {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      margin-bottom: 12px;
    }

    .chk-folder-icon {
      width: 46px;
      height: 46px;
      border-radius: 16px;
      display: grid;
      place-items: center;
      background: linear-gradient(135deg, rgba(59,130,246,.85), rgba(147,51,234,.75));
      font-size: 23px;
      flex: 0 0 auto;
    }

    .chk-folder-name {
      font-weight: 950;
      font-size: 18px;
      color: #f8fafc;
      line-height: 1.15;
      margin-bottom: 5px;
      word-break: break-word;
    }

    .chk-folder-path {
      color: rgba(203,213,225,.70);
      font-size: 13px;
      line-height: 1.3;
      word-break: break-word;
    }

    .chk-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
      margin-bottom: 12px;
    }

    .chk-badge {
      border-radius: 999px;
      padding: 7px 10px;
      background: rgba(30,41,59,.88);
      color: #e2e8f0;
      font-size: 12px;
      font-weight: 850;
    }

    .chk-badge.new {
      background: rgba(34,197,94,.18);
      color: #86efac;
    }

    .chk-badge.done {
      background: rgba(59,130,246,.18);
      color: #93c5fd;
    }

    .chk-card-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .chk-card-actions button {
      min-height: 48px;
      border-radius: 16px;
      font-weight: 950;
      border: 1px solid rgba(148,163,184,.22);
      color: #f8fafc;
      background: rgba(15,23,42,.86);
    }

    .chk-card-actions button.primary {
      border: none;
      background: linear-gradient(135deg, #22c55e, #2563eb);
      color: white;
    }

    .chk-preview-list {
      margin-top: 12px;
      border-top: 1px solid rgba(148,163,184,.18);
      padding-top: 10px;
      display: grid;
      gap: 8px;
    }

    .chk-preview-item {
      display: flex;
      align-items: center;
      gap: 9px;
      color: rgba(226,232,240,.86);
      font-size: 13px;
      background: rgba(2,6,23,.28);
      border-radius: 14px;
      padding: 9px;
    }

    .chk-preview-name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .chk-empty-box {
      border: 1px dashed rgba(148,163,184,.28);
      border-radius: 22px;
      padding: 18px;
      color: rgba(226,232,240,.78);
      line-height: 1.45;
      background: rgba(15,23,42,.46);
    }

    #chkBridgeManualHeader {
      border: 1px solid rgba(148,163,184,.18);
      border-radius: 22px;
      padding: 16px;
      background: linear-gradient(180deg, rgba(30,41,59,.62), rgba(15,23,42,.72));
      margin: 16px 0 12px;
    }

    #chkBridgeManualHeader h3 {
      margin: 0 0 6px;
      font-size: 22px;
      color: #f8fafc;
    }

    #chkBridgeManualHeader p {
      margin: 0;
      color: rgba(226,232,240,.72);
      line-height: 1.4;
    }

    .chk-hidden-technical-selects .row-2:first-of-type {
      opacity: .98;
    }
  `;

  document.head.appendChild(style);
}

function chkBridgeQuickTabsHtml() {
  const type = chkBridgeGetCurrentType();
  const mode = chkBridgeGetCurrentMode();

  return `
    <div id="chkBridgeQuickTabs">
      <div class="chk-type-tabs" aria-label="Type de média rapide">
        <button type="button" class="chk-tab-btn ${type === "video" ? "active" : ""}" data-chk-set-type="video">🎬 Vidéos</button>
        <button type="button" class="chk-tab-btn ${type === "image" ? "active" : ""}" data-chk-set-type="image">🖼️ Images</button>
      </div>
      <div class="chk-mode-tabs" aria-label="Catégorie rapide">
        <button type="button" class="chk-mode-btn ${mode === "music" ? "active" : ""}" data-chk-set-mode="music">🎵 Médias musique</button>
        <button type="button" class="chk-mode-btn ${mode === "speech" ? "active" : ""}" data-chk-set-mode="speech">🗣️ Médias voix</button>
      </div>
    </div>
  `;
}

function chkBridgeSectionHtml() {
  return `
    <div id="chkBridgeSection" class="result-box">
      <div class="chk-bridge-top">
        <div>
          <p class="chk-bridge-kicker">Import rapide</p>
          <h3 class="chk-bridge-title">Bibliothèque CHK</h3>
        </div>
        <button type="button" class="chk-mini-btn" id="chkBridgeRefreshBtn">↻</button>
      </div>

      <p class="chk-bridge-desc">
        Choisis une thématique de ton Gestionnaire CHK. Le nom du dossier devient automatiquement un bloc dans Studio vidéo IA.
      </p>

      <input id="chkBridgeSearch" class="chk-search" type="search" placeholder="Rechercher une thématique..." value="${chkBridgeEscape(chkBridgeCurrentSearch)}" />

      <div id="chkBridgeFolderList" class="chk-folder-list">
        <div class="chk-empty-box">Chargement des dossiers...</div>
      </div>

      <p id="chkBridgeInfo" class="small-note" style="margin-top:12px;">
        Les fichiers restent sur ton téléphone. Studio vidéo IA crée une copie locale pour le montage.
      </p>
    </div>
  `;
}

function chkBridgeManualHeaderHtml() {
  const type = chkBridgeGetCurrentType() === "video" ? "vidéos" : "images";

  return `
    <div id="chkBridgeManualHeader">
      <h3>✍️ Création manuelle</h3>
      <p>Garde le contrôle total : crée une thématique, choisis ton bloc, puis ajoute tes ${type} depuis le téléphone.</p>
    </div>
  `;
}

function chkBridgeIsLibraryVisible() {
  return !!document.getElementById("libraryMediaGrid") && !!document.getElementById("libraryFileInput");
}

function chkBridgeEnhanceHero() {
  const hero = document.querySelector("#screen .hero-card");
  if (!hero || hero.dataset.chkEnhanced === "1") return;

  const title = hero.querySelector("h2");
  const text = hero.querySelector(".hero-text");
  const kicker = hero.querySelector(".hero-kicker");

  if (kicker) kicker.textContent = "Médias";
  if (title) title.textContent = "Ma bibliothèque";
  if (text) text.textContent = "Range tes images et vidéos par thématique.";

  hero.dataset.chkEnhanced = "1";
}

function chkBridgeInjectQuickTabs() {
  if (document.getElementById("chkBridgeQuickTabs")) return;

  const hero = document.querySelector("#screen .hero-card");
  if (!hero) return;

  hero.insertAdjacentHTML("afterend", chkBridgeQuickTabsHtml());

  document.querySelectorAll("[data-chk-set-type]").forEach((button) => {
    button.addEventListener("click", () => {
      chkBridgeExpandedFolderId = "";
      chkBridgeSetLibraryType(button.dataset.chkSetType);
    });
  });

  document.querySelectorAll("[data-chk-set-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      chkBridgeExpandedFolderId = "";
      chkBridgeSetLibraryMode(button.dataset.chkSetMode);
    });
  });
}

function chkBridgeInjectSection() {
  if (!chkBridgeIsLibraryVisible()) return;
  chkBridgeInstallStyles();
  chkBridgeEnhanceHero();
  chkBridgeInjectQuickTabs();

  if (!document.getElementById("chkBridgeSection")) {
    const quickTabs = document.getElementById("chkBridgeQuickTabs");

    if (quickTabs) {
      quickTabs.insertAdjacentHTML("afterend", chkBridgeSectionHtml());
    } else {
      const fileInput = document.getElementById("libraryFileInput");
      const field = fileInput?.closest(".field");
      field?.insertAdjacentHTML("afterend", chkBridgeSectionHtml());
    }

    document.getElementById("chkBridgeRefreshBtn")?.addEventListener("click", async () => {
      chkBridgeExpandedFolderId = "";
      await chkBridgeRenderFolderCards();
      showToast("Dossiers CHK actualisés.");
    });

    document.getElementById("chkBridgeSearch")?.addEventListener("input", async (event) => {
      chkBridgeCurrentSearch = event.target.value || "";
      await chkBridgeRenderFolderCards();
    });
  }

  if (!document.getElementById("chkBridgeManualHeader")) {
    const fileInput = document.getElementById("libraryFileInput");
    const field = fileInput?.closest(".field");
    const createButton = document.querySelector('[data-action="create-custom-block"]')?.closest(".prompt-actions");

    if (createButton) {
      createButton.insertAdjacentHTML("beforebegin", chkBridgeManualHeaderHtml());
    } else if (field) {
      field.insertAdjacentHTML("beforebegin", chkBridgeManualHeaderHtml());
    }
  }

  chkBridgeRenderFolderCards().catch(console.error);
}

async function chkBridgeRenderFolderCards() {
  const container = document.getElementById("chkBridgeFolderList");
  const info = document.getElementById("chkBridgeInfo");
  if (!container) return;

  const targetType = chkBridgeGetCurrentType();
  const search = chkBridgeCurrentSearch.trim().toLowerCase();

  container.innerHTML = `<div class="chk-empty-box">Recherche des dossiers ${targetType === "video" ? "vidéo" : "image"}...</div>`;

  try {
    let folders = await chkBridgeListFolders(targetType);

    if (search) {
      folders = folders.filter((folder) => {
        const haystack = `${folder.name} ${folder.fullPath}`.toLowerCase();
        return haystack.includes(search);
      });
    }

    if (!folders.length) {
      container.innerHTML = `
        <div class="chk-empty-box">
          Aucun dossier avec des ${targetType === "video" ? "vidéos" : "images"} trouvé.<br>
          Ouvre le Gestionnaire CHK, crée une thématique, puis ajoute des fichiers.
        </div>
      `;

      if (info) {
        info.textContent = `Type actif : ${targetType === "video" ? "Vidéos" : "Images"}. Actualise après avoir ajouté des fichiers dans le Gestionnaire CHK.`;
      }

      return;
    }

    container.innerHTML = folders.map((folder) => chkBridgeFolderCardHtml(folder, targetType)).join("");

    container.querySelectorAll("[data-chk-import]").forEach((button) => {
      button.addEventListener("click", async () => {
        await chkBridgeImportFolder(button.dataset.chkImport);
      });
    });

    container.querySelectorAll("[data-chk-preview]").forEach((button) => {
      button.addEventListener("click", async () => {
        const id = button.dataset.chkPreview;
        chkBridgeExpandedFolderId = chkBridgeExpandedFolderId === id ? "" : id;
        await chkBridgeRenderFolderCards();
      });
    });

    if (info) {
      const totalNew = folders.reduce((sum, folder) => sum + folder.newCount, 0);
      info.textContent = `${folders.length} thématique${folders.length > 1 ? "s" : ""} trouvée${folders.length > 1 ? "s" : ""}. ${totalNew} nouveau${totalNew > 1 ? "x" : ""} fichier${totalNew > 1 ? "s" : ""} possible${totalNew > 1 ? "s" : ""}.`;
    }
  } catch (error) {
    console.error(error);

    container.innerHTML = `
      <div class="chk-empty-box">
        Gestionnaire CHK non trouvé.<br>
        Ouvre d’abord ton Gestionnaire CHK sur ce téléphone, crée un dossier et ajoute des fichiers.
      </div>
    `;

    if (info) {
      info.textContent = "Le Gestionnaire CHK doit être ouvert au moins une fois sur ce même téléphone et ce même navigateur.";
    }
  }
}

function chkBridgeFolderCardHtml(folder, targetType) {
  const typeIcon = targetType === "video" ? "🎬" : "🖼️";
  const typeLabel = targetType === "video" ? "vidéos" : "images";
  const isExpanded = chkBridgeExpandedFolderId === folder.id;
  const preview = isExpanded ? chkBridgePreviewHtml(folder.files) : "";

  return `
    <article class="chk-folder-card">
      <div class="chk-folder-main">
        <div class="chk-folder-icon">📁</div>
        <div>
          <div class="chk-folder-name">${chkBridgeEscape(folder.name)}</div>
          <div class="chk-folder-path">${chkBridgeEscape(folder.fullPath)}</div>
        </div>
      </div>

      <div class="chk-badges">
        <span class="chk-badge">${typeIcon} ${folder.count} ${typeLabel}</span>
        <span class="chk-badge new">➕ ${folder.newCount} nouveau${folder.newCount > 1 ? "x" : ""}</span>
        <span class="chk-badge done">✅ ${folder.alreadyImported} déjà importé${folder.alreadyImported > 1 ? "s" : ""}</span>
        <span class="chk-badge">💾 ${chkBridgeFormatSize(folder.totalSize)}</span>
      </div>

      <div class="chk-card-actions">
        <button type="button" data-chk-preview="${chkBridgeEscape(folder.id)}">${isExpanded ? "Masquer" : "Voir"}</button>
        <button type="button" class="primary" data-chk-import="${chkBridgeEscape(folder.id)}">Importer</button>
      </div>

      ${preview}
    </article>
  `;
}

function chkBridgePreviewHtml(files) {
  if (!files?.length) return "";

  return `
    <div class="chk-preview-list">
      ${files.map((file) => `
        <div class="chk-preview-item">
          <span>•</span>
          <span class="chk-preview-name">${chkBridgeEscape(file.name || "Fichier")}</span>
          <span>${chkBridgeFormatSize(file.size || file.blob?.size || 0)}</span>
        </div>
      `).join("")}
    </div>
  `;
}

async function chkBridgeEnsureCustomBlock(blockName) {
  const cleanBlock = normalizeBlock(blockName || "Bloc CHK");

  if (!allMediaBlocks().includes(cleanBlock)) {
    state.customBlocks.push(cleanBlock);
    state.customBlocks = [...new Set(state.customBlocks)].sort((a, b) => a.localeCompare(b, "fr"));
    await saveCustomBlocks();
  }

  return cleanBlock;
}

async function chkBridgeImportFolder(selectedFolderId) {
  if (!selectedFolderId) {
    showToast("Choisis un dossier CHK.");
    return;
  }

  const targetType = chkBridgeGetCurrentType();
  const bucket = getBucketForProject(state.libraryMode, targetType);

  const allItems = await chkBridgeGetAllManagerItems();
  const selectedFolder = allItems.find((item) => item.id === selectedFolderId);

  if (!selectedFolder) {
    showToast("Dossier introuvable.");
    return;
  }

  const files = chkBridgeCollectCompatibleFiles(selectedFolderId, allItems, targetType);

  if (!files.length) {
    showToast(`Aucun fichier ${targetType === "video" ? "vidéo" : "image"} dans ce dossier.`);
    return;
  }

  startUiStatus("Import CHK", [
    "📂 Lecture du dossier CHK...",
    "🏷️ Création du bloc thématique...",
    "🎬 Copie des médias dans Studio vidéo IA...",
    "🧠 Analyse locale de l’orientation...",
    "✅ Finalisation de la bibliothèque..."
  ]);

  try {
    const blockName = await chkBridgeEnsureCustomBlock(selectedFolder.name || "Bloc CHK");

    let importedCount = 0;
    let skippedCount = 0;

    const existingKeys = new Set(
      state.cache.media
        .filter((item) => item.bucket === bucket)
        .map((item) => `${item.fileName}__${item.size || 0}__${normalizeBlock(item.block || "Vrac")}`)
    );

    for (const fileItem of files) {
      if (!fileItem.blob) {
        skippedCount += 1;
        continue;
      }

      const size = fileItem.size || fileItem.blob.size || 0;
      const duplicateKey = `${fileItem.name}__${size}__${blockName}`;

      if (existingKeys.has(duplicateKey)) {
        skippedCount += 1;
        continue;
      }

      const orientation = await detectFileOrientation(fileItem.blob, targetType);

      await mediaPut({
        id: uid("chk_media"),
        owner: state.profile,
        bucket,
        mediaType: targetType,
        fileName: fileItem.name || `media-${Date.now()}`,
        mimeType: fileItem.mimeType || fileItem.blob.type || "*/*",
        size,
        createdAt: nowISO(),
        block: blockName,
        orientation,
        tags: ["gestionnaire-chk", selectedFolder.name || "CHK"],
        source: "gestionnaire-chk",
        sourceFolderId: selectedFolder.id,
        sourceFileId: fileItem.id,
        blob: fileItem.blob
      });

      existingKeys.add(duplicateKey);
      importedCount += 1;
    }

    await hydrateCache();

    try {
      state.libraryBlockFilter = blockName;
      const filter = document.getElementById("libraryBlockFilter");
      if (filter) filter.value = blockName;
    } catch {}

    stopUiStatus("Import terminé.");
    render();

    if (importedCount > 0) {
      showToast(`${importedCount} média${importedCount > 1 ? "s importés" : " importé"} dans ${blockName}.`);
    } else if (skippedCount > 0) {
      showToast("Aucun nouveau média : déjà importé.");
    } else {
      showToast("Aucun média importé.");
    }
  } catch (error) {
    console.error(error);
    stopUiStatus("Erreur import CHK.");
    showToast(error.message || "Erreur pendant l’import CHK.");
  }
}

function chkBridgeBoot() {
  if (chkBridgeInterval) return;

  chkBridgeInterval = setInterval(() => {
    try {
      chkBridgeInjectSection();
    } catch (error) {
      console.error("CHK Bridge:", error);
    }
  }, 500);

  console.log("CHK Bridge V4 actif.");
}

chkBridgeBoot();
