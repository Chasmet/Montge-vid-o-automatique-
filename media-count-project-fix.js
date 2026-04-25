/* V18.4 - Timeline dynamique jusqu'à 5 minutes.
   Objectif : changer régulièrement de média, même à 1 minute, sans dépasser Render. */
(function () {
  const VERSION = "V18.4";
  const RULES = [[30,6],[60,10],[90,14],[120,16],[150,18],[180,20],[210,22],[240,24],[270,26],[300,28]];

  function n(v, f = 0) {
    const x = Number(v);
    return Number.isFinite(x) ? x : f;
  }

  function wantedCount(seconds) {
    const d = Math.max(0, n(seconds, 0));
    for (const [max, count] of RULES) {
      if (d <= max) return count;
    }
    return 28;
  }

  function durationFromFormData(fd) {
    const start = n(fd.get("audioStartSec"), 0);
    const end = n(fd.get("audioEndSec"), 0);
    const target = n(fd.get("targetDurationSec"), 30);
    if (end > start) return Math.min(end - start, target || end - start);
    return target || 30;
  }

  function durationOfProject(project) {
    const c = project?.config || {};
    if (project?.type === "music") {
      const start = n(c.audioStart, 0);
      const end = n(c.audioEnd, 0);
      const target = n(c.targetDuration, 30);
      if (end > start) return Math.min(end - start, target || end - start);
      return target || 30;
    }
    return n(c.targetDuration, 30) || 30;
  }

  function shuffle(list) {
    const a = [...(Array.isArray(list) ? list : [])];
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function cleanIds(ids) {
    const out = [];
    const seen = new Set();
    for (const id of Array.isArray(ids) ? ids : []) {
      const v = String(id || "");
      if (!v || seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    return out;
  }

  function getAspect(project) {
    return project?.config?.aspectRatio || "vertical";
  }

  function sameOrientation(project, media) {
    try {
      return orientationMatches(getAspect(project), media?.orientation || "unknown");
    } catch {
      return true;
    }
  }

  function bucketName(project, mediaType) {
    try {
      return getBucketForProject(project.type, mediaType);
    } catch {
      return "";
    }
  }

  function makeTimeline(ids, total) {
    const list = (Array.isArray(ids) ? ids : []).map(id => String(id || "")).filter(Boolean);
    if (!list.length) return [];
    const safeTotal = Math.max(1, n(total, 30));
    const step = safeTotal / list.length;
    let t = 0;
    return list.map((id, i) => {
      const start = Number(t.toFixed(3));
      const end = i === list.length - 1 ? Number(safeTotal.toFixed(3)) : Number((t + step).toFixed(3));
      t = end;
      return {
        mediaId: id,
        start,
        end,
        transition: i % 4 === 0 ? "zoom-cut" : i % 3 === 0 ? "fade" : "cut",
        effect: i % 5 === 0 ? "cinematic" : i % 2 === 0 ? "rap-light" : "clean"
      };
    });
  }

  function mediaCandidate(media) {
    return {
      id: media.id,
      fileName: media.fileName,
      block: media.block,
      orientation: media.orientation,
      mediaType: media.mediaType,
      tags: Array.isArray(media.tags) ? media.tags : [],
      createdAt: media.createdAt || ""
    };
  }

  function findFileFieldName(fd) {
    if (!(fd instanceof FormData)) return "";
    for (const [key, value] of fd.entries()) {
      if (value instanceof Blob) return key;
    }
    for (const key of ["mediaFiles", "files", "videos", "media", "file"]) {
      if (fd.getAll(key).some(v => v instanceof Blob)) return key;
    }
    return "";
  }

  function projectForFormData(fd) {
    const title = String(fd.get("title") || "");
    const projects = Array.isArray(state.cache?.projects) ? state.cache.projects : [];
    const current = projects.find(p => p.id === state.currentResultId);
    if (current) return current;
    return projects.find(p => p.name === title) || projects.find(p => title && title.includes(p.name)) || null;
  }

  function pseudoProjectFromPrepare(fd) {
    return {
      id: "prepare",
      type: String(fd.get("projectType") || "music"),
      name: String(fd.get("title") || ""),
      config: {
        mode: String(fd.get("mode") || "video"),
        aspectRatio: String(fd.get("aspectRatio") || "vertical"),
        audioStart: n(fd.get("audioStartSec"), 0),
        audioEnd: n(fd.get("audioEndSec"), 0),
        targetDuration: n(fd.get("targetDurationSec"), 30),
        selectedMediaIds: []
      }
    };
  }

  function strictPool(project) {
    const c = project?.config || {};
    const mode = c.mode || "video";
    const bucket = bucketName(project, mode);
    return (state.cache.media || [])
      .filter(m => m?.blob)
      .filter(m => !bucket || m.bucket === bucket)
      .filter(m => m.mediaType === mode)
      .filter(m => sameOrientation(project, m));
  }

  function broadPools(project) {
    const all = (state.cache.media || []).filter(m => m?.blob).filter(m => sameOrientation(project, m));
    const videoBucket = bucketName(project, "video");
    const imageBucket = bucketName(project, "image");
    return [
      strictPool(project),
      all.filter(m => m.bucket === videoBucket && m.mediaType === "video"),
      all.filter(m => m.mediaType === "video"),
      all.filter(m => m.bucket === imageBucket && m.mediaType === "image"),
      all.filter(m => m.mediaType === "image")
    ];
  }

  function addUnique(out, pool, used, wanted) {
    for (const media of shuffle(pool)) {
      const id = String(media?.id || "");
      if (!id || used.has(id)) continue;
      out.push(media);
      used.add(id);
      if (out.length >= wanted) return true;
    }
    return out.length >= wanted;
  }

  function chooseRenderMedias(project, wanted) {
    const out = [];
    const used = new Set();
    const selected = cleanIds(project?.config?.selectedMediaIds || project?.config?.montagePlan?.selectedMediaIds || []);
    const all = (state.cache.media || []).filter(m => m?.blob).filter(m => sameOrientation(project, m));

    for (const id of selected) {
      const media = all.find(m => String(m.id) === String(id));
      if (!media || used.has(String(media.id))) continue;
      out.push(media);
      used.add(String(media.id));
      if (out.length >= wanted) return out.slice(0, wanted);
    }

    for (const pool of broadPools(project)) {
      if (addUnique(out, pool, used, wanted)) return out.slice(0, wanted);
    }

    const base = out.length ? out : shuffle(all);
    const expanded = [...base];
    let i = 0;
    while (expanded.length < wanted && base.length) {
      expanded.push(base[i % base.length]);
      i += 1;
    }
    return expanded.slice(0, wanted);
  }

  function patchPrepareCandidates(fd) {
    const project = pseudoProjectFromPrepare(fd);
    if (project.type !== "music") return;

    const duration = durationFromFormData(fd);
    const wanted = wantedCount(duration);
    const medias = chooseRenderMedias(project, wanted);
    const candidates = medias.map(mediaCandidate);

    if (!candidates.length) return;
    fd.set("candidatesJson", JSON.stringify(candidates));
    fd.set("wantedMediaCount", String(wanted));
    fd.set("forceWantedMediaCount", "true");
    fd.set("timelineRule", VERSION);
    console.log(`Préparation médias ${VERSION} : ${candidates.length}/${wanted} candidats pour ${duration}s.`);
  }

  function patchRenderFormData(fd) {
    const project = projectForFormData(fd);
    if (!project) return;

    const duration = durationFromFormData(fd) || durationOfProject(project);
    const wanted = wantedCount(duration);
    const fileField = findFileFieldName(fd);
    const existingUploads = fileField ? fd.getAll(fileField).filter(v => v instanceof Blob).length : 0;
    const medias = chooseRenderMedias(project, wanted);
    if (!medias.length) return;

    const manifest = [];
    const sourceCount = new Map();

    for (let i = 0; i < wanted; i += 1) {
      const media = medias[i % medias.length];
      const baseId = String(media.id || `media_${i}`);
      const count = (sourceCount.get(baseId) || 0) + 1;
      sourceCount.set(baseId, count);
      const renderId = count === 1 ? baseId : `${baseId}__loop_${count}`;
      const ext = String(media.fileName || "").split(".").pop() || (media.mediaType === "image" ? "png" : "mp4");
      const safeName = media.fileName || `${baseId}.${ext}`;
      const uploadName = `${media.mediaType === "image" ? "image" : "video"}_${String(i + 1).padStart(2, "0")}_${safeName}`;

      if (fileField && existingUploads < wanted && i >= existingUploads && media.blob) {
        fd.append(fileField, media.blob, uploadName);
      }

      manifest.push({
        id: renderId,
        sourceId: media.id,
        fileName: uploadName,
        originalFileName: safeName,
        mediaType: media.mediaType,
        block: media.block || "Vrac",
        looped: count > 1
      });
    }

    const finalIds = manifest.map(m => m.id).filter(Boolean);
    const uniqueSources = new Set(manifest.map(m => String(m.sourceId || m.id))).size;

    fd.set("mediaManifestJson", JSON.stringify(manifest));
    fd.set("timelineJson", JSON.stringify(makeTimeline(finalIds, duration)));
    fd.set("wantedMediaCount", String(wanted));
    fd.set("forceWantedMediaCount", "true");
    fd.set("forceFullDuration", "true");
    fd.set("renderDurationSec", String(duration));
    fd.set("timelineRule", VERSION);

    console.log(`Timeline ${VERSION} : durée=${duration}s, médias=${wanted}, changement=${(duration / wanted).toFixed(1)}s, champ=${fileField || "aucun"}, uploads=${existingUploads}, uniques=${uniqueSources}.`);
  }

  async function improveProject(project) {
    if (!project || project.type !== "music") return false;
    const duration = durationOfProject(project);
    const wanted = wantedCount(duration);
    const current = cleanIds(project.config?.selectedMediaIds || []);
    if (current.length >= wanted) return false;

    const ids = cleanIds(chooseRenderMedias(project, wanted).map(m => m.id));
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
          transitionStyle: project.config?.montagePlan?.transitionStyle || "fade",
          effectStyle: project.config?.montagePlan?.effectStyle || "clean",
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
      console.warn("media-count-project-fix", e);
    } finally {
      busy = false;
    }
  }, 2500);

  const previousFetch = window.fetch.bind(window);
  window.fetch = function patchedMediaCountFetch(resource, options = {}) {
    try {
      const url = typeof resource === "string" ? resource : resource?.url || "";
      if (url.includes("/api/project/prepare") && options.body instanceof FormData) {
        patchPrepareCandidates(options.body);
      }
      if (url.includes("/api/render/video") && options.body instanceof FormData) {
        patchRenderFormData(options.body);
      }
    } catch (e) {
      console.warn("media count send fix", e);
    }
    return previousFetch(resource, options);
  };

  window.getSmartMediaCount = wantedCount;
  console.log(`Timeline médias ${VERSION} active jusqu'à 5 minutes.`);
})();
