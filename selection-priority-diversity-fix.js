/* Correctif pilotage auto :
   - garde les médias choisis en premier
   - augmente la diversité entre les vidéos
   - mémorise l'usage pour réduire les répétitions */
(function () {
  const STORAGE_KEY = "chk_selection_diversity_history_v1";
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
    return String(
      item.id ||
      item.sourceId ||
      item.mediaId ||
      item.renderId ||
      item.fileName ||
      ""
    ).trim();
  }

  function itemBlock(item) {
    if (item == null || typeof item !== "object") return "";
    return String(
      item.block ||
      item.collection ||
      item.category ||
      item.group ||
      item.mediaType ||
      "Vrac"
    ).toLowerCase();
  }

  function getProjectFromFormData(fd) {
    try {
      const title = String(fd.get("title") || "").trim();
      const projects = Array.isArray(window.state?.cache?.projects)
        ? window.state.cache.projects
        : [];
      const current = projects.find(
        (project) => project.id === window.state?.currentResultId
      );
      if (current) return current;
      return (
        projects.find((project) => project.name === title) ||
        projects.find(
          (project) => title && project.name && title.includes(project.name)
        ) ||
        null
      );
    } catch {
      return null;
    }
  }

  function getSelectedIds(project) {
    return cleanIds(
      project?.config?.selectedMediaIds ||
      project?.config?.montagePlan?.selectedMediaIds ||
      []
    );
  }

  function getWantedCount(fd) {
    const start = num(fd.get("audioStartSec"), 0);
    const end = num(fd.get("audioEndSec"), 0);
    const target = num(fd.get("targetDurationSec"), 30);

    if (end > start) {
      return Math.max(
        1,
        Math.floor(Math.min(end - start, target || end - start))
      );
    }

    return Math.max(1, Math.floor(target || 30));
  }

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveStore(store) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {}
  }

  function profileKey() {
    return String(window.state?.profile || "global");
  }

  function getHistory() {
    const store = loadStore();
    const key = profileKey();

    if (!store[key] || typeof store[key] !== "object") {
      store[key] = {
        media: {},
        recentIds: [],
        recentBlocks: []
      };
    }

    return store;
  }

  function syncStateHistory(history) {
    try {
      if (!window.state?.temp) return;

      window.state.temp.musicUsageHistory = {
        recentProjects: Array.isArray(
          window.state.temp.musicUsageHistory?.recentProjects
        )
          ? window.state.temp.musicUsageHistory.recentProjects
          : [],
        recentFirstFour: Array.isArray(
          window.state.temp.musicUsageHistory?.recentFirstFour
        )
          ? window.state.temp.musicUsageHistory.recentFirstFour
          : [],
        statsByMediaId: history.media || {}
      };
    } catch {}
  }

  function usageScore(item, history) {
    const id = itemId(item);
    const stats = history.media?.[id] || {};

    const usedCount = num(stats.usedCount, 0);
    const firstFourCount = num(stats.firstFourCount, 0);

    const lastUsedAt = stats.lastUsedAt
      ? Date.parse(stats.lastUsedAt)
      : 0;

    const ageHours = lastUsedAt
      ? Math.max(0, (Date.now() - lastUsedAt) / 36e5)
      : 1e6;

    const recentIndex = (history.recentIds || []).indexOf(id);
    const blockIndex = (history.recentBlocks || []).indexOf(itemBlock(item));

    const recentPenalty =
      recentIndex >= 0 ? Math.max(0, 12 - recentIndex) : 0;

    const blockPenalty =
      blockIndex >= 0 ? Math.max(0, 6 - blockIndex) : 0;

    return (
      usedCount * 20 +
      firstFourCount * 40 +
      recentPenalty * 12 +
      blockPenalty * 6 +
      (ageHours > 0 ? 8 / Math.log10(ageHours + 10) : 8) +
      Math.random() * 0.001
    );
  }

  function uniqueById(items) {
    const out = [];
    const seen = new Set();

    for (const item of Array.isArray(items) ? items : []) {
      const id = itemId(item);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(item);
    }

    return out;
  }

  function reorderDiverse(items, wantedCount, selectedIds, history) {
    const normalized = uniqueById(items);

    const byId = new Map();
    for (const item of normalized) {
      const id = itemId(item);
      if (id && !byId.has(id)) {
        byId.set(id, item);
      }
    }

    const orderedSelected = [];
    const selectedSet = new Set(selectedIds);

    for (const id of selectedIds) {
      const item = byId.get(String(id));
      if (item) orderedSelected.push(item);
    }

    const rest = normalized.filter(
      (item) => !selectedSet.has(itemId(item))
    );

    const rankedRest = [...rest].sort(
      (a, b) => usageScore(a, history) - usageScore(b, history)
    );

    const out = [...orderedSelected];
    const usedIds = new Set(out.map(itemId));
    const usedBlocks = new Set(
      out.map(itemBlock).filter(Boolean)
    );

    for (const item of rankedRest) {
      if (out.length >= wantedCount) break;

      const id = itemId(item);
      if (!id || usedIds.has(id)) continue;

      const block = itemBlock(item);

      if (
        block &&
        usedBlocks.has(block) &&
        usedBlocks.size < wantedCount
      ) {
        continue;
      }

      out.push(item);
      usedIds.add(id);

      if (block) usedBlocks.add(block);
    }

    for (const item of rankedRest) {
      if (out.length >= wantedCount) break;

      const id = itemId(item);
      if (!id || usedIds.has(id)) continue;

      out.push(item);
      usedIds.add(id);
    }

    return out.slice(0, wantedCount);
  }

  function recordUsage(history, items) {
    if (!history.media) history.media = {};
    if (!Array.isArray(history.recentIds)) history.recentIds = [];
    if (!Array.isArray(history.recentBlocks)) history.recentBlocks = [];

    const ids = cleanIds(
      (Array.isArray(items) ? items : []).map(itemId)
    );

    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index];
      const item = Array.isArray(items)
        ? items.find((entry) => itemId(entry) === id)
        : null;

      const block = itemBlock(item);
      const current = history.media[id] || {};

      history.media[id] = {
        usedCount: num(current.usedCount, 0) + 1,
        firstFourCount:
          num(current.firstFourCount, 0) + (index < 4 ? 1 : 0),
        lastUsedAt: new Date().toISOString(),
        block
      };
    }

    history.recentIds = [
      ...ids,
      ...(history.recentIds || [])
    ]
      .filter(Boolean)
      .slice(0, MAX_RECENT);

    const blocks = items.map(itemBlock).filter(Boolean);

    history.recentBlocks = [
      ...blocks,
      ...(history.recentBlocks || [])
    ]
      .filter(Boolean)
      .slice(0, MAX_RECENT);
  }

  function persist(history) {
    const store = loadStore();
    store[profileKey()] = history;
    saveStore(store);
    syncStateHistory(history);
  }

  function patchFormData(fd) {
    const project = getProjectFromFormData(fd);
    const selectedIds = getSelectedIds(project);
    const wanted = getWantedCount(fd);

    const store = getHistory();
    const history = store[profileKey()];

    for (const key of [
      "candidatesJson",
      "candidates",
      "mediaManifestJson"
    ]) {
      const raw = fd.get(key);
      if (!raw || typeof raw !== "string") continue;

      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || !parsed.length) continue;

        const reordered = reorderDiverse(
          parsed,
          Math.min(wanted, parsed.length),
          selectedIds,
          history
        );

        fd.set(key, JSON.stringify(reordered));

        if (key === "mediaManifestJson") {
          recordUsage(history, reordered);
        }
      } catch {}
    }

    fd.set("wantedMediaCount", String(wanted));
    persist(history);
  }

  const previousFetch = window.fetch.bind(window);

  window.fetch = function patchedFetch(resource, options = {}) {
    try {
      const url =
        typeof resource === "string"
          ? resource
          : resource?.url || "";

      const body = options?.body;

      if (
        body instanceof FormData &&
        (
          url.includes("/api/project/prepare") ||
          url.includes("/api/montage/plan") ||
          url.includes("/api/render/video")
        )
      ) {
        patchFormData(body);
      }
    } catch (error) {
      console.warn("selection-priority-diversity-fix", error);
    }

    return previousFetch(resource, options);
  };

  console.log("Correctif priorité manuelle + diversité actif");
})();
