/*
  UX Finale - Studio vidéo IA
  Objectif : bibliothèque plus propre, import CHK contrôlé, albums/blocs, manuel conservé, durées longues.
*/

const UX_MANAGER_DB_NAME = "gestionnaire-mobile-db-final-v1";
const UX_MANAGER_DB_VERSION = 1;
const UX_MANAGER_STORE = "items";

let uxManagerDbPromise = null;
let uxTimer = null;
let uxReady = false;
let uxSearch = "";
let uxExpandedFolderId = "";
let uxAlbumFilter = "all";
let uxManualOpen = false;

function uxOpenManagerDb() {
  if (uxManagerDbPromise) return uxManagerDbPromise;

  uxManagerDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(UX_MANAGER_DB_NAME, UX_MANAGER_DB_VERSION);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error("Gestionnaire CHK introuvable."));
    req.onupgradeneeded = () => reject(new Error("Ouvre d’abord le Gestionnaire CHK."));
  });

  return uxManagerDbPromise;
}

async function uxGetManagerItems() {
  const db = await uxOpenManagerDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(UX_MANAGER_STORE, "readonly");
    const store = tx.objectStore(UX_MANAGER_STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error || new Error("Lecture CHK impossible."));
  });
}

function uxEscape(value) {
  return (value || "")
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function uxToast(message) {
  try {
    showToast(message);
  } catch {
    alert(message);
  }
}

function uxCurrentType() {
  try {
    return state.libraryType === "image" ? "image" : "video";
  } catch {
    return "video";
  }
}

function uxCurrentMode() {
  try {
    return state.libraryMode === "speech" ? "speech" : "music";
  } catch {
    return "music";
  }
}

function uxSetType(type) {
  try {
    state.libraryType = type === "image" ? "image" : "video";
    state.libraryBlockFilter = "all";
    uxAlbumFilter = "all";
    render();
  } catch {}
}

function uxSetMode(mode) {
  try {
    state.libraryMode = mode === "speech" ? "speech" : "music";
    state.libraryBlockFilter = "all";
    uxAlbumFilter = "all";
    render();
  } catch {}
}

function uxKindLabel() {
  return uxCurrentType() === "image" ? "images" : "vidéos";
}

function uxIcon() {
  return uxCurrentType() === "image" ? "🖼️" : "🎬";
}

function uxSize(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} o`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value > 10240 ? 0 : 1)} Ko`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(value > 10485760 ? 0 : 1)} Mo`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} Go`;
}

function uxCompatibleFile(item, type = uxCurrentType()) {
  if (!item || item.type !== "file") return false;
  const mime = item.mimeType || item.blob?.type || "";
  const name = (item.name || "").toLowerCase();

  if (type === "video") {
    return mime.startsWith("video/") || [".mp4", ".mov", ".webm", ".m4v", ".ogg"].some((ext) => name.endsWith(ext));
  }

  return mime.startsWith("image/") || [".jpg", ".jpeg", ".png", ".webp"].some((ext) => name.endsWith(ext));
}

function uxChildren(folderId, allItems) {
  return allItems.filter((item) => item.parentId === folderId);
}

function uxDirectFiles(folderId, allItems, type = uxCurrentType()) {
  return uxChildren(folderId, allItems).filter((item) => uxCompatibleFile(item, type));
}

function uxHasSubFiles(folderId, allItems, type = uxCurrentType()) {
  const folders = uxChildren(folderId, allItems).filter((item) => item.type === "folder");

  for (const folder of folders) {
    if (uxDirectFiles(folder.id, allItems, type).length) return true;
    if (uxHasSubFiles(folder.id, allItems, type)) return true;
  }

  return false;
}

function uxFolderPath(folderId, map) {
  const names = [];
  let current = map.get(folderId);

  while (current) {
    names.unshift(current.name || "Dossier");
    if (!current.parentId) break;
    current = map.get(current.parentId);
  }

  return names.join(" > ");
}

function uxBucket() {
  return getBucketForProject(uxCurrentMode(), uxCurrentType());
}

function uxExistingKeys(bucket = uxBucket()) {
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

async function uxListChkFolders() {
  const type = uxCurrentType();
  const bucket = uxBucket();
  const existing = uxExistingKeys(bucket);
  const allItems = await uxGetManagerItems();
  const map = new Map(allItems.map((item) => [item.id, item]));

  return allItems
    .filter((item) => item.type === "folder" && item.id !== "root")
    .map((folder) => {
      const files = uxDirectFiles(folder.id, allItems, type);
      const block = normalizeBlock(folder.name || "Bloc CHK");
      const imported = files.filter((file) => {
        const size = file.size || file.blob?.size || 0;
        return existing.has(`${file.name}__${size}__${block}`);
      }).length;

      return {
        id: folder.id,
        name: folder.name || "Dossier",
        path: uxFolderPath(folder.id, map),
        files,
        count: files.length,
        imported,
        newCount: Math.max(0, files.length - imported),
        size: files.reduce((sum, file) => sum + Number(file.size || file.blob?.size || 0), 0),
        hasSub: uxHasSubFiles(folder.id, allItems, type)
      };
    })
    .filter((folder) => folder.count > 0)
    .filter((folder) => {
      const q = uxSearch.trim().toLowerCase();
      if (!q) return true;
      return `${folder.name} ${folder.path}`.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      if (b.newCount !== a.newCount) return b.newCount - a.newCount;
      return a.path.localeCompare(b.path, "fr");
    });
}

function uxGetAlbums() {
  const bucket = uxBucket();
  const items = state.cache.media.filter((item) => item.bucket === bucket);
  const groups = new Map();

  for (const item of items) {
    const block = normalizeBlock(item.block || "Vrac");
    if (!groups.has(block)) groups.set(block, []);
    groups.get(block).push(item);
  }

  return [...groups.entries()]
    .map(([name, list]) => ({
      name,
      count: list.length,
      size: list.reduce((sum, item) => sum + Number(item.size || item.blob?.size || 0), 0),
      latest: list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0]?.createdAt || ""
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

function uxLibraryVisible() {
  return !!document.getElementById("libraryMediaGrid") && !!document.getElementById("libraryFileInput");
}

function uxPatchDurations() {
  try {
    if (!Array.isArray(DURATION_OPTIONS)) return;
    ["45", "60", "90", "120", "180", "240", "300"].forEach((value) => {
      if (!DURATION_OPTIONS.includes(value)) DURATION_OPTIONS.push(value);
    });
  } catch {}
}

function uxPatchDurationLabels() {
  document.querySelectorAll("select option").forEach((option) => {
    const value = option.value;
    const labels = {
      "45": "45 secondes",
      "60": "1 minute",
      "90": "1 min 30",
      "120": "2 minutes",
      "180": "3 minutes",
      "240": "4 minutes",
      "300": "5 minutes"
    };
    if (labels[value]) option.textContent = labels[value];
  });

  document.querySelectorAll("#musicDuration, #speechDuration").forEach((select) => {
    if (Number(select.value || 0) > 60 && !select.nextElementSibling?.classList?.contains("ux-long-warning")) {
      select.insertAdjacentHTML("afterend", `<div class="ux-long-warning">⚠️ Plus la vidéo est longue, plus le rendu peut prendre du temps.</div>`);
    }
  });
}

function uxHero() {
  const hero = document.querySelector("#screen .hero-card");
  if (!hero || hero.dataset.uxFinal === "1") return;

  const kicker = hero.querySelector(".hero-kicker");
  const title = hero.querySelector("h2");
  const text = hero.querySelector(".hero-text");

  if (kicker) kicker.textContent = "Bibliothèque finale";
  if (title) title.textContent = "Range sans mélange";
  if (text) text.textContent = "Importe une thématique CHK ou crée tes blocs manuellement.";

  hero.dataset.uxFinal = "1";
}

function uxHideOriginalControls() {
  const modeSelect = document.getElementById("libraryModeSelect")?.closest(".field");
  const typeSelect = document.getElementById("libraryTypeSelect")?.closest(".field");
  const uploadBlock = document.getElementById("libraryUploadBlock")?.closest(".field");
  const filterBlock = document.getElementById("libraryBlockFilter")?.closest(".field");
  const createBtn = document.querySelector('[data-action="create-custom-block"]')?.closest(".prompt-actions");
  const fileInput = document.getElementById("libraryFileInput")?.closest(".field");

  [modeSelect, typeSelect, uploadBlock, filterBlock, createBtn, fileInput].filter(Boolean).forEach((el) => {
    el.classList.add("ux-manual-zone");
  });
}

function uxShellHtml() {
  return `
    <div id="uxFinalShell" class="ux-final-shell">
      <section class="ux-final-card green">
        <p class="ux-kicker">Import rapide CHK</p>
        <h3 class="ux-title">Choisis une thématique</h3>
        <p class="ux-desc">Aucun import automatique. Tu vois le contenu, puis tu confirmes.</p>
        <div class="ux-tabs" style="margin-top:14px;">
          <button type="button" class="ux-tab ${uxCurrentType() === "video" ? "active" : ""}" data-ux-type="video">🎬 Vidéos</button>
          <button type="button" class="ux-tab ${uxCurrentType() === "image" ? "active" : ""}" data-ux-type="image">🖼️ Images</button>
        </div>
        <div class="ux-tabs" style="margin-top:10px;">
          <button type="button" class="ux-tab ${uxCurrentMode() === "music" ? "active" : ""}" data-ux-mode="music">🎵 Musique</button>
          <button type="button" class="ux-tab ${uxCurrentMode() === "speech" ? "active" : ""}" data-ux-mode="speech">🗣️ Voix IA</button>
        </div>
        <input id="uxChkSearch" class="ux-search" type="search" placeholder="Rechercher : Sora, voiture, Instagram..." value="${uxEscape(uxSearch)}" />
        <div id="uxChkList" class="ux-list"><div class="ux-empty">Chargement...</div></div>
      </section>

      <section class="ux-final-card blue">
        <p class="ux-kicker">Mes blocs</p>
        <h3 class="ux-title">Albums</h3>
        <p class="ux-desc">Clique sur un bloc pour voir seulement ses fichiers.</p>
        <div id="uxAlbumGrid" class="ux-album-grid"></div>
      </section>

      <button id="uxManualToggle" type="button" class="ux-btn ux-manual-toggle">✍️ ${uxManualOpen ? "Masquer" : "Ouvrir"} la création manuelle</button>
    </div>
  `;
}

function uxInject() {
  if (!uxLibraryVisible()) return;

  uxPatchDurations();
  uxPatchDurationLabels();
  uxHero();
  uxHideOriginalControls();
  document.body.classList.toggle("ux-show-manual", uxManualOpen);

  if (!document.getElementById("uxFinalShell")) {
    const hero = document.querySelector("#screen .hero-card");
    hero?.insertAdjacentHTML("afterend", uxShellHtml());
    uxBindShell();
  }

  uxRenderAlbums();
  uxRenderChkFolders();
}

function uxBindShell() {
  document.querySelectorAll("[data-ux-type]").forEach((btn) => {
    btn.onclick = () => {
      uxExpandedFolderId = "";
      uxSetType(btn.dataset.uxType);
    };
  });

  document.querySelectorAll("[data-ux-mode]").forEach((btn) => {
    btn.onclick = () => {
      uxExpandedFolderId = "";
      uxSetMode(btn.dataset.uxMode);
    };
  });

  document.getElementById("uxChkSearch")?.addEventListener("input", async (event) => {
    uxSearch = event.target.value || "";
    await uxRenderChkFolders();
  });

  document.getElementById("uxManualToggle")?.addEventListener("click", () => {
    uxManualOpen = !uxManualOpen;
    document.body.classList.toggle("ux-show-manual", uxManualOpen);
    const btn = document.getElementById("uxManualToggle");
    if (btn) btn.textContent = `✍️ ${uxManualOpen ? "Masquer" : "Ouvrir"} la création manuelle`;
  });
}

async function uxRenderChkFolders() {
  const list = document.getElementById("uxChkList");
  if (!list) return;

  list.innerHTML = `<div class="ux-empty">Recherche des ${uxKindLabel()}...</div>`;

  try {
    const folders = await uxListChkFolders();

    if (!folders.length) {
      list.innerHTML = `<div class="ux-empty">Aucune thématique trouvée pour les ${uxKindLabel()}. Mets les fichiers directement dans un dossier du Gestionnaire CHK.</div>`;
      return;
    }

    list.innerHTML = folders.map(uxFolderHtml).join("");

    list.querySelectorAll("[data-ux-preview]").forEach((btn) => {
      btn.onclick = async () => {
        uxExpandedFolderId = uxExpandedFolderId === btn.dataset.uxPreview ? "" : btn.dataset.uxPreview;
        await uxRenderChkFolders();
      };
    });

    list.querySelectorAll("[data-ux-import]").forEach((btn) => {
      btn.onclick = async () => uxConfirmImport(btn.dataset.uxImport);
    });
  } catch (error) {
    console.error(error);
    list.innerHTML = `<div class="ux-empty">Gestionnaire CHK non trouvé. Ouvre d’abord ton Gestionnaire CHK sur ce téléphone.</div>`;
  }
}

function uxFolderHtml(folder) {
  const expanded = uxExpandedFolderId === folder.id;
  return `
    <article class="ux-row-card">
      <div class="ux-row-top">
        <div class="ux-icon">📁</div>
        <div>
          <div class="ux-name">${uxEscape(folder.name)}</div>
          <div class="ux-path">${uxEscape(folder.path)}</div>
        </div>
      </div>
      <div class="ux-badges">
        <span class="ux-badge">${uxIcon()} ${folder.count} ${uxKindLabel()}</span>
        <span class="ux-badge new">➕ ${folder.newCount} nouveau${folder.newCount > 1 ? "x" : ""}</span>
        <span class="ux-badge">✅ ${folder.imported} déjà importé${folder.imported > 1 ? "s" : ""}</span>
        <span class="ux-badge">💾 ${uxSize(folder.size)}</span>
        ${folder.hasSub ? `<span class="ux-badge warn">⚠️ Sous-dossiers ignorés</span>` : ""}
      </div>
      <div class="ux-actions">
        <button type="button" class="ux-btn" data-ux-preview="${uxEscape(folder.id)}">${expanded ? "Masquer" : "Voir"}</button>
        <button type="button" class="ux-btn green" data-ux-import="${uxEscape(folder.id)}">Importer</button>
      </div>
      ${expanded ? uxPreviewFiles(folder.files) : ""}
    </article>
  `;
}

function uxPreviewFiles(files) {
  return `
    <div class="ux-preview">
      ${files.slice(0, 40).map((file) => `
        <div class="ux-file-line">
          <span>•</span>
          <span class="ux-file-name">${uxEscape(file.name || "Fichier")}</span>
          <span>${uxSize(file.size || file.blob?.size || 0)}</span>
        </div>
      `).join("")}
      ${files.length > 40 ? `<div class="ux-file-line">+ ${files.length - 40} autres fichiers</div>` : ""}
    </div>
  `;
}

function uxRenderAlbums() {
  const grid = document.getElementById("uxAlbumGrid");
  if (!grid) return;

  const albums = uxGetAlbums();

  if (!albums.length) {
    grid.innerHTML = `<div class="ux-empty" style="grid-column:1/-1;">Aucun bloc pour le moment. Importe une thématique ou crée un bloc manuellement.</div>`;
    return;
  }

  const allCount = albums.reduce((sum, album) => sum + album.count, 0);
  const allSize = albums.reduce((sum, album) => sum + album.size, 0);

  grid.innerHTML = `
    <button type="button" class="ux-album ${uxAlbumFilter === "all" ? "active" : ""}" data-ux-album="all">
      <div class="ux-album-icon">📚</div>
      <div class="ux-album-name">Tous les blocs</div>
      <div class="ux-album-meta">${allCount} fichiers • ${uxSize(allSize)}</div>
    </button>
    ${albums.map((album) => `
      <button type="button" class="ux-album ${uxAlbumFilter === album.name ? "active" : ""}" data-ux-album="${uxEscape(album.name)}">
        <div class="ux-album-icon">${uxIcon()}</div>
        <div class="ux-album-name">${uxEscape(album.name)}</div>
        <div class="ux-album-meta">${album.count} fichier${album.count > 1 ? "s" : ""} • ${uxSize(album.size)}</div>
      </button>
    `).join("")}
  `;

  grid.querySelectorAll("[data-ux-album]").forEach((btn) => {
    btn.onclick = () => {
      const block = btn.dataset.uxAlbum;
      uxAlbumFilter = block || "all";
      try {
        state.libraryBlockFilter = uxAlbumFilter;
        const select = document.getElementById("libraryBlockFilter");
        if (select) select.value = uxAlbumFilter;
        renderLibraryGrid();
      } catch {}
      uxRenderAlbums();
    };
  });
}

async function uxEnsureBlock(name) {
  const block = normalizeBlock(name || "Bloc CHK");

  if (!allMediaBlocks().includes(block)) {
    state.customBlocks.push(block);
    state.customBlocks = [...new Set(state.customBlocks)].sort((a, b) => a.localeCompare(b, "fr"));
    await saveCustomBlocks();
  }

  return block;
}

async function uxConfirmImport(folderId) {
  const folders = await uxListChkFolders();
  const folder = folders.find((item) => item.id === folderId);

  if (!folder) {
    uxToast("Dossier introuvable.");
    return;
  }

  if (!folder.newCount) {
    uxToast("Aucun nouveau fichier à importer.");
    return;
  }

  const ok = window.confirm(
    `Importer cette thématique ?\n\n${folder.name}\n${folder.newCount} nouveau(x) fichier(s)\n\nLes sous-dossiers seront ignorés.`
  );

  if (!ok) return;
  await uxImportFolder(folder);
}

async function uxImportFolder(folder) {
  const type = uxCurrentType();
  const bucket = uxBucket();
  const block = await uxEnsureBlock(folder.name);
  const existing = uxExistingKeys(bucket);

  startUiStatus("Import CHK", [
    "Lecture du dossier choisi...",
    "Création du bloc...",
    "Import des fichiers directs...",
    "Mise à jour de la bibliothèque..."
  ]);

  try {
    let imported = 0;
    let skipped = 0;

    for (const file of folder.files) {
      if (!file.blob) {
        skipped += 1;
        continue;
      }

      const size = file.size || file.blob.size || 0;
      const key = `${file.name}__${size}__${block}`;

      if (existing.has(key)) {
        skipped += 1;
        continue;
      }

      const orientation = await detectFileOrientation(file.blob, type);

      await mediaPut({
        id: uid("ux_chk_media"),
        owner: state.profile,
        bucket,
        mediaType: type,
        fileName: file.name || `media-${Date.now()}`,
        mimeType: file.mimeType || file.blob.type || "*/*",
        size,
        createdAt: nowISO(),
        block,
        orientation,
        tags: ["gestionnaire-chk", folder.name],
        source: "gestionnaire-chk",
        sourceFolderId: folder.id,
        sourceFileId: file.id,
        blob: file.blob
      });

      existing.add(key);
      imported += 1;
    }

    await hydrateCache();
    state.libraryBlockFilter = block;
    uxAlbumFilter = block;
    stopUiStatus("Import terminé.");
    render();
    uxToast(`${imported} importé(s), ${skipped} ignoré(s).`);
  } catch (error) {
    console.error(error);
    stopUiStatus("Erreur import.");
    uxToast(error.message || "Erreur pendant l’import.");
  }
}

function uxBoot() {
  uxPatchDurations();
  if (uxReady) return;
  uxReady = true;

  uxTimer = setInterval(() => {
    try {
      uxPatchDurations();
      uxPatchDurationLabels();
      uxInject();
    } catch (error) {
      console.error("UX finale", error);
    }
  }, 450);

  console.log("UX finale active.");
}

uxBoot();
