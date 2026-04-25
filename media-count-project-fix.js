/* Ajuste automatiquement le nombre de médias sauvegardés ET envoyés au rendu. */
(function () {
  const RULES = [[30,6],[60,12],[90,15],[120,16],[150,18],[180,20],[210,22],[240,24],[270,26],[300,28]];

  function n(v, f = 0) {
    const x = Number(v);
    return Number.isFinite(x) ? x : f;
  }

  function wantedCount(seconds) {
    const d = Math.max(0, n(seconds, 0));
    for (const r of RULES) if (d <= r[0]) return r[1];
    return 28;
  }

  function durationOfProject(project) {
    const c = project.config || {};
    if (project.type === 'music') {
      const start = n(c.audioStart, 0);
      const end = n(c.audioEnd, 0);
      const target = n(c.targetDuration, 30);
      if (end > start) return Math.min(end - start, target || end - start);
      return target || 30;
    }
    return n(c.targetDuration, 30) || 30;
  }

  function durationFromFormData(fd) {
    const start = n(fd.get('audioStartSec'), 0);
    const end = n(fd.get('audioEndSec'), 0);
    const target = n(fd.get('targetDurationSec'), 30);
    if (end > start) return Math.min(end - start, target || end - start);
    return target || 30;
  }

  function shuffle(list) {
    const a = [...(Array.isArray(list) ? list : [])];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function cleanIds(ids) {
    const out = [];
    const seen = new Set();
    for (const id of Array.isArray(ids) ? ids : []) {
      const v = String(id || '');
      if (!v || seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    return out;
  }

  function makeTimeline(ids, total) {
    const list = cleanIds(ids);
    if (!list.length) return [];
    const step = Math.max(1, total) / list.length;
    let t = 0;
    return list.map((id, i) => {
      const start = Number(t.toFixed(3));
      const end = i === list.length - 1 ? Number(Math.max(1, total).toFixed(3)) : Number((t + step).toFixed(3));
      t = end;
      return { mediaId: id, start, end, transition: 'fade', effect: 'clean' };
    });
  }

  function mediaPool(project) {
    const c = project.config || {};
    const mode = c.mode || 'video';
    const aspect = c.aspectRatio || 'vertical';
    const bucket = getBucketForProject(project.type, mode);
    return (state.cache.media || [])
      .filter(m => m.bucket === bucket)
      .filter(m => m.mediaType === mode)
      .filter(m => orientationMatches(aspect, m.orientation || 'unknown'));
  }

  function chooseIds(project, wanted) {
    const pool = mediaPool(project);
    const existing = cleanIds(project.config?.selectedMediaIds || project.config?.montagePlan?.selectedMediaIds || []);
    const out = [];
    const used = new Set();
    const blocks = new Set();

    for (const id of existing) {
      if (!pool.some(m => String(m.id) === id)) continue;
      out.push(id);
      used.add(id);
      if (out.length >= wanted) return out;
    }

    for (const m of shuffle(pool)) {
      const id = String(m.id || '');
      const block = String(m.block || 'Vrac').toLowerCase();
      if (!id || used.has(id)) continue;
      if (blocks.has(block) && blocks.size < wanted) continue;
      out.push(id);
      used.add(id);
      blocks.add(block);
      if (out.length >= wanted) return out;
    }

    for (const m of shuffle(pool)) {
      const id = String(m.id || '');
      if (!id || used.has(id)) continue;
      out.push(id);
      used.add(id);
      if (out.length >= wanted) return out;
    }

    return out;
  }

  function projectForRenderFormData(fd) {
    const title = String(fd.get('title') || '');
    const candidates = Array.isArray(state.cache?.projects) ? state.cache.projects : [];
    const current = candidates.find(p => p.id === state.currentResultId);
    if (current) return current;
    return candidates.find(p => p.name === title) || candidates.find(p => title && title.includes(p.name)) || null;
  }

  function appendMissingRenderMedia(fd) {
    if (!(fd instanceof FormData)) return;

    const project = projectForRenderFormData(fd);
    if (!project) return;

    const duration = durationFromFormData(fd) || durationOfProject(project);
    const wanted = wantedCount(duration);
    const desiredIds = chooseIds(project, wanted);
    if (!desiredIds.length) return;

    let manifest = [];
    try {
      manifest = JSON.parse(fd.get('mediaManifestJson') || '[]');
    } catch {
      manifest = [];
    }

    const already = new Set((Array.isArray(manifest) ? manifest : []).map(m => String(m.id || '')));
    let added = 0;

    for (const id of desiredIds) {
      if (already.has(String(id))) continue;
      const media = (state.cache.media || []).find(m => String(m.id) === String(id));
      if (!media?.blob) continue;
      fd.append('media', media.blob, media.fileName || `${id}.mp4`);
      manifest.push({ id: media.id, fileName: media.fileName, mediaType: media.mediaType });
      already.add(String(id));
      added += 1;
    }

    if (added > 0) {
      fd.set('mediaManifestJson', JSON.stringify(manifest));
      fd.set('timelineJson', JSON.stringify(makeTimeline(manifest.map(m => m.id), duration)));
      fd.set('wantedMediaCount', String(wanted));
      console.log(`Rendu corrigé : ${manifest.length} médias envoyés au serveur.`);
    }
  }

  async function improveProject(project) {
    if (!project || project.type !== 'music') return false;
    const duration = durationOfProject(project);
    const wanted = wantedCount(duration);
    const current = cleanIds(project.config?.selectedMediaIds || []);
    if (current.length >= wanted) return false;

    const ids = chooseIds(project, wanted);
    if (ids.length <= current.length) return false;

    const next = {
      ...project,
      updatedAt: nowISO(),
      config: {
        ...project.config,
        selectedMediaIds: ids,
        montagePlan: {
          ...(project.config?.montagePlan || {}),
          selectedMediaIds: ids,
          transitionStyle: project.config?.montagePlan?.transitionStyle || 'fade',
          effectStyle: project.config?.montagePlan?.effectStyle || 'clean',
          timeline: makeTimeline(ids, duration)
        }
      }
    };

    await projectPut(next);
    const index = state.cache.projects.findIndex(p => p.id === project.id);
    if (index >= 0) state.cache.projects[index] = next;
    return true;
  }

  let busy = false;
  setInterval(async () => {
    if (busy) return;
    if (!state?.profile || !Array.isArray(state.cache?.projects)) return;
    busy = true;
    try {
      let changed = false;
      for (const project of state.cache.projects) {
        if (await improveProject(project)) changed = true;
      }
      if (changed) render();
    } catch (e) {
      console.warn('media-count-project-fix', e);
    } finally {
      busy = false;
    }
  }, 2500);

  const previousFetch = window.fetch.bind(window);
  window.fetch = function patchedRenderFetch(resource, options = {}) {
    try {
      const url = typeof resource === 'string' ? resource : resource?.url || '';
      if (url.includes('/api/render/video') && options.body instanceof FormData) {
        appendMissingRenderMedia(options.body);
      }
    } catch (e) {
      console.warn('render media send fix', e);
    }
    return previousFetch(resource, options);
  };

  window.getSmartMediaCount = wantedCount;
  console.log('Ajustement projets + envoi rendu médias actif');
})();
