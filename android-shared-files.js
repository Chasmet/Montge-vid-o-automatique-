(() => {
  const BRIDGE_NAME = "AndroidSharedFiles";
  const PANEL_ID = "androidSharedFilesPanel";

  function hasBridge() {
    return typeof window[BRIDGE_NAME] !== "undefined";
  }

  function parseFiles() {
    if (!hasBridge()) return [];
    try {
      return JSON.parse(window[BRIDGE_NAME].getSharedFilesJson() || "[]");
    } catch {
      return [];
    }
  }

  function base64ToBlob(base64, mimeType) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeType || "application/octet-stream" });
  }

  function formatSize(bytes) {
    if (!bytes) return "taille inconnue";
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} Mo`;
    return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  }

  function toast(message) {
    const existing = document.getElementById("toast");
    if (existing) {
      existing.textContent = message;
      existing.classList.remove("hidden");
      setTimeout(() => existing.classList.add("hidden"), 2600);
      return;
    }
    alert(message);
  }

  async function readSharedFile(fileInfo) {
    const base64 = window[BRIDGE_NAME].readSharedFileBase64(Number(fileInfo.index));
    if (!base64) throw new Error("Fichier Android illisible");
    const blob = base64ToBlob(base64, fileInfo.mimeType);
    return new File([blob], fileInfo.name || "fichier-partage", {
      type: fileInfo.mimeType || "application/octet-stream"
    });
  }

  async function useAsTemporaryMusic(fileInfo) {
    const file = await readSharedFile(fileInfo);
    if (!file.type.startsWith("audio/")) {
      toast("Ce fichier n’est pas un audio. Choisis un fichier audio pour la musique principale.");
      return;
    }

    if (!window.state || !window.state.temp) {
      toast("Application pas encore prête. Réessaie dans 2 secondes.");
      return;
    }

    if (window.state.temp.musicAudioUrl) {
      try { URL.revokeObjectURL(window.state.temp.musicAudioUrl); } catch {}
    }

    window.state.temp.musicAudioFile = file;
    window.state.temp.musicAudioUrl = URL.createObjectURL(file);
    window.state.temp.musicAudioDuration = typeof window.getBlobDuration === "function"
      ? await window.getBlobDuration(file, "audio")
      : 0;

    const draft = window.state.temp.musicDraft;
    if (draft && (!draft.name || draft.name === "")) {
      draft.name = file.name.replace(/\.[^.]+$/, "");
    }

    toast("Audio reçu du Gestionnaire : prêt sans sauvegarde dans Montage IA");
    closePanel();

    if (typeof window.render === "function") {
      window.render();
    }
  }

  async function addToTemporaryMedia(fileInfo) {
    const file = await readSharedFile(fileInfo);
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");

    if (!isImage && !isVideo) {
      toast("Pour les médias visuels, choisis une image ou une vidéo.");
      return;
    }

    if (!window.state || !window.state.cache || !Array.isArray(window.state.cache.media)) {
      toast("Application pas encore prête. Réessaie dans 2 secondes.");
      return;
    }

    const mediaType = isImage ? "image" : "video";
    const orientation = typeof window.detectFileOrientation === "function"
      ? await window.detectFileOrientation(file, mediaType)
      : "unknown";

    const tempMedia = {
      id: `shared_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      owner: window.state.profile || "admin",
      bucket: `music-${mediaType}`,
      mediaType,
      fileName: file.name,
      block: "Vrac",
      orientation,
      blob: file,
      size: file.size,
      mimeType: file.type,
      tags: ["gestionnaire", "temporaire"],
      createdAt: new Date().toISOString(),
      temporary: true
    };

    window.state.cache.media.unshift(tempMedia);
    toast("Média reçu en temporaire : utilisé sans sauvegarde dans Montage IA");
    closePanel();

    if (typeof window.render === "function") {
      window.render();
    }
  }

  function closePanel() {
    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.remove();
  }

  function renderPanel() {
    const files = parseFiles();
    closePanel();
    if (!files.length) return;

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.style.cssText = `
      position: fixed;
      left: 14px;
      right: 14px;
      bottom: 18px;
      z-index: 99999;
      background: #101827;
      color: #fff;
      border: 1px solid rgba(59,130,246,.55);
      border-radius: 18px;
      padding: 14px;
      box-shadow: 0 20px 45px rgba(0,0,0,.45);
      font-family: system-ui, sans-serif;
    `;

    const first = files[0];
    panel.innerHTML = `
      <div style="display:flex;gap:10px;align-items:flex-start;justify-content:space-between;">
        <div>
          <strong style="font-size:16px;">Fichier reçu du Gestionnaire</strong>
          <div style="font-size:13px;color:#aeb7c8;margin-top:4px;">${first.name || "Fichier"} · ${formatSize(first.size)}</div>
          <div style="font-size:12px;color:#8aa0bd;margin-top:2px;">Mode temporaire : pas de sauvegarde dans Montage IA</div>
        </div>
        <button id="androidSharedClose" type="button" style="font-size:18px;background:#1f2937;color:#fff;border:0;border-radius:12px;padding:7px 11px;">×</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr;gap:8px;margin-top:12px;">
        <button id="androidSharedMusic" type="button" style="padding:12px;border-radius:14px;border:0;background:#2563eb;color:white;font-weight:800;">Utiliser comme musique principale</button>
        <button id="androidSharedMedia" type="button" style="padding:12px;border-radius:14px;border:1px solid #334155;background:#172033;color:white;font-weight:800;">Ajouter comme média temporaire</button>
      </div>
    `;

    document.body.appendChild(panel);
    panel.querySelector("#androidSharedClose").onclick = closePanel;
    panel.querySelector("#androidSharedMusic").onclick = () => useAsTemporaryMusic(first).catch(() => toast("Impossible d’utiliser ce fichier"));
    panel.querySelector("#androidSharedMedia").onclick = () => addToTemporaryMedia(first).catch(() => toast("Impossible d’ajouter ce média"));
  }

  window.addEventListener("android-shared-files-ready", renderPanel);
  document.addEventListener("DOMContentLoaded", () => setTimeout(renderPanel, 800));
  setTimeout(renderPanel, 1600);
})();
