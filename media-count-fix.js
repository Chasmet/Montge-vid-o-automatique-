/* Correctif nombre de médias - progression douce jusqu'à 5 min */
(function () {
  const rules = [
    [30, 6], [60, 12], [90, 15], [120, 16], [150, 18],
    [180, 20], [210, 22], [240, 24], [270, 26], [300, 28]
  ];

  function num(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function getSmartMediaCount(durationSec) {
    const duration = Math.max(0, num(durationSec, 0));
    for (const [max, count] of rules) {
      if (duration <= max) return count;
    }
    return 28;
  }

  function shuffle(list) {
    const copy = [...(Array.isArray(list) ? list : [])];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function diversify(list, wanted) {
    const source = shuffle(list).filter(Boolean);
    const target = Math.min(Math.max(1, wanted), source.length);
    const out = [];
    const usedIds = new Set();
    const usedBlocks = new Set();

    for (const item of source) {
      const id = String(item.id || '');
      const block = String(item.block || item.collection || item.category || 'Vrac').toLowerCase();
      if (!id || usedIds.has(id)) continue;
      if (usedBlocks.has(block) && usedBlocks.size < target) continue;
      out.push(item);
      usedIds.add(id);
      usedBlocks.add(block);
      if (out.length >= target) return out;
    }

    for (const item of source) {
      const id = String(item.id || '');
      if (!id || usedIds.has(id)) continue;
      out.push(item);
      usedIds.add(id);
      if (out.length >= target) return out;
    }

    return out;
  }

  function durationFromFormData(fd) {
    const start = num(fd.get('audioStartSec'), 0);
    const end = num(fd.get('audioEndSec'), 0);
    const target = num(fd.get('targetDurationSec'), 30);
    if (end > start) return Math.min(end - start, target || end - start);
    return target || 30;
  }

  function patchFormData(fd) {
    if (!(fd instanceof FormData)) return fd;
    const wanted = getSmartMediaCount(durationFromFormData(fd));
    fd.set('wantedMediaCount', String(wanted));

    for (const key of ['candidatesJson', 'candidates', 'mediaManifestJson']) {
      const raw = fd.get(key);
      if (!raw || typeof raw !== 'string') continue;
      try {
        const data = JSON.parse(raw);
        if (Array.isArray(data) && data.length > wanted) {
          fd.set(key, JSON.stringify(diversify(data, wanted)));
        }
      } catch {}
    }
    return fd;
  }

  window.getSmartMediaCount = getSmartMediaCount;
  window.getSmartMediaCountForDuration = getSmartMediaCount;

  const originalFetch = window.fetch.bind(window);
  window.fetch = function (resource, options = {}) {
    try {
      const url = typeof resource === 'string' ? resource : resource?.url || '';
      if ((url.includes('/api/project/prepare') || url.includes('/api/montage/plan')) && options.body instanceof FormData) {
        options.body = patchFormData(options.body);
      }
    } catch (e) {
      console.warn('media-count-fix', e);
    }
    return originalFetch(resource, options);
  };

  console.log('Correctif nombre de médias actif');
})();
