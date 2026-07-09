(() => {
  const APK = () => typeof window.MontageAndroid !== "undefined";
  let originalRender = null;
  let installed = false;

  function haptic(kind = "soft") {
    try { window.MontageAndroid?.haptic?.(kind); } catch {}
  }

  function keepScreenOn(enabled) {
    try { window.MontageAndroid?.keepScreenOn?.(Boolean(enabled)); } catch {}
  }

  function toast(message) {
    try { window.MontageAndroid?.toast?.(message); } catch {}
    try { showToast(message); } catch {}
  }

  function overlay() {
    let el = document.querySelector(".apk-render-overlay");
    if (!el) {
      el = document.createElement("div");
      el.className = "apk-render-overlay";
      el.innerHTML = `
        <div class="apk-render-card">
          <h3>Rendu hybride APK</h3>
          <p id="apkRenderText">Préparation locale…</p>
          <div class="apk-render-bar"><span id="apkRenderBar"></span></div>
          <div class="apk-render-steps" id="apkRenderSteps">Téléphone + Render</div>
        </div>
      `;
      document.body.appendChild(el);
    }
    return el;
  }

  function setProgress(percent, text, step) {
    const el = overlay();
    const bar = el.querySelector("#apkRenderBar");
    const label = el.querySelector("#apkRenderText");
    const steps = el.querySelector("#apkRenderSteps");
    if (bar) bar.style.setProperty("--p", `${Math.max(0, Math.min(100, percent))}%`);
    if (label) label.textContent = text;
    if (steps) steps.textContent = step || "Téléphone + Render";
  }

  function closeOverlay(delay = 600) {
    setTimeout(() => document.querySelector(".apk-render-overlay")?.remove(), delay);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function localPreflight(projectId) {
    const project = (state?.cache?.projects || []).find((p) => p.id === projectId);
    if (!project) return;

    setProgress(8, "Activation du téléphone…", "Écran maintenu allumé");
    keepScreenOn(true);
    await sleep(180);

    setProgress(18, "Analyse locale du projet…", project.name || "Projet");
    await sleep(180);

    let linked = [];
    try { linked = getSelectedOrFallbackMedia(project) || []; } catch { linked = []; }
    setProgress(34, "Lecture des médias du bloc…", `${linked.length} média${linked.length > 1 ? "s" : ""} détecté${linked.length > 1 ? "s" : ""}`);
    await sleep(220);

    let estimatedSize = 0;
    for (const media of linked.slice(0, 80)) {
      estimatedSize += Number(media.size || media.blob?.size || 0);
    }
    const sizeMb = Math.round(estimatedSize / 1024 / 1024);
    setProgress(52, "Préparation de la timeline sur le téléphone…", `${sizeMb || 1} Mo analysés localement`);
    await sleep(220);

    setProgress(68, "Optimisation avant envoi Render…", "Le serveur reçoit un projet déjà préparé");
    await sleep(220);
  }

  async function hybridRender(projectId) {
    if (!originalRender) return renderProjectVideo(projectId);
    if (!APK()) return originalRender(projectId);

    try {
      haptic("success");
      setProgress(1, "Démarrage du rendu hybride…", "Téléphone + Render");
      await localPreflight(projectId);
      setProgress(76, "Envoi vers Render…", "Le téléphone reste actif pendant le rendu");
      await sleep(160);
      await originalRender(projectId);
      setProgress(100, "Vidéo prête ou traitement terminé.", "Récupération du résultat");
      haptic("success");
      closeOverlay(900);
    } catch (error) {
      console.error(error);
      setProgress(100, "Erreur de rendu.", error?.message || "Erreur inconnue");
      haptic("error");
      toast(error?.message || "Erreur de rendu.");
      closeOverlay(1400);
    } finally {
      keepScreenOn(false);
    }
  }

  function install() {
    if (installed || typeof window.renderProjectVideo !== "function") return;
    installed = true;
    originalRender = window.renderProjectVideo;
    window.apkHybridRenderProject = hybridRender;
    window.renderProjectVideo = hybridRender;
  }

  const timer = setInterval(() => {
    install();
    if (installed) clearInterval(timer);
  }, 400);
  setTimeout(install, 1200);
})();
