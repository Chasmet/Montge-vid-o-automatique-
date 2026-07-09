(() => {
  const PANEL_ID = "gestionnairePickerPanel";
  const BUTTON_ID = "gestionnairePickerButton";

  function hasBridge() {
    return typeof GestionnaireLibrary !== "undefined";
  }

  function toast(message) {
    if (typeof showToast === "function") {
      showToast(message);
      return;
    }
    alert(message);
  }

  function escapeText(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatSize(bytes) {
    if (!bytes) return "taille inconnue";
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} Mo`;
    return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  }

  function base64ToFile(base64, name, mimeType) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], name || "fichier-gestionnaire", {
      type: mimeType || "application/octet-stream"
    });
  }

  function listGestionnaireFiles() {
    if (!hasBridge()) return [];
    try {
      return JSON.parse(GestionnaireLibrary.listFilesJson() || "[]");
    } catch {
      return [];
    }
  }

  function groupByFolder(files) {
    const groups = new Map();
    for (const file of files || []) {
      const folderPath = String(file.folderPath || "Vrac").trim() || "Vrac";
      if (!groups.has(folderPath)) groups.set(folderPath, []);
      groups.get(folderPath).push(file);
    }
    return [...groups.entries()]
      .map(([folderPath, items]) => ({ folderPath, name: blockNameFromFolder(folderPath), items }))
      .sort((a, b) => a.folderPath.localeCompare(b.folderPath));
  }

  function blockNameFromFolder(folderPath) {
    const parts = String(folderPath || "Vrac").split(/[\\/]+/).map(p => p.trim()).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : "Vrac";
  }

  function closePanel() {
    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.remove();
  }

  async function readFile(info) {
    const base64 = GestionnaireLibrary.readFileBase64(info.uri);
    if (!base64) throw new Error("Lecture impossible");
    return base64ToFile(base64, info.name, info.mimeType);
  }

  async function ensureBlock(blockName) {
    const clean = typeof normalizeBlock === "function" ? normalizeBlock(blockName) : String(blockName || "Vrac").trim() || "Vrac";
    if (window.state) {
      state.customBlocks = Array.isArray(state.customBlocks) ? state.customBlocks : [];
      if (!state.customBlocks.includes(clean) && !(typeof DEFAULT_MEDIA_BLOCKS !== "undefined" && DEFAULT_MEDIA_BLOCKS.includes(clean))) {
        state.customBlocks.push(clean);
        if (typeof saveCustomBlocks === "function") await saveCustomBlocks();
      }

      if (state.temp?.musicDraft) {
        state.temp.musicDraft.primaryBlock = clean;
        state.temp.musicDraft.allowedBlocks = Array.from(new Set([...(state.temp.musicDraft.allowedBlocks || []), clean]));
        state.temp.musicDraft.mediaSourceMode = "single";
        if (typeof saveMusicDraft === "function") await saveMusicDraft();
      }
    }
    return clean;
  }

  async function useAsMusic(info) {
    const file = await readFile(info);
    if (!file.type.startsWith("audio/")) {
      toast("Choisis un fichier audio pour la musique principale.");
      return;
    }

    if (state.temp.musicAudioUrl) {
      try { URL.revokeObjectURL(state.temp.musicAudioUrl); } catch {}
    }

    state.temp.musicAudioFile = file;
    state.temp.musicAudioUrl = URL.createObjectURL(file);
    state.temp.musicAudioDuration = await getBlobDuration(file, "audio");
    if (!state.temp.musicDraft.name) state.temp.musicDraft.name = file.name.replace(/\.[^.]+$/, "");

    toast("Audio pioché dans Gestionnaire sans sauvegarde dans Montage IA.");
    closePanel();
    render();
  }

  async function useAsTemporaryVisual(info, blockName = "Vrac") {
    const file = await readFile(info);
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");

    if (!isImage && !isVideo) {
      toast("Choisis une image ou une vidéo.");
      return false;
    }

    const mediaType = isImage ? "image" : "video";
    const orientation = await detectFileOrientation(file, mediaType);
    const block = await ensureBlock(blockName);

    state.cache.media.unshift({
      id: `gestion_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      owner: state.profile || "admin",
      bucket: `music-${mediaType}`,
      mediaType,
      fileName: file.name,
      block,
      orientation,
      blob: file,
      size: file.size,
      mimeType: file.type,
      tags: ["gestionnaire", "temporaire", block],
      createdAt: new Date().toISOString(),
      temporary: true
    });

    return true;
  }

  async function importFolderAsBlock(folder) {
    const block = await ensureBlock(folder.name || folder.folderPath || "Vrac");
    const visualFiles = (folder.items || []).filter(file => {
      const mime = String(file.mimeType || "");
      return mime.startsWith("image/") || mime.startsWith("video/");
    });

    if (!visualFiles.length) {
      toast("Ce dossier ne contient pas d’image ou de vidéo.");
      return;
    }

    let count = 0;
    for (const info of visualFiles) {
      try {
        const ok = await useAsTemporaryVisual(info, block);
        if (ok) count++;
      } catch {}
    }

    if (typeof render === "function") render();
    closePanel();
    toast(`${count} média${count > 1 ? "s" : ""} importé${count > 1 ? "s" : ""} depuis le dossier ${block}.`);
  }

  function openFolderView(folder) {
    const files = folder.items || [];
    const title = folder.folderPath || folder.name || "Dossier";
    const listHtml = files.length
      ? files.map((file, index) => `
        <div style="border:1px solid #334155;border-radius:14px;padding:10px;margin-top:8px;background:#111827;">
          <strong style="display:block;font-size:14px;line-height:1.25;">${escapeText(file.name || "Fichier")}</strong>
          <span style="display:block;color:#94a3b8;font-size:12px;margin-top:3px;">${escapeText(file.mimeType || "fichier")} · ${formatSize(file.size)}</span>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:9px;">
            <button data-use-music="${index}" style="border:0;border-radius:12px;padding:10px;background:#2563eb;color:#fff;font-weight:800;">Musique</button>
            <button data-use-media="${index}" style="border:1px solid #475569;border-radius:12px;padding:10px;background:#172033;color:#fff;font-weight:800;">Média</button>
          </div>
        </div>
      `).join("")
      : `<p style="color:#cbd5e1;">Dossier vide.</p>`;

    renderShell(`
      <button id="gestionBackFolders" style="border:1px solid #334155;border-radius:12px;background:#111827;color:#fff;padding:10px 12px;font-weight:800;margin-bottom:10px;">← Dossiers</button>
      <h2 style="margin:0;font-size:20px;">${escapeText(title)}</h2>
      <p style="margin:5px 0 0;color:#94a3b8;font-size:13px;">${files.length} fichier${files.length > 1 ? "s" : ""}</p>
      <button id="gestionImportFolder" style="width:100%;border:0;border-radius:14px;padding:13px;margin-top:12px;background:#22c55e;color:#06230f;font-weight:900;">Importer ce dossier comme bloc</button>
      <div style="margin-top:12px;">${listHtml}</div>
    `);

    document.getElementById("gestionBackFolders").onclick = openPanel;
    document.getElementById("gestionImportFolder").onclick = () => importFolderAsBlock(folder).catch(() => toast("Import du dossier impossible."));

    document.querySelectorAll("[data-use-music]").forEach((button) => {
      button.onclick = () => useAsMusic(files[Number(button.dataset.useMusic)]).catch(() => toast("Impossible d’utiliser ce fichier."));
    });

    document.querySelectorAll("[data-use-media]").forEach((button) => {
      button.onclick = () => useAsTemporaryVisual(files[Number(button.dataset.useMedia)], folder.name).then((ok) => {
        if (ok) {
          toast("Média ajouté en temporaire.");
          render();
        }
      }).catch(() => toast("Impossible d’utiliser ce média."));
    });
  }

  function renderShell(contentHtml) {
    closePanel();
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 999999;
      background: rgba(2,6,23,.82);
      color: #fff;
      font-family: system-ui, sans-serif;
      display: flex;
      align-items: flex-end;
    `;

    panel.innerHTML = `
      <div style="width:100%;max-height:84vh;overflow:auto;background:#0f172a;border-radius:22px 22px 0 0;padding:16px;border-top:1px solid #334155;box-shadow:0 -18px 40px rgba(0,0,0,.45);">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:12px;">
          <div>
            <h2 style="margin:0;font-size:20px;">Piocher dans Gestionnaire</h2>
            <p style="margin:5px 0 0;color:#94a3b8;font-size:13px;">Dossiers → blocs temporaires. Rien n’est sauvegardé dans Montage IA.</p>
          </div>
          <button id="gestionClose" style="border:0;border-radius:14px;background:#1f2937;color:#fff;padding:9px 13px;font-size:18px;">×</button>
        </div>
        ${contentHtml}
      </div>
    `;

    document.body.appendChild(panel);
    panel.querySelector("#gestionClose").onclick = closePanel;
  }

  function openPanel() {
    if (!hasBridge()) {
      toast("Le lien Gestionnaire n’est disponible que dans l’APK.");
      return;
    }

    const files = listGestionnaireFiles();
    const folders = groupByFolder(files);

    const foldersHtml = folders.length
      ? folders.map((folder, index) => {
          const visualCount = folder.items.filter(file => String(file.mimeType || "").startsWith("image/") || String(file.mimeType || "").startsWith("video/")).length;
          const audioCount = folder.items.filter(file => String(file.mimeType || "").startsWith("audio/")).length;
          return `
            <div style="border:1px solid #334155;border-radius:16px;padding:12px;margin-top:10px;background:#111827;">
              <strong style="display:block;font-size:16px;line-height:1.2;">📁 ${escapeText(folder.folderPath)}</strong>
              <span style="display:block;color:#94a3b8;font-size:12px;margin-top:4px;">${folder.items.length} fichier${folder.items.length > 1 ? "s" : ""} · ${visualCount} média${visualCount > 1 ? "s" : ""} · ${audioCount} audio</span>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;">
                <button data-open-folder="${index}" style="border:1px solid #475569;border-radius:12px;padding:11px;background:#172033;color:#fff;font-weight:800;">Ouvrir</button>
                <button data-import-folder="${index}" style="border:0;border-radius:12px;padding:11px;background:#22c55e;color:#06230f;font-weight:900;">Importer bloc</button>
              </div>
            </div>
          `;
        }).join("")
      : `<p style="color:#cbd5e1;">Aucun fichier trouvé. Ouvre Gestionnaire une fois, importe tes fichiers dans un dossier, puis reviens ici.</p>`;

    renderShell(`<div>${foldersHtml}</div>`);

    document.querySelectorAll("[data-open-folder]").forEach((button) => {
      button.onclick = () => openFolderView(folders[Number(button.dataset.openFolder)]);
    });

    document.querySelectorAll("[data-import-folder]").forEach((button) => {
      button.onclick = () => importFolderAsBlock(folders[Number(button.dataset.importFolder)]).catch(() => toast("Import du dossier impossible."));
    });
  }

  function installButton() {
    if (document.getElementById(BUTTON_ID)) return;
    const btn = document.createElement("button");
    btn.id = BUTTON_ID;
    btn.type = "button";
    btn.textContent = "📁 Gestionnaire";
    btn.style.cssText = `
      position: fixed;
      right: 14px;
      bottom: 82px;
      z-index: 99998;
      border: 0;
      border-radius: 999px;
      padding: 12px 14px;
      background: #2563eb;
      color: white;
      font-weight: 900;
      box-shadow: 0 12px 28px rgba(0,0,0,.35);
    `;
    btn.onclick = openPanel;
    document.body.appendChild(btn);
  }

  document.addEventListener("DOMContentLoaded", () => setTimeout(installButton, 800));
  setTimeout(installButton, 1500);
})();
