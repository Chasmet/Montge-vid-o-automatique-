/*
  CHK Bridge
  Connexion entre :
  - Gestionnaire Mobile CHK
  - Studio vidéo IA

  Fonction :
  - lit la base IndexedDB du gestionnaire
  - affiche les dossiers/thématiques
  - importe les vidéos/images dans Studio vidéo IA
*/

const CHK_MANAGER_DB_NAME = "gestionnaire-mobile-db-final-v1";
const CHK_MANAGER_DB_VERSION = 1;
const CHK_MANAGER_STORE = "items";

let chkManagerDbPromise = null;
let chkBridgeFoldersCache = [];

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

function chkBridgeIsSystemFolder(id) {
  return [
    "root",
    "images",
    "videos",
    "audio",
    "documents",
    "downloads",
    "projects",
    "trash"
  ].includes(id);
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
      name.endsWith(".m4v")
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
      const nested = chkBridgeCollectCompatibleFiles(child.id, allItems, targetType);
      result.push(...nested);
    }
  }

  return result;
}

async function chkBridgeListFolders() {
  const allItems = await chkBridgeGetAllManagerItems();
  const itemsById = new Map(allItems.map((item) => [item.id, item]));

  const folders = allItems
    .filter((item) => item.type === "folder")
    .filter((item) => item.id !== "root")
    .map((folder) => {
      const fullPath = chkBridgeBuildPath(folder.id, itemsById);
      const videoCount = chkBridgeCollectCompatibleFiles(folder.id, allItems, "video").length;
      const imageCount = chkBridgeCollectCompatibleFiles(folder.id, allItems, "image").length;

      return {
        id: folder.id,
        name: folder.name || "Dossier",
        fullPath,
        videoCount,
        imageCount,
        isSystem: chkBridgeIsSystemFolder(folder.id)
      };
    })
    .filter((folder) => folder.videoCount > 0 || folder.imageCount > 0)
    .sort((a, b) => {
      if (a.isSystem !== b.isSystem) return a.isSystem ? -1 : 1;
      return a.fullPath.localeCompare(b.fullPath, "fr");
    });

  chkBridgeFoldersCache = folders;
  return folders;
}

function chkBridgeTemplate() {
  return `
    <section class="screen">
      <div class="panel">
        <div class="panel-head">
          <h2>Bibliothèque CHK</h2>
          <p>Importer directement les dossiers de ton gestionnaire de fichiers.</p>
        </div>

        <div class="result-box">
          <div class="result-box-head">
            <h3>Importer depuis Gestionnaire CHK</h3>
          </div>

          <p class="small-note">
            Choisis un dossier créé dans ton gestionnaire. Le dossier devient automatiquement un bloc dans Studio vidéo IA.
          </p>

          <label class="field">
            <span>Dossier / thématique CHK</span>
            <select id="chkBridgeFolderSelect">
              <option value="">Chargement des dossiers...</option>
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

          <div id="chkBridgeInfo" class="small-note">
            Les fichiers restent sur ton téléphone. Studio vidéo IA crée une copie locale pour le montage.
          </div>
        </div>
      </div>
    </section>
  `;
}

function chkBridgePatchLibraryTemplate() {
  if (typeof libraryTemplate !== "function") return;
  if (libraryTemplate.__chkBridgePatched) return;

  const originalLibraryTemplate = libraryTemplate;

  libraryTemplate = function patchedLibraryTemplate() {
    return originalLibraryTemplate() + chkBridgeTemplate();
  };

  libraryTemplate.__chkBridgePatched = true;
}

function chkBridgePatchBindLibrary() {
  if (typeof bindLibrary !== "function") return;
  if (bindLibrary.__chkBridgePatched) return;

  const originalBindLibrary = bindLibrary;

  bindLibrary = function patchedBindLibrary() {
    originalBindLibrary();
    chkBridgeBindUi();
  };

  bindLibrary.__chkBridgePatched = true;
}

async function chkBridgeRenderFolderSelect() {
  const select = document.getElementById("chkBridgeFolderSelect");
  const info = document.getElementById("chkBridgeInfo");

  if (!select) return;

  select.innerHTML = `<option value="">Chargement...</option>`;

  try {
    const folders = await chkBridgeListFolders();

    if (!folders.length) {
      select.innerHTML = `<option value="">Aucun dossier média trouvé</option>`;

      if (info) {
        info.textContent = "Crée un dossier dans le Gestionnaire CHK, ajoute des images ou vidéos, puis reviens ici.";
      }

      return;
    }

    const currentType = state.libraryType === "video" ? "video" : "image";

    const filteredFolders = folders.filter((folder) => {
      return currentType === "video" ? folder.videoCount > 0 : folder.imageCount > 0;
    });

    if (!filteredFolders.length) {
      select.innerHTML = `<option value="">Aucun dossier compatible</option>`;

      if (info) {
        info.textContent = `Aucun dossier avec des ${currentType === "video" ? "vidéos" : "images"} trouvé dans le Gestionnaire CHK.`;
      }

      return;
    }

    select.innerHTML = filteredFolders.map((folder) => {
      const count = currentType === "video" ? folder.videoCount : folder.imageCount;

      return `
        <option value="${escapeHtml(folder.id)}">
          ${escapeHtml(folder.fullPath)} - ${count} fichier${count > 1 ? "s" : ""}
        </option>
      `;
    }).join("");

    if (info) {
      info.textContent = `${filteredFolders.length} dossier${filteredFolders.length > 1 ? "s" : ""} compatible${filteredFolders.length > 1 ? "s" : ""} trouvé${filteredFolders.length > 1 ? "s" : ""}.`;
    }
  } catch (error) {
    select.innerHTML = `<option value="">Gestionnaire non trouvé</option>`;

    if (info) {
      info.textContent = "Ouvre d’abord ton Gestionnaire CHK au moins une fois et ajoute des fichiers.";
    }
  }
}

function chkBridgeBindUi() {
  const refreshBtn = document.getElementById("chkBridgeRefreshBtn");
  const importBtn = document.getElementById("chkBridgeImportBtn");

  refreshBtn?.addEventListener("click", async () => {
    await chkBridgeRenderFolderSelect();
    showToast("Dossiers CHK actualisés.");
  });

  importBtn?.addEventListener("click", async () => {
    await chkBridgeImportSelectedFolder();
  });

  chkBridgeRenderFolderSelect().catch((error) => {
    console.warn("CHK Bridge:", error);
  });
}

async function chkBridgeEnsureCustomBlock(blockName) {
  const cleanBlock = normalizeBlock(blockName);

  if (!cleanBlock) return "Vrac";

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

  const allItems = await chkBridgeGetAllManagerItems();
  const selectedFolder = allItems.find((item) => item.id === selectedFolderId);

  if (!selectedFolder) {
    showToast("Dossier introuvable.");
    return;
  }

  const targetType = state.libraryType === "video" ? "video" : "image";
  const bucket = getBucketForProject(state.libraryMode, targetType);
  const files = chkBridgeCollectCompatibleFiles(selectedFolderId, allItems, targetType);

  if (!files.length) {
    showToast(`Aucun fichier ${targetType === "video" ? "vidéo" : "image"} dans ce dossier.`);
    return;
  }

  startUiStatus("Import CHK", [
    "Lecture du dossier Gestionnaire CHK...",
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

      const duplicateKey = `${fileItem.name}__${fileItem.size || fileItem.blob.size || 0}__${blockName}`;

      if (existingKeys.has(duplicateKey)) {
        skippedCount += 1;
        continue;
      }

      const blob = fileItem.blob;
      const orientation = await detectFileOrientation(blob, targetType);

      await mediaPut({
        id: uid("chk_media"),
        owner: state.profile,
        bucket,
        mediaType: targetType,
        fileName: fileItem.name || `media-${Date.now()}`,
        mimeType: fileItem.mimeType || blob.type || "*/*",
        size: fileItem.size || blob.size || 0,
        createdAt: nowISO(),
        block: blockName,
        orientation,
        tags: ["gestionnaire-chk", selectedFolder.name || "CHK"],
        source: "gestionnaire-chk",
        sourceFolderId: selectedFolder.id,
        sourceFileId: fileItem.id,
        blob
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
      showToast("Aucun nouveau média : fichiers déjà importés.");
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
  try {
    chkBridgePatchLibraryTemplate();
    chkBridgePatchBindLibrary();

    console.log("CHK Bridge actif.");
  } catch (error) {
    console.error("Erreur CHK Bridge :", error);
  }
}

chkBridgeBoot();
