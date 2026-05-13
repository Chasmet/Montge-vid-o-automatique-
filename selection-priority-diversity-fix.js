/* Correctif pilotage auto :
   - force les médias choisis manuellement au tout début du montage
   - augmente la diversité entre les vidéos
   - mémorise l'usage pour réduire les répétitions */
(function () {
  const STORAGE_KEY = "chk_selection_diversity_history_v2";
  const MAX_RECENT = 80;

  function num(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function cleanIds(ids) {
    const out = [];
    const seen = new Set();
    for (const id of Array.isArray(ids) ? ids : []) {
      const v = String(id || "").trim();
      if (!v || seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    return out;
  }

  function itemId(item) {
    if (item == null) return "";
    if (typeof item === "string") return item.trim();
    return String(item.id || item.sourceId || item.mediaId || item.renderId || item.fileName || "").trim();n  }

  function itemBlock(item) {
    if (item == null || typeof item !== "object") return "";
    return String(item.block || item.collection || item.category || item.group || item.mediaType || "Vrac").toLowerCase();
  }

  function getProjectFromFormData(fd) {
    try {
      const title = String(fd.get("title") || "").trim();
      const projects = Array.isArray(window.state?.cache?.projects) ? window.state.cache.projects : [];
      const current = projects.find((project) => project.id === window.state?.currentResultId);
      if (current) return current;
      return projects.find((project) => project.name === title)
        || projects.find((project) => title && project.name && title.includes(project.name))
        || null;
    } catch {
      return null;
    }
  }

  function getSelectedIds(project) {
    return cleanIds(project?.config?.selectedMediaIds || project?.config?.montagePlan?.selectedMediaIds || []);
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const key = String(window.state?.profile || "global");
      if (!parsed[key]) {
        parsed[key] = { media: {}, recentIds: [], recentBlocks: [] };
      }
      return { store: parsed, key, history: parsed[key] };
    } catch {
      return {
        store: { global: { media: {}, recentIds: [], recentBlocks: [] } },
        key: "global",
        history: { media: {}, recentIds: [], recentBlocks: [] }
      };
    }
  }

  function saveHistory(bundle) {
    try {
      bundle.store[bundle.key] = bundle.history;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(bundle.store));
    } catch {}
  }

  function usageScore(item, history) {
    const id = itemId(item);
    const stats = history.media?.[id] || {};
    return (
      num(stats.usedCount, 0) * 20 +
      num(stats.firstFourCount, 0) * 50 +
      Math.random() * 0.001
    );
  }

  function reorder(items, selectedIds, history) {
    const list = Array.isArray(items) ? items : [];
    const byId = new Map();

    for (const item of list) {
      const id = itemId(item);
      if (id && !byId.has(id)) byId.set(id, item);
    }

    const result = [];
    const used = new Set();

    // 1. PRIORITÉ ABSOLUE : les médias choisis manuellement, dans l'ordre exact.
    for (const id of selectedIds) {
      const item = byId.get(String(id)); 
      if (!item) continue;
      result.push(item);
      used.add(itemId(item));
    }

    // 2. Ajouter les autres médias en privilégiant ceux les moins utilisés.
    const rest = list
      .filter((item) => !used.has(itemId(item)))
      .sort((a, b) => usageScore(a, history) - usageScore(b, history)); 

    for (const item of rest) {
      result.push(item);
    }

    return result;
  }

  function recordUsage(history, items) {
    const ids = cleanIds((Array.isArray(items) ? items : []).map(itemId)); 

    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i];
      const current = history.media[id] || {};
      history.media[id] = {
        usedCount: num(current.usedCount, 0) + 1,
        firstFourCount: num(current.firstFourCount, 0) + (i < 4 ? 1 : 0),
        lastUsedAt: new Date().toISOString()
      };
    }

    history.recentIds = [...ids, ...(history.recentIds || [])]
      .filter(Boolean)
      .slice(0, MAX_RECENT);
  }

  function patchFormData(fd) {
    const project = getProjectFromFormData(fd);
    const selectedIds = getSelectedIds(project);

    if (!selectedIds.length) return;

    const bundle = loadHistory(); 

    for (const key of ["candidatesJson", "candidates", "mediaManifestJson"]) {
      const raw = fd.get(key);
      if (!raw || typeof raw !== "string") continue;

      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || !parsed.length) continue;

        const reordered = reorder(parsed, selectedIds, bundle.history);
        fd.set(key, JSON.stringify(reordered));

        if (key === "mediaManifestJson") {
          recordUsage(bundle.history, reordered.slice(0, 20)); 
        }
      } catch (e) {
        console.warn("priority reorder", e);
      }
    }

    saveHistory(bundle);
  }

  const previousFetch = window.fetch.bind(window);

  window.fetch = function patchedFetch(resource, options = {}) {
    try {
      const url = typeof resource === "string" ? resource : resource?.url || "";
      const body = options?.body;

      if (
        body instanceof FormData &&
        (url.includes("/api/project/prepare") ||
         url.includes("/api/montage/plan") ||
         url.includes("/api/render/video"))
      ) {
        patchFormData(body);
      }
    } catch (error) {
      console.warn("selection-priority-diversity-fix", error);
    }

    return previousFetch(resource, options);
  };

  console.log("Correctif priorité absolue des médias sélectionnés actif");
})();
