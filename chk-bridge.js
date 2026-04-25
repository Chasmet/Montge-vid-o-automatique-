/*
  CHK Bridge V3
  Connexion robuste entre :
  - Gestionnaire Mobile CHK
  - Studio vidéo IA
*/

const CHK_MANAGER_DB_NAME = "gestionnaire-mobile-db-final-v1";
const CHK_MANAGER_DB_VERSION = 1;
const CHK_MANAGER_STORE = "items";

let chkManagerDbPromise = null;
let chkBridgeInterval = null;

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

async function chkBridgeListFolders(targetType) {
  const allItems = await chkBridgeGetAllManagerItems();
  const itemsById = new Map(allItems.map((item) => [item.id, item]));

  return allItems
    .filter((item) => item.type === "folder")
    .filter((item) => item.id !== "root")
    .map((folder) => {
      const files = chkBridgeCollectCompatibleFiles(folder.id, allItems, targetType);

      return {
        id: folder.id,
        name: folder.name || "Dossier",
        fullPath: chkBridgeBuildPath(folder.id, itemsById),
        count: files.length
      };
    })
    .filter((folder) => folder.count > 0)
    .sort((a, b) => a.fullPath.localeCompare(b.fullPath, "fr"));
}

function chkBridgeSectionHtml() {
  return `
    <div id="chkBridgeSection" class="result-box" style="margin-top:18px;">
      <div class="result-box-head">
        <h3>Bibliothèque CHK</h3>
      </div>

      <p class="small-note">
        Importe directement les dossiers créés dans ton Gestionnaire CHK. Le nom du dossier devient automatiquement un bloc.
      </p>

      <label class="field">
        <span>Dossier / thématique du gestionnaire</span>
        <select id="chkBridgeFolderSelect">
          <option value="">Chargement...</option>
        </select>
      </label>

      <div class="prompt-actions">
        <button type="button" class="secondary-btn" id="chkBridgeRefreshBtn">
          Actualiser les dossiers
        </button>

        <button type="button" class="primary-btn" id="chkBridgeImportBtn">
          📂 Importer ce dossier
        </button>
      </div>

      <p id="chkBridgeInfo" class="small-note">
        Les fichiers restent sur ton téléphone. Studio vidéo IA crée une copie locale pour le montage.
      </p>
    </div>
  `;
}

function chkBridgeIsLibraryVisible() {
  return !!document.getElementById("libraryMediaGrid") && !!document.getElementById("libraryFileInput");
}

function chkBridgeInjectSection() {
  if (!chkBridgeIsLibraryVisible()) return;
  if (document.getElementById("chkBridgeSection")) return;

  const fileInput = document.getElementById("libraryFileInput");
  const field = fileInput?.closest(".field");

  if (field) {
    field.insertAdjacentHTML("afterend", chkBridgeSectionHtml());
  } else {
    const grid = document.getElementById("libraryMediaGrid");
    const box = grid?.closest(".result-box");
    box?.insertAdjacentHTML("beforebegin", chkBridgeSectionHtml());
  }

  document.getElementById("chkBridgeRefreshBtn")?.addEventListener("click", async () => {
    await chkBridgeRenderFolderSelect();
    showToast("Dossiers CHK actualisés.");
  });

  document.getElementById("chkBridgeImportBtn")?.addEventListener("click", async () => {
    await chkBridgeImportSelectedFolder();
  });

  chkBridgeRenderFolderSelect().catch(console.error);
}

async function chkBridgeRenderFolderSelect() {
  const select = document.getElementById("chkBridgeFolderSelect");
  const info = document.getElementById("chkBridgeInfo");

  if (!select) return;

  const targetType = chkBridgeGetCurrentType();

  select.innerHTML = `<option value="">Chargement...</option>`;

  try {
    const folders = await chkBridgeListFolders(targetType);

    if (!folders.length) {
      select.innerHTML = `<option value="">Aucun dossier compatible</option>`;

      if (info) {
        info.textContent = `Aucun dossier avec des ${targetType === "video" ? "vidéos" : "images"} trouvé. Ouvre le Gestionnaire CHK et ajoute des fichiers.`;
      }

      return;
    }

    select.innerHTML = folders.map((folder) => `
      <option value="${chkBridgeEscape(folder.id)}">
        ${chkBridgeEscape(folder.fullPath)} - ${folder.count} fichier${folder.count > 1 ? "s" : ""}
      </option>
    `).join("");

    if (info) {
      info.textContent = `${folders.length} dossier${folders.length > 1 ? "s" : ""} compatible${folders.length > 1 ? "s" : ""} trouvé${folders.length > 1 ? "s" : ""}.`;
    }
  } catch (error) {
    console.error(error);

    select.innerHTML = `<option value="">Gestionnaire CHK non trouvé</option>`;

    if (info) {
      info.textContent = "Ouvre d’abord ton Gestionnaire CHK sur ce téléphone, crée un dossier et ajoute des fichiers.";
    }
  }
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

async function chkBridgeImportSelectedFolder() {
  const select = document.getElementById("chkBridgeFolderSelect");
  const selectedFolderId = select?.value || "";

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
    "Lecture du dossier CHK...",
    "Création du bloc thématique...",
    "Copie des médias dans Studio vidéo IA...",
    "Analyse de l’orientation...",
    "Finalisation de la bibliothèque..."
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

    stopUiStatus("Import terminé.");
    render();

    if (importedCount > 0) {
      showToast(`${importedCount} média${importedCount > 1 ? "s importés" : " importé"} depuis CHK.`);
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

  console.log("CHK Bridge V3 actif.");
}

chkBridgeBoot();
