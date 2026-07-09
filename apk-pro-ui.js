(() => {
  const SHELL_ID = "apkProShell";
  const APK_READY = () => typeof window.MontageAndroid !== "undefined";
  let toastTimer = null;
  let lastHtml = "";

  function haptic(kind = "soft") {
    try { window.MontageAndroid?.haptic?.(kind); } catch {}
  }

  function toast(message) {
    try { window.MontageAndroid?.toast?.(message); } catch {}
    let el = document.querySelector(".apk-pro-toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "apk-pro-toast";
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2300);
  }

  function esc(v) {
    return String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }

  function getDevice() {
    try { return JSON.parse(window.MontageAndroid.getDeviceProfileJson() || "{}"); } catch { return {}; }
  }

  function blockName(value) {
    try { return normalizeBlock(value); } catch { return String(value || "Vrac").trim() || "Vrac"; }
  }

  function currentBucket() {
    try {
      const mode = state?.temp?.musicDraft?.mode || state?.libraryType || "video";
      return getBucketForProject("music", mode === "image" ? "image" : "video");
    } catch { return "music-video"; }
  }

  function mediaForBlock(block) {
    const key = blockName(block).toLowerCase();
    const bucket = currentBucket();
    return (state?.cache?.media || []).filter((item) => {
      if (state?.profile && item.owner !== state.profile) return false;
      if (item.bucket !== bucket) return false;
      return blockName(item.block || "Vrac").toLowerCase() === key;
    });
  }

  function allBlocks() {
    const base = ["Animé / Manga", "Grok", "Instagram 2026", "Horreur", "Moi", "Documentaire", "Vrac"];
    const fromCache = (state?.cache?.media || []).map((m) => m.block || "Vrac");
    const fromCustom = state?.customBlocks || [];
    const seen = new Set();
    return [...base, ...fromCustom, ...fromCache]
      .map(blockName)
      .filter((b) => {
        const k = b.toLowerCase();
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 8);
  }

  function colorForBlock(block) {
    const k = String(block).toLowerCase();
    if (k.includes("grok")) return ["#155cff", "#0f2b66", "🤖"];
    if (k.includes("insta")) return ["#ec4899", "#6d28d9", "📸"];
    if (k.includes("anim")) return ["#7c3aed", "#1d4ed8", "🎞️"];
    if (k.includes("horreur")) return ["#991b1b", "#09090b", "👻"];
    if (k.includes("document")) return ["#0891b2", "#1d4ed8", "🎥"];
    if (k.includes("moi")) return ["#0d9488", "#164e63", "👤"];
    return ["#2563eb", "#0f172a", "📁"];
  }

  function selectedBlock() {
    return blockName(state?.temp?.musicDraft?.primaryBlock || state?.libraryBlockFilter || "Vrac");
  }

  function selectedMediaCount(block = selectedBlock()) {
    return mediaForBlock(block).length;
  }

  function durationEstimate() {
    const raw = Number(state?.temp?.musicDraft?.targetDuration || 0) || 48;
    const min = Math.floor(raw / 60);
    const sec = Math.round(raw % 60).toString().padStart(2, "0");
    return `${min}:${sec}`;
  }

  function latestProject() {
    const projects = (state?.cache?.projects || []).filter((p) => p.type === "music" || p.type === "speech");
    if (state?.currentResultId) {
      const current = projects.find((p) => p.id === state.currentResultId);
      if (current) return current;
    }
    return projects.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))[0] || null;
  }

  function chooseBlock(block) {
    haptic("soft");
    const clean = blockName(block);
    if (state?.temp?.musicDraft) {
      state.temp.musicDraft.primaryBlock = clean;
      state.temp.musicDraft.allowedBlocks = [clean];
      state.temp.musicDraft.mediaSourceMode = "single";
      try { saveMusicDraft?.(); } catch {}
    }
    state.libraryBlockFilter = clean;
    toast(`Bloc actif : ${clean}`);
    renderShell(true);
  }

  function openImporter() {
    haptic("soft");
    const button = document.getElementById("gestionnairePickerButton");
    if (button) {
      button.click();
      return;
    }
    toast("Module Gestionnaire indisponible. Relance l’APK.");
  }

  function openLibrary() {
    haptic("soft");
    try {
      state.libraryMode = "music";
      state.libraryType = state?.temp?.musicDraft?.mode || "video";
      setRoute("library");
    } catch {}
  }

  function openProjects() {
    haptic("soft");
    try { setRoute("projects"); } catch {}
  }

  function openSettings() {
    haptic("soft");
    try { setRoute("settings"); } catch {}
  }

  function goHome() {
    haptic("soft");
    try { setRoute("dashboard"); } catch {}
  }

  async function createVideo() {
    haptic("success");
    const project = latestProject();
    if (!project) {
      toast("Aucun projet prêt. Crée d’abord un projet musical.");
      try { setRoute("musicProject"); } catch {}
      return;
    }
    try {
      await window.apkHybridRenderProject?.(project.id);
    } catch {
      try { await renderProjectVideo(project.id); } catch (e) { toast(e?.message || "Rendu impossible."); }
    }
  }

  async function previewLatest() {
    haptic("soft");
    const project = latestProject();
    if (!project?.config?.finalVideoMediaId) return toast("Aucune vidéo finale à prévisualiser.");
    try { openMediaViewer(project.config.finalVideoMediaId); } catch { toast("Prévisualisation indisponible."); }
  }

  function renderShell(force = false) {
    if (!APK_READY() || !window.state || !state.profile) return;
    const blockedRoutes = new Set(["adminLogin", "profile", "settings"]);
    if (blockedRoutes.has(state.route)) {
      document.body.classList.add("apk-pro-runtime");
      const screen = document.getElementById("screen");
      screen?.classList.remove("apk-pro-shell-active");
      document.getElementById(SHELL_ID)?.remove();
      return;
    }

    document.body.classList.add("apk-pro-runtime");
    const screen = document.getElementById("screen");
    if (!screen) return;
    screen.classList.add("apk-pro-shell-active");

    const device = getDevice();
    const blocks = allBlocks();
    const active = selectedBlock();
    const activeCount = selectedMediaCount(active);
    const project = latestProject();
    const projectName = project?.name || state?.temp?.musicDraft?.name || "Ex. : Alpha Omega";
    const subStatus = state?.temp?.musicDraft?.subtitlesEnabled ? "activés" : "désactivés";
    const mode = `${device.cores || "?"} cœurs · ${device.freeMemoryMb || "?"} Mo libres`;

    const blockCards = blocks.map((block) => {
      const [b1, b2, emoji] = colorForBlock(block);
      const count = selectedMediaCount(block);
      const activeClass = block.toLowerCase() === active.toLowerCase() ? " aria-current=\"true\"" : "";
      return `<button class="apk-block-card" type="button" data-apk-action="choose-block" data-block="${esc(block)}" style="--b1:${b1};--b2:${b2};"${activeClass}><span class="emoji">${emoji}</span><span><strong>${esc(block)}</strong><span>${count} fichier${count > 1 ? "s" : ""}</span></span></button>`;
    }).join("");

    const html = `
      <div class="apk-pro-header">
        <div class="apk-pro-brand"><div class="apk-pro-logo">🎬<small style="font-size:18px">IA</small></div><div><p class="apk-pro-eyebrow">Application personnelle</p><h1 class="apk-pro-title">Studio vidéo IA</h1></div></div>
        <button class="apk-pro-theme" type="button" data-action="toggle-theme">☼ Mode clair</button>
      </div>

      <section class="apk-pro-card">
        <h2 class="apk-pro-card-title"><span class="apk-pro-icon">＋</span>Nouveau projet</h2>
        <div class="apk-pro-field"><strong>Nom du projet</strong><span>${esc(projectName)}</span></div>
        <div class="apk-pro-field"><strong>Audio principal</strong><span>${state?.temp?.musicAudioFile?.name ? esc(state.temp.musicAudioFile.name) : "Choisir un fichier"} ›</span></div>
        <strong class="apk-pro-muted">Mode de rendu</strong>
        <div class="apk-pro-segment"><button class="active" type="button">📱+🖥️ Téléphone + Render ✓</button><button type="button">🖥️ Render seul</button><button type="button">📱 Téléphone seul</button></div>
        <p class="apk-pro-help">Utilise la puissance du téléphone pour analyser, préparer et garder l’écran actif, puis Render finalise le MP4.</p>
      </section>

      <section class="apk-pro-card">
        <div class="apk-render-status"><h2 class="apk-pro-card-title" style="margin:0"><span class="apk-pro-icon">⚙️</span>Moteur de rendu</h2><div class="apk-pill-row"><span class="apk-status-pill"><i class="apk-dot"></i>Téléphone</span><span class="apk-status-pill"><i class="apk-dot"></i>Render</span><span class="apk-status-pill"><i class="apk-dot"></i>APK</span></div></div>
        <p class="apk-pro-help">Prêt pour rendu hybride · ${esc(mode)}</p><div class="apk-progress-line"><span></span></div>
      </section>

      <section class="apk-pro-card">
        <div class="apk-pro-section-head"><h2>Blocs médias</h2><button class="apk-pro-link" type="button" data-apk-action="library">Voir tout ›</button></div>
        <div class="apk-block-grid">${blockCards}</div>
      </section>

      <section class="apk-pro-card">
        <h2 class="apk-pro-card-title"><span class="apk-pro-icon">☁️</span>Import depuis Gestionnaire</h2>
        <p class="apk-pro-help">Import additif : un bloc ajouté n’efface pas les autres.</p>
        <div class="apk-action-grid"><button class="apk-btn apk-btn-primary" type="button" data-apk-action="import">↥ Importer / compléter un bloc</button><button class="apk-btn apk-btn-secondary" type="button" data-apk-action="import">📁 Ouvrir Gestionnaire</button></div>
      </section>

      <section class="apk-pro-card"><h2 class="apk-pro-card-title">Résumé du projet</h2><div class="apk-summary-grid"><div class="apk-summary-item"><span>Bloc actif</span><strong>${esc(active)}</strong></div><div class="apk-summary-item"><span>Médias sélectionnés</span><strong>${activeCount}</strong></div><div class="apk-summary-item"><span>Durée estimée</span><strong>${durationEstimate()}</strong></div><div class="apk-summary-item"><span>Sous-titres</span><strong>${subStatus}</strong></div></div></section>

      <button class="apk-main-cta" type="button" data-apk-action="create-video">✨ Créer la vidéo →</button>
      <button class="apk-preview-btn" type="button" data-apk-action="preview">▷ Prévisualiser</button>
      <nav class="apk-pro-nav"><button class="active" type="button" data-apk-action="home">⌂<br>Accueil</button><button type="button" data-apk-action="projects">□<br>Projets</button><button type="button" data-apk-action="settings">⚙<br>Réglages</button></nav>
    `;

    if (!force && html === lastHtml && document.getElementById(SHELL_ID)) return;
    lastHtml = html;
    let shell = document.getElementById(SHELL_ID);
    if (!shell) {
      shell = document.createElement("div");
      shell.id = SHELL_ID;
      screen.prepend(shell);
    }
    shell.innerHTML = html;
  }

  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-apk-action]");
    if (!target) return;
    event.preventDefault();
    const action = target.dataset.apkAction;
    if (action === "choose-block") return chooseBlock(target.dataset.block);
    if (action === "library") return openLibrary();
    if (action === "import") return openImporter();
    if (action === "create-video") return createVideo();
    if (action === "preview") return previewLatest();
    if (action === "projects") return openProjects();
    if (action === "settings") return openSettings();
    if (action === "home") return goHome();
  }, true);

  window.addEventListener("android-shared-files-ready", () => renderShell(true));
  window.addEventListener("pageshow", () => renderShell(true));
  setInterval(renderShell, 900);
  setTimeout(() => renderShell(true), 600);
  setTimeout(() => renderShell(true), 1600);
})();
