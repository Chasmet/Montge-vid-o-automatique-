(() => {
  const APK = () => typeof window.MontageAndroid !== "undefined";
  const STORE_KEY = "apkGestionnaireMediaSession";
  let installed = false;

  function isGestionnaireMedia(item) {
    return Boolean(
      item &&
      item.blob &&
      (
        item.sourceApp === "gestionnaire" ||
        item.temporary === true ||
        item.gestionnaireKey ||
        item.sourceKey ||
        String(item.id || "").startsWith("gestion_")
      )
    );
  }

  function ensureStore() {
    if (!window.state) return [];
    if (!Array.isArray(state.temp[STORE_KEY])) state.temp[STORE_KEY] = [];
    return state.temp[STORE_KEY];
  }

  function sameMedia(a, b) {
    if (!a || !b) return false;
    const ak = a.gestionnaireKey || a.sourceKey || a.relativePath || a.id;
    const bk = b.gestionnaireKey || b.sourceKey || b.relativePath || b.id;
    if (ak && bk && ak === bk) return true;
    return a.id && b.id && a.id === b.id;
  }

  function captureGestionnaireMedia() {
    if (!APK() || !window.state?.cache?.media) return;
    const store = ensureStore();
    const incoming = state.cache.media.filter(isGestionnaireMedia);
    for (const item of incoming) {
      const already = store.some((saved) => sameMedia(saved, item));
      if (!already) store.push(item);
    }
  }

  function restoreGestionnaireMedia() {
    if (!APK() || !window.state?.cache?.media) return;
    const store = ensureStore().filter(isGestionnaireMedia);
    state.temp[STORE_KEY] = store;
    for (const saved of store) {
      const exists = state.cache.media.some((item) => sameMedia(item, saved));
      if (!exists) state.cache.media.unshift(saved);
    }
  }

  function wantedBucket(projectKind, draft) {
    try { return getBucketForProject(projectKind, draft?.mode || "video"); } catch { return `${projectKind}-${draft?.mode || "video"}`; }
  }

  function safeBlock(value) {
    try { return normalizeBlock(value); } catch { return String(value || "Vrac").trim() || "Vrac"; }
  }

  function draftBlocks(draft) {
    try { return getDraftBlocks(draft).map(safeBlock); } catch { return [safeBlock(draft?.primaryBlock || "Vrac")]; }
  }

  function sortRecent(items) {
    return [...items].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }

  function apkFallbackMedia(projectKind, draft) {
    if (!window.state?.cache?.media) return [];
    const bucket = wantedBucket(projectKind, draft);
    const mode = draft?.mode || "video";
    const blocks = draftBlocks(draft);
    const sourceMode = draft?.mediaSourceMode || "single";

    let items = state.cache.media
      .filter((item) => item.bucket === bucket)
      .filter((item) => item.mediaType === mode);

    if (sourceMode !== "ai") {
      items = items.filter((item) => blocks.includes(safeBlock(item.block || "Vrac")));
    }

    if (!items.length && sourceMode !== "ai") {
      items = state.cache.media
        .filter((item) => item.bucket === bucket)
        .filter((item) => item.mediaType === mode)
        .filter(isGestionnaireMedia);
    }

    return sortRecent(items);
  }

  function patchHydrate() {
    if (typeof window.hydrateCache !== "function" || window.hydrateCache.__apkPatched) return;
    const original = window.hydrateCache;
    window.hydrateCache = async function patchedHydrateCache(...args) {
      captureGestionnaireMedia();
      const result = await original.apply(this, args);
      restoreGestionnaireMedia();
      return result;
    };
    window.hydrateCache.__apkPatched = true;
  }

  function patchFilter() {
    if (typeof window.filterMediaForDraft === "function" && !window.filterMediaForDraft.__apkPatched) {
      const original = window.filterMediaForDraft;
      window.filterMediaForDraft = function patchedFilterMediaForDraft(projectKind, draft) {
        captureGestionnaireMedia();
        restoreGestionnaireMedia();
        const normal = original.call(this, projectKind, draft) || [];
        if (normal.length) return normal;
        const fallback = apkFallbackMedia(projectKind, draft);
        if (fallback.length) {
          try { showToast("APK : médias Gestionnaire acceptés même si le format n’est pas parfait."); } catch {}
          return fallback;
        }
        return normal;
      };
      window.filterMediaForDraft.__apkPatched = true;
    }

    if (typeof window.getSelectedOrFallbackMedia === "function" && !window.getSelectedOrFallbackMedia.__apkPatched) {
      const original = window.getSelectedOrFallbackMedia;
      window.getSelectedOrFallbackMedia = function patchedGetSelectedOrFallbackMedia(project) {
        captureGestionnaireMedia();
        restoreGestionnaireMedia();
        const normal = original.call(this, project) || [];
        if (normal.length) return normal;

        const draft = {
          mode: project?.config?.mode || "video",
          aspectRatio: project?.config?.aspectRatio || "vertical",
          mediaSourceMode: project?.config?.mediaSourceMode || "single",
          primaryBlock: project?.config?.primaryBlock || "Vrac",
          allowedBlocks: project?.config?.allowedBlocks || []
        };

        return apkFallbackMedia(project?.type || "music", draft).slice(0, 12);
      };
      window.getSelectedOrFallbackMedia.__apkPatched = true;
    }
  }

  function install() {
    if (!APK() || !window.state) return;
    installed = true;
    patchHydrate();
    patchFilter();
    captureGestionnaireMedia();
    restoreGestionnaireMedia();
  }

  setInterval(() => {
    install();
    if (installed) {
      captureGestionnaireMedia();
      restoreGestionnaireMedia();
    }
  }, 700);
  setTimeout(install, 500);
  setTimeout(install, 1500);
})();
