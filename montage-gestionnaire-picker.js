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

  function closePanel() {
    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.remove();
  }

  async function readFile(info) {
    const base64 = GestionnaireLibrary.readFileBase64(info.uri);
    if (!base64) throw new Error("Lecture impossible");
    return base64ToFile(base64, info.name, info.mimeType);
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

  async function useAsTemporaryVisual(info) {
    const file = await readFile(info);
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");

    if (!isImage && !isVideo) {
      toast("Choisis une image ou une vidéo.");
      return;
    }

    const mediaType = isImage ? "image" : "video";
    const orientation = await detectFileOrientation(file, mediaType);

    state.cache.media.unshift({
      id: `gestion_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      owner: state.profile || "admin",
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
    });

    toast("Média pioché dans Gestionnaire en temporaire.");
    closePanel();
    render();
  }

  function openPanel() {
    closePanel();

    if (!hasBridge()) {
      toast("Le lien Gestionnaire n’est disponible que dans l’APK.");
      return;
    }

    const files = listGestionnaireFiles();
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

    const listHtml = files.length
      ? files.map((file, index) => `
        <div style="border:1px solid #334155;border-radius:14px;padding:10px;margin-top:8px;background:#111827;">
          <strong style="display:block;font-size:14px;line-height:1.25;">${file.name || "Fichier"}</strong>
          <span style="display:block;color:#94a3b8;font-size:12px;margin-top:3px;">${file.mimeType || "fichier"} · ${formatSize(file.size)}</span>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:9px;">
            <button data-use-music="${index}" style="border:0;border-radius:12px;padding:10px;background:#2563eb;color:#fff;font-weight:800;">Musique</button>
            <button data-use-media="${index}" style="border:1px solid #475569;border-radius:12px;padding:10px;background:#172033;color:#fff;font-weight:800;">Média</button>
          </div>
        </div>
      `).join("")
      : `<p style="color:#cbd5e1;">Aucun fichier trouvé. Ouvre Gestionnaire et importe au moins un fichier après avoir installé le nouvel APK Gestionnaire.</p>`;

    panel.innerHTML = `
      <div style="width:100%;max-height:82vh;overflow:auto;background:#0f172a;border-radius:22px 22px 0 0;padding:16px;border-top:1px solid #334155;box-shadow:0 -18px 40px rgba(0,0,0,.45);">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
          <div>
            <h2 style="margin:0;font-size:20px;">Piocher dans Gestionnaire</h2>
            <p style="margin:5px 0 0;color:#94a3b8;font-size:13px;">Utilisation temporaire : rien n’est sauvegardé dans Montage IA.</p>
          </div>
          <button id="gestionClose" style="border:0;border-radius:14px;background:#1f2937;color:#fff;padding:9px 13px;font-size:18px;">×</button>
        </div>
        <div style="margin-top:12px;">${listHtml}</div>
      </div>
    `;

    document.body.appendChild(panel);
    panel.querySelector("#gestionClose").onclick = closePanel;

    panel.querySelectorAll("[data-use-music]").forEach((button) => {
      button.onclick = () => useAsMusic(files[Number(button.dataset.useMusic)]).catch(() => toast("Impossible d’utiliser ce fichier."));
    });

    panel.querySelectorAll("[data-use-media]").forEach((button) => {
      button.onclick = () => useAsTemporaryVisual(files[Number(button.dataset.useMedia)]).catch(() => toast("Impossible d’utiliser ce média."));
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
