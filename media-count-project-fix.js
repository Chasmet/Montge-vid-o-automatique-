/* Ajuste automatiquement le nombre de médias sauvegardés, préparés ET envoyés au rendu.
   Correctif V16 : si le serveur garde une logique interne à 20 segments,
   l'application répète proprement les médias disponibles au rendu pour couvrir toute la durée. */
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
    const list = (Array.isArray(ids) ? ids : []).map(id => String(id || '')).filter(Boolean);
    if (!list.length) return [];
    const safeTotal = Math.max(1, n(total, 30));
    const step = safeTotal / list.length;
    let t = 0;
    return list.map((id, i) => {
      const start = Number(t.toFixed(3));
      const end = i === list.length - 1 ? Number(safeTotal.toFixed(3)) : Number((t + step).toFixed(3));
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

  function pseudoProjectFromPrepare(fd) {
    return {
      id: 'prepare',
      type: String(fd.get('projectType') || 'music'),
      name: String(fd.get('title') || ''),
      config: {
        mode: String(fd.get('mode') || 'video'),
        aspectRatio: String(fd.get('aspectRatio') || 'vertical'),
        audioStart: n(fd.get('audioStartSec'), 0),
        audioEnd: n(fd.get('audioEndSec'), 0),
        targetDuration: n(fd.get('targetDurationSec'), 30),
        selectedMediaIds: []
      }
    };
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

  function chooseRenderMediaLoop(project, wanted) {
    const pool = mediaPool(project).filter(m => m?.blob);
    if (!pool.length) return [];

    const uniqueIds = chooseIds(project, wanted);
    const ordered = [];
    const used = new Set();

    for (const id of uniqueIds) {
      const media = pool.find(m => String(m.id) === String(id));
      if (!media || used.has(String(media.id))) continue;
      ordered.push(media);
      used.add(String(media.id));
      if (ordered.length >= wanted) return ordered;
    }

    for (const media of shuffle(pool)) {
      if (!media?.id || used.has(String(media.id))) continue;
      ordered.push(media);
      used.add(String(media.id));
      if (ordered.length >= wanted) return ordered;
    }

    const base = ordered.length ? ordered : shuffle(pool);
    const expanded = [...base];
    let i = 0;
    while (expanded.length < wanted && base.length) {
      expanded.push(base[i % base.length]);
      i += 1;
    }

    return expanded.slice(0, wanted);
  }

  function mediaCandidate(media) {
    return {
      id: media.id,
      fileName: media.fileName,
      block: media.block,
      orientation: media.orientation,
      mediaType: media.mediaType,
      tags: Array.isArray(media.tags) ? media.tags : [],
      createdAt: media.createdAt || ''
    };
  }

  function patchPrepareCandidates(fd) {
    if (!(fd instanceof FormData)) return;
    const project = pseudoProjectFromPrepare(fd);
    if (project.type !== 'music') return;

    const duration = durationFromFormData(fd) || 30;
    const wanted = wantedCount(duration);
    const ids = chooseIds(project, wanted);
    if (!ids.length) return;

    const candidates = ids
      .map(id => (state.cache.media || []).find(m => String(m.id) === String(id)))
      .filter(Boolean)
      .map(mediaCandidate);

    if (candidates.length) {
      fd.set('candidatesJson', JSON.stringify(candidates));
      fd.set('wantedMediaCount', String(wanted));
      fd.set('forceWantedMediaCount', 'true');
      console.log(`Préparation corrigée : ${candidates.length} candidats envoyés, objectif serveur ${wanted}.`);
    }
  }

  function projectForRenderFormData(fd) {
    const title = String(fd.get('title') || '');
    const candidates = Array.isArray(state.cache?.projects) ? state.cache.projects : [];
    const current = candidates.find(p => p.id === state.currentResultId);
    if (current) return current;
    return candidates.find(p => p.name === title) || candidates.find(p => title && title.includes(p.name)) || null;
  }

  function parseManifest(fd) {
    try {
      const parsed = JSON.parse(fd.get('mediaManifestJson') || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function appendMissingRenderMedia(fd) {
    if (!(fd instanceof FormData)) return;

    const project = projectForRenderFormData(fd);
    if (!project) return;

    const duration = durationFromFormData(fd) || durationOfProject(project);
    const wanted = wantedCount(duration);
    const renderMedias = chooseRenderMediaLoop(project, wanted);
    if (!renderMedias.length) return;

    let manifest = parseManifest(fd);
    const currentCount = manifest.length;
    const existingUploads = fd.getAll('media').length;

    if (currentCount >= wanted && existingUploads >= wanted) {
      fd.set('timelineJson', JSON.stringify(makeTimeline(manifest.map(m => m.id), duration)));
      fd.set('wantedMediaCount', String(wanted));
      fd.set('forceWantedMediaCount', 'true');
      fd.set('forceFullDuration', 'true');
      console.log(`Rendu déjà complet : ${currentCount}/${wanted} médias.`);
      return;
    }

    const alreadyIds = new Set(manifest.map(m => String(m.id || '')));
    let uploadIndex = existingUploads;

    for (let i = currentCount; i < wanted; i += 1) {
      const media = renderMedias[i % renderMedias.length];
      if (!media?.blob) continue;

      const baseId = String(media.id || `media_${i}`);
      let renderId = baseId;
      if (alreadyIds.has(renderId)) {
        renderId = `${baseId}__loop_${i + 1}`;
      }
      while (alreadyIds.has(renderId)) {
        renderId = `${baseId}__loop_${i + 1}_${Math.random().toString(36).slice(2, 6)}`;
      }

      const ext = String(media.fileName || '').split('.').pop() || (media.mediaType === 'image' ? 'png' : 'mp4');
      const safeName = media.fileName || `${baseId}.${ext}`;
      const uploadName = `loop_${String(i + 1).padStart(2, '0')}_${safeName}`;

      fd.append('media', media.blob, uploadName);
      manifest.push({
        id: renderId,
        sourceId: media.id,
        fileName: uploadName,
        originalFileName: media.fileName || uploadName,
        mediaType: media.mediaType,
        block: media.block || 'Vrac',
        looped: renderId !== baseId
      });
      alreadyIds.add(renderId);
      uploadIndex += 1;
    }

    const finalIds = manifest.map(m => m.id).filter(Boolean);
    fd.set('mediaManifestJson', JSON.stringify(manifest));
    fd.set('timelineJson', JSON.stringify(makeTimeline(finalIds, duration)));
    fd.set('wantedMediaCount', String(wanted));
    fd.set('forceWantedMediaCount', 'true');
    fd.set('forceFullDuration', 'true');
    fd.set('renderDurationSec', String(duration));

    console.log(`Rendu corrigé V16 : uploads=${uploadIndex}, manifest=${manifest.length}, objectif=${wanted}, durée=${duration}s.`);
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
  window.fetch = function patchedMediaCountFetch(resource, options = {}) {
    try {
      const url = typeof resource === 'string' ? resource : resource?.url || '';
      if (url.includes('/api/project/prepare') && options.body instanceof FormData) {
        patchPrepareCandidates(options.body);
      }
      if (url.includes('/api/render/video') && options.body instanceof FormData) {
        appendMissingRenderMedia(options.body);
      }
    } catch (e) {
      console.warn('media count send fix', e);
    }
    return previousFetch(resource, options);
  };

  window.getSmartMediaCount = wantedCount;
  console.log('Ajustement préparation + rendu médias V16 actif');
})();
