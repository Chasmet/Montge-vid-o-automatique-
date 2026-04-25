/*
  CHK Bridge V5
  Correction : aucun import automatique, confirmation obligatoire, dossier direct uniquement.
  Objectif : garder une bibliothèque propre et éviter le bordel.
*/

const CHK_MANAGER_DB_NAME = "gestionnaire-mobile-db-final-v1";
const CHK_MANAGER_DB_VERSION = 1;
const CHK_MANAGER_STORE = "items";

let chkManagerDbPromise = null;
let chkBridgeInterval = null;
let chkBridgeSearchText = "";
let chkBridgeExpandedId = "";

function chkBridgeOpenDb() {
  if (chkManagerDbPromise) return chkManagerDbPromise;

  chkManagerDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(CHK_MANAGER_DB_NAME, CHK_MANAGER_DB_VERSION);

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error("Gestionnaire CHK introuvable."));
    req.onupgradeneeded = () => reject(new Error("Ouvre d’abord le Gestionnaire CHK."));
  });

  return chkManagerDbPromise;
}

async function chkBridgeGetManagerItems() {
  const db = await chkBridgeOpenDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHK_MANAGER_STORE, "readonly");
    const store = tx.objectStore(CHK_MANAGER_STORE);
    const req = store.getAll();

    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error || new Error("Lecture impossible."));
  });
}

function chkBridgeEscape(value) {
  return (value || "")
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function chkBridgeToast(message) {
  try {
    showToast(message);
  } catch {
    alert(message);
  }
}

function chkBridgeType() {
  const select = document.getElementById("libraryTypeSelect");
  if (select?.value === "video") return "video";
  if (select?.value === "image") return "image";

  try {
    return state.libraryType === "video" ? "video" : "image";
  } catch {
    return "video";
  }
}

function chkBridgeMode() {
  const select = document.getElementById("libraryModeSelect");
  if (select?.value === "speech") return "speech";
  if (select?.value === "music") return "music";

  try {
    return state.libraryMode || "music";
  } catch {
    return "music";
  }
}

function chkBridgeSetType(type) {
  const clean = type === "image" ? "image" : "video";
  const select = document.getElementById("libraryTypeSelect");

  if (select) {
    select.value = clean;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  try {
    state.libraryType = clean;
    render();
  } catch {}
}

function chkBridgeSetMode(mode) {
  const clean = mode === "speech" ? "speech" : "music";
  const select = document.getElementById("libraryModeSelect");

  if (select) {
    select.value = clean;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  try {
    state.libraryMode = clean;
    render();
  } catch {}
}

function chkBridgeIsCompatibleFile(item, type) {
  if (!item || item.type !== "file") return false;

  const mime = item.mimeType || item.blob?.type || "";
  const name = (item.name || "").toLowerCase();

  if (type === "video") {
    return mime.startsWith("video/") || [".mp4", ".mov", ".webm", ".m4v", ".ogg"].some((ext) => name.endsWith(ext));
  }

  return mime.startsWith("image/") || [".jpg", ".jpeg", ".png", ".webp"].some((ext) => name.endsWith(ext));
}

function chkBridgeChildren(folderId, allItems) {
  return allItems.filter((item) => item.parentId === folderId);
}

function chkBridgeDirectFiles(folderId, allItems, type) {
  return chkBridgeChildren(folderId, allItems).filter((item) => chkBridgeIsCompatibleFile(item, type));
}

function chkBridgeHasCompatibleInSubFolders(folderId, allItems, type) {
  const folders = chkBridgeChildren(folderId, allItems).filter((item) => item.type === "folder");

  for (const folder of folders) {
    if (chkBridgeDirectFiles(folder.id, allItems, type).length) return true;
    if (chkBridgeHasCompatibleInSubFolders(folder.id, allItems, type)) return true;
  }

  return false;
}

function chkBridgePath(folderId, map) {
  const names = [];
  let current = map.get(folderId);

  while (current) {
    names.unshift(current.name || "Dossier");
    if (!current.parentId) break;
    current = map.get(current.parentId);
  }

  return names.join(" > ");
}

function chkBridgeSize(bytes) {
  const size = Number(bytes || 0);
  if (size < 1024) return `${size} o`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size > 10240 ? 0 : 1)} Ko`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(size > 10485760 ? 0 : 1)} Mo`;
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} Go`;
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

async function chkBridgeListFolders() {
  const type = chkBridgeType();
  const mode = chkBridgeMode();
  const bucket = getBucketForProject(mode, type);
  const existing = chkBridgeExistingKeys(bucket);
  const allItems = await chkBridgeGetManagerItems();
  const map = new Map(allItems.map((item) => [item.id, item]));

  return allItems
    .filter((item) => item.type === "folder" && item.id !== "root")
    .map((folder) => {
      const files = chkBridgeDirectFiles(folder.id, allItems, type);
      const block = normalizeBlock(folder.name || "Bloc CHK");
      const imported = files.filter((file) => {
        const size = file.size || file.blob?.size || 0;
        return existing.has(`${file.name}__${size}__${block}`);
      }).length;

      return {
        id: folder.id,
        name: folder.name || "Dossier",
        path: chkBridgePath(folder.id, map),
        files,
        count: files.length,
        newCount: Math.max(0, files.length - imported),
        imported,
        size: files.reduce((sum, file) => sum + Number(file.size || file.blob?.size || 0), 0),
        hasSub: chkBridgeHasCompatibleInSubFolders(folder.id, allItems, type)
      };
    })
    .filter((folder) => folder.count > 0)
    .filter((folder) => {
      const q = chkBridgeSearchText.trim().toLowerCase();
      if (!q) return true;
      return `${folder.name} ${folder.path}`.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      if (b.newCount !== a.newCount) return b.newCount - a.newCount;
      return a.path.localeCompare(b.path, "fr");
    });
}

function chkBridgeInstallStyles() {
  if (document.getElementById("chkBridgeV5Styles")) return;

  const style = document.createElement("style");
  style.id = "chkBridgeV5Styles";
  style.textContent = `
    #chkBridgeTabs, #chkBridgeSection, #chkBridgeManualHeader { animation: chkV5In .2s ease both; }
    @keyframes chkV5In { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }

    #chkBridgeTabs { display:grid; gap:10px; margin:14px 0 16px; }
    .chk-v5-tabs { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
    .chk-v5-tab { min-height:58px; border-radius:20px; border:1px solid rgba(148,163,184,.22); background:rgba(15,23,42,.82); color:#f8fafc; font-weight:950; font-size:16px; }
    .chk-v5-tab.active { border-color:rgba(96,165,250,.8); background:linear-gradient(135deg,#2563eb,#7c3aed); color:white; }

    #chkBridgeSection { border:1px solid rgba(34,197,94,.38)!important; background:linear-gradient(180deg,rgba(6,78,59,.36),rgba(15,23,42,.94))!important; overflow:hidden; }
    .chk-v5-kicker { margin:0 0 6px; color:#86efac; font-size:13px; font-weight:950; text-transform:uppercase; letter-spacing:.08em; }
    .chk-v5-title { margin:0; font-size:27px; line-height:1.08; font-weight:950; }
    .chk-v5-desc { color:rgba(226,232,240,.78); line-height:1.42; margin:10px 0 14px; }
    .chk-v5-search { width:100%; border:1px solid rgba(148,163,184,.24); border-radius:18px; background:rgba(15,23,42,.75); color:#f8fafc; padding:15px; font-size:16px; margin-bottom:12px; }
    .chk-v5-head { display:flex; justify-content:space-between; gap:10px; align-items:flex-start; }
    .chk-v5-refresh { border:1px solid rgba(148,163,184,.22); border-radius:16px; background:rgba(15,23,42,.78); color:#f8fafc; font-weight:950; min-width:52px; min-height:48px; }
    .chk-v5-list { display:grid; gap:12px; }
    .chk-v5-card { border:1px solid rgba(148,163,184,.20); border-radius:22px; background:rgba(15,23,42,.65); padding:14px; }
    .chk-v5-row { display:flex; gap:12px; align-items:flex-start; margin-bottom:12px; }
    .chk-v5-icon { width:46px; height:46px; border-radius:16px; display:grid; place-items:center; background:linear-gradient(135deg,#2563eb,#7c3aed); flex:0 0 auto; font-size:22px; }
    .chk-v5-name { color:#f8fafc; font-size:18px; font-weight:950; line-height:1.18; word-break:break-word; }
    .chk-v5-path { color:rgba(203,213,225,.68); font-size:13px; line-height:1.3; word-break:break-word; margin-top:4px; }
    .chk-v5-badges { display:flex; flex-wrap:wrap; gap:7px; margin-bottom:12px; }
    .chk-v5-badge { border-radius:999px; padding:7px 10px; background:rgba(30,41,59,.86); color:#e2e8f0; font-size:12px; font-weight:850; }
    .chk-v5-badge.new { background:rgba(34,197,94,.18); color:#86efac; }
    .chk-v5-badge.warn { background:rgba(251,191,36,.15); color:#fde68a; }
    .chk-v5-actions { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
    .chk-v5-actions button { min-height:48px; border-radius:16px; border:1px solid rgba(148,163,184,.22); background:rgba(15,23,42,.84); color:#f8fafc; font-weight:950; }
    .chk-v5-actions .primary { border:none; background:linear-gradient(135deg,#22c55e,#2563eb); color:white; }
    .chk-v5-preview { margin-top:12px; display:grid; gap:8px; border-top:1px solid rgba(148,163,184,.16); padding-top:10px; }
    .chk-v5-file { display:flex; gap:8px; align-items:center; padding:9px; border-radius:14px; background:rgba(2,6,23,.30); color:rgba(226,232,240,.86); font-size:13px; }
    .chk-v5-file-name { flex:1; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
    .chk-v5-empty { border:1px dashed rgba(148,163,184,.28); border-radius:22px; padding:18px; color:rgba(226,232,240,.78); line-height:1.45; background:rgba(15,23,42,.44); }
    #chkBridgeManualHeader { border:1px solid rgba(148,163,184,.18); border-radius:22px; padding:16px; background:rgba(15,23,42,.70); margin:16px 0 12px; }
    #chkBridgeManualHeader h3 { margin:0 0 6px; color:#f8fafc; font-size:22px; }
    #chkBridgeManualHeader p { margin:0; color:rgba(226,232,240,.72); line-height:1.4; }
  `;
  document.head.appendChild(style);
}

function chkBridgeTabsHtml() {
  const type = chkBridgeType();
  const mode = chkBridgeMode();

  return `
    <div id="chkBridgeTabs">
      <div class="chk-v5-tabs">
        <button type="button" class="chk-v5-tab ${type === "video" ? "active" : ""}" data-chk-type="video">🎬 Vidéos</button>
        <button type="button" class="chk-v5-tab ${type === "image" ? "active" : ""}" data-chk-type="image">🖼️ Images</button>
      </div>
      <div class="chk-v5-tabs">
        <button type="button" class="chk-v5-tab ${mode === "music" ? "active" : ""}" data-chk-mode="music">🎵 Musique</button>
        <button type="button" class="chk-v5-tab ${mode === "speech" ? "active" : ""}" data-chk-mode="speech">🗣️ Voix IA</button>
      </div>
    </div>
  `;
}

function chkBridgeSectionHtml() {
  return `
    <div id="chkBridgeSection" class="result-box">
      <div class="chk-v5-head">
        <div>
          <p class="chk-v5-kicker">Import contrôlé</p>
          <h3 class="chk-v5-title">Bibliothèque CHK</h3>
        </div>
        <button type="button" id="chkBridgeRefresh" class="chk-v5-refresh">↻</button>
      </div>
      <p class="chk-v5-desc">Importe une seule thématique à la fois. Les sous-dossiers ne sont pas importés automatiquement.</p>
      <input id="chkBridgeSearch" class="chk-v5-search" type="search" placeholder="Rechercher une thématique..." value="${chkBridgeEscape(chkBridgeSearchText)}" />
      <div id="chkBridgeList" class="chk-v5-list"><div class="chk-v5-empty">Chargement...</div></div>
      <p id="chkBridgeInfo" class="small-note" style="margin-top:12px;">Aucun import ne se lance sans confirmation.</p>
    </div>
  `;
}

function chkBridgeManualHtml() {
  const type = chkBridgeType() === "video" ? "vidéos" : "images";
  return `
    <div id="chkBridgeManualHeader">
      <h3>✍️ Création manuelle</h3>
      <p>Tu peux toujours créer tes blocs et ajouter tes ${type} manuellement depuis ton téléphone.</p>
    </div>
  `;
}

function chkBridgeVisible() {
  return !!document.getElementById("libraryMediaGrid") && !!document.getElementById("libraryFileInput");
}

function chkBridgeEnhanceHero() {
  const hero = document.querySelector("#screen .hero-card");
  if (!hero || hero.dataset.chkV5 === "1") return;

  const kicker = hero.querySelector(".hero-kicker");
  const title = hero.querySelector("h2");
  const text = hero.querySelector(".hero-text");

  if (kicker) kicker.textContent = "Médias";
  if (title) title.textContent = "Ma bibliothèque";
  if (text) text.textContent = "Range tes fichiers par thématique, sans mélange.";

  hero.dataset.chkV5 = "1";
}

function chkBridgeInject() {
  if (!chkBridgeVisible()) return;

  chkBridgeInstallStyles();
  chkBridgeEnhanceHero();

  if (!document.getElementById("chkBridgeTabs")) {
    const hero = document.querySelector("#screen .hero-card");
    hero?.insertAdjacentHTML("afterend", chkBridgeTabsHtml());

    document.querySelectorAll("[data-chk-type]").forEach((btn) => {
      btn.onclick = () => {
        chkBridgeExpandedId = "";
        chkBridgeSetType(btn.dataset.chkType);
      };
    });

    document.querySelectorAll("[data-chk-mode]").forEach((btn) => {
      btn.onclick = () => {
        chkBridgeExpandedId = "";
        chkBridgeSetMode(btn.dataset.chkMode);
      };
    });
  }

  if (!document.getElementById("chkBridgeSection")) {
    const tabs = document.getElementById("chkBridgeTabs");
    tabs?.insertAdjacentHTML("afterend", chkBridgeSectionHtml());

    document.getElementById("chkBridgeRefresh")?.addEventListener("click", async () => {
      chkBridgeExpandedId = "";
      await chkBridgeRenderList();
      chkBridgeToast("Dossiers actualisés.");
    });

    document.getElementById("chkBridgeSearch")?.addEventListener("input", async (event) => {
      chkBridgeSearchText = event.target.value || "";
      await chkBridgeRenderList();
    });
  }

  if (!document.getElementById("chkBridgeManualHeader")) {
    const createButton = document.querySelector('[data-action="create-custom-block"]')?.closest(".prompt-actions");
    const fileField = document.getElementById("libraryFileInput")?.closest(".field");

    if (createButton) createButton.insertAdjacentHTML("beforebegin", chkBridgeManualHtml());
    else fileField?.insertAdjacentHTML("beforebegin", chkBridgeManualHtml());
  }

  chkBridgeRenderList().catch(console.error);
}

async function chkBridgeRenderList() {
  const list = document.getElementById("chkBridgeList");
  const info = document.getElementById("chkBridgeInfo");
  if (!list) return;

  const type = chkBridgeType();
  list.innerHTML = `<div class="chk-v5-empty">Recherche des ${type === "video" ? "vidéos" : "images"}...</div>`;

  try {
    const folders = await chkBridgeListFolders();

    if (!folders.length) {
      list.innerHTML = `<div class="chk-v5-empty">Aucune thématique directe trouvée. Mets tes fichiers directement dans un dossier du Gestionnaire CHK, puis actualise.</div>`;
      if (info) info.textContent = "Les sous-dossiers ne sont pas importés automatiquement pour éviter le mélange.";
      return;
    }

    list.innerHTML = folders.map(chkBridgeCardHtml).join("");

    list.querySelectorAll("[data-chk-preview]").forEach((btn) => {
      btn.onclick = async () => {
        chkBridgeExpandedId = chkBridgeExpandedId === btn.dataset.chkPreview ? "" : btn.dataset.chkPreview;
        await chkBridgeRenderList();
      };
    });

    list.querySelectorAll("[data-chk-import]").forEach((btn) => {
      btn.onclick = async () => chkBridgeConfirmImport(btn.dataset.chkImport);
    });

    const totalNew = folders.reduce((sum, folder) => sum + folder.newCount, 0);
    if (info) info.textContent = `${folders.length} thématique${folders.length > 1 ? "s" : ""}. ${totalNew} nouveau${totalNew > 1 ? "x" : ""} fichier${totalNew > 1 ? "s" : ""}.`;
  } catch (error) {
    console.error(error);
    list.innerHTML = `<div class="chk-v5-empty">Gestionnaire CHK non trouvé. Ouvre d’abord ton Gestionnaire CHK sur ce téléphone.</div>`;
    if (info) info.textContent = "Même téléphone, même navigateur obligatoire.";
  }
}

function chkBridgeCardHtml(folder) {
  const type = chkBridgeType();
  const icon = type === "video" ? "🎬" : "🖼️";
  const label = type === "video" ? "vidéos" : "images";
  const expanded = chkBridgeExpandedId === folder.id;

  return `
    <article class="chk-v5-card">
      <div class="chk-v5-row">
        <div class="chk-v5-icon">📁</div>
        <div>
          <div class="chk-v5-name">${chkBridgeEscape(folder.name)}</div>
          <div class="chk-v5-path">${chkBridgeEscape(folder.path)}</div>
        </div>
      </div>
      <div class="chk-v5-badges">
        <span class="chk-v5-badge">${icon} ${folder.count} ${label}</span>
        <span class="chk-v5-badge new">➕ ${folder.newCount} nouveau${folder.newCount > 1 ? "x" : ""}</span>
        <span class="chk-v5-badge">✅ ${folder.imported} déjà importé${folder.imported > 1 ? "s" : ""}</span>
        <span class="chk-v5-badge">💾 ${chkBridgeSize(folder.size)}</span>
        ${folder.hasSub ? `<span class="chk-v5-badge warn">⚠️ Sous-dossiers ignorés</span>` : ""}
      </div>
      <div class="chk-v5-actions">
        <button type="button" data-chk-preview="${chkBridgeEscape(folder.id)}">${expanded ? "Masquer" : "Voir"}</button>
        <button type="button" class="primary" data-chk-import="${chkBridgeEscape(folder.id)}">Importer</button>
      </div>
      ${expanded ? chkBridgePreviewHtml(folder.files) : ""}
    </article>
  `;
}

function chkBridgePreviewHtml(files) {
  return `
    <div class="chk-v5-preview">
      ${files.map((file) => `
        <div class="chk-v5-file">
          <span>•</span>
          <span class="chk-v5-file-name">${chkBridgeEscape(file.name || "Fichier")}</span>
          <span>${chkBridgeSize(file.size || file.blob?.size || 0)}</span>
        </div>
      `).join("")}
    </div>
  `;
}

async function chkBridgeConfirmImport(folderId) {
  const folders = await chkBridgeListFolders();
  const folder = folders.find((item) => item.id === folderId);

  if (!folder) {
    chkBridgeToast("Dossier introuvable.");
    return;
  }

  if (!folder.newCount) {
    chkBridgeToast("Aucun nouveau fichier à importer dans cette thématique.");
    return;
  }

  const typeLabel = chkBridgeType() === "video" ? "vidéo" : "image";
  const ok = window.confirm(
    `Importer seulement ce dossier ?\n\n${folder.name}\n${folder.newCount} nouveau fichier ${typeLabel}\n\nLes sous-dossiers seront ignorés.`
  );

  if (!ok) return;

  await chkBridgeImportFolder(folder);
}

async function chkBridgeEnsureBlock(name) {
  const block = normalizeBlock(name || "Bloc CHK");

  if (!allMediaBlocks().includes(block)) {
    state.customBlocks.push(block);
    state.customBlocks = [...new Set(state.customBlocks)].sort((a, b) => a.localeCompare(b, "fr"));
    await saveCustomBlocks();
  }

  return block;
}

async function chkBridgeImportFolder(folder) {
  const type = chkBridgeType();
  const mode = chkBridgeMode();
  const bucket = getBucketForProject(mode, type);
  const block = await chkBridgeEnsureBlock(folder.name);
  const existing = chkBridgeExistingKeys(bucket);

  startUiStatus("Import CHK", [
    "📂 Lecture du dossier sélectionné...",
    "🏷️ Préparation de la thématique...",
    "📥 Import des fichiers directs...",
    "✅ Finalisation..."
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
        id: uid("chk_media"),
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

    try {
      state.libraryBlockFilter = block;
      const filter = document.getElementById("libraryBlockFilter");
      if (filter) filter.value = block;
    } catch {}

    stopUiStatus("Import terminé.");
    render();

    if (imported > 0) chkBridgeToast(`${imported} fichier${imported > 1 ? "s" : ""} importé${imported > 1 ? "s" : ""} dans ${block}.`);
    else chkBridgeToast("Aucun nouveau fichier importé.");
  } catch (error) {
    console.error(error);
    stopUiStatus("Erreur import.");
    chkBridgeToast(error.message || "Erreur pendant l’import.");
  }
}

function chkBridgeBoot() {
  if (chkBridgeInterval) return;

  chkBridgeInterval = setInterval(() => {
    try {
      chkBridgeInject();
    } catch (error) {
      console.error("CHK Bridge V5", error);
    }
  }, 500);

  console.log("CHK Bridge V5 actif : import contrôlé, sous-dossiers ignorés.");
}

chkBridgeBoot();
