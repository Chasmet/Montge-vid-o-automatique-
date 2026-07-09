(() => {
  const APK = () => typeof window.MontageAndroid !== "undefined";
  let realRenderProjectVideo = null;
  let running = false;

  function toast(message) {
    try { window.MontageAndroid?.toast?.(message); } catch {}
    try { showToast(message); } catch {}
  }

  function haptic(kind = "soft") {
    try { window.MontageAndroid?.haptic?.(kind); } catch {}
  }

  function clean(value) {
    return String(value || "").trim();
  }

  function normalize(value) {
    return clean(value)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function blockNameFromFolder(folderPath) {
    const parts = clean(folderPath).split(/[\\/]+/).map((p) => p.trim()).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : "Vrac";
  }

  function targetBlock(project) {
    return clean(
      project?.config?.primaryBlock ||
      state?.temp?.musicDraft?.primaryBlock ||
      state?.libraryBlockFilter ||
      ""
    );
  }

  function base64ToFile(base64, name, mimeType) {
    const binary = atob(base64);
    const chunkSize = 1024 * 1024;
    const chunks = [];

    for (let offset = 0; offset < binary.length; offset += chunkSize) {
      const slice = binary.slice(offset, offset + chunkSize);
      const bytes = new Uint8Array(slice.length);
      for (let i = 0; i < slice.length; i++) bytes[i] = slice.charCodeAt(i);
      chunks.push(bytes);
    }

    return new File(chunks, name || "media-gestionnaire", {
      type: mimeType || "application/octet-stream"
    });
  }

  function listGestionnaireFiles() {
    try {
      if (typeof GestionnaireLibrary === "undefined") return [];
      return JSON.parse(GestionnaireLibrary.listFilesJson() || "[]");
    } catch {
      return [];
    }
  }

  function groupedFiles(files) {
    const groups = new Map();
    for (const file of files || []) {
      const folderPath = clean(file.folderPath || "Vrac") || "Vrac";
      if (!groups.has(folderPath)) groups.set(folderPath, []);
      groups.get(folderPath).push(file);
    }
    return [...groups.entries()].map(([folderPath, items]) => ({
      folderPath,
      name: blockNameFromFolder(folderPath),
      items
    }));
  }

  function findFolderForProject(project, files) {
    const groups = groupedFiles(files).filter((group) => group.items.some((file) => String(file.mimeType || "").startsWith(`${project.config?.mode || "video"}/`)));
    if (!groups.length) return null;

    const wanted = normalize(targetBlock(project));
    if (wanted) {
      const exact = groups.find((group) => normalize(group.name) === wanted || normalize(group.folderPath) === wanted);
      if (exact) return exact;

      const contains = groups.find((group) => normalize(group.name).includes(wanted) || normalize(group.folderPath).includes(wanted) || wanted.includes(normalize(group.name)));
      if (contains) return contains;
    }

    const selectedIds = new Set(project?.config?.selectedMediaIds || []);
    const fromExisting = groups.find((group) => group.items.some((file) => selectedIds.has(file.id) || selectedIds.has(file.uri)));
    if (fromExisting) return fromExisting;

    return groups.sort((a, b) => b.items.length - a.items.length)[0];
  }

  function visualFilesForProject(project, folder) {
    const mode = project?.config?.mode || "video";
    return (folder?.items || [])
      .filter((file) => String(file.mimeType || "").startsWith(`${mode}/`))
      .slice(0, Math.max(6, Math.min(14, Number(project?.config?.targetDuration || 30) <= 30 ? 8 : 12)));
  }

  async function loadGestionnaireMediaForProject(project) {
    if (!APK() || typeof GestionnaireLibrary === "undefined") return [];

    const files = listGestionnaireFiles();
    if (!files.length) return [];

    const folder = findFolderForProject(project, files);
    const chosen = visualFilesForProject(project, folder);
    if (!chosen.length) return [];

    const block = folder?.name || targetBlock(project) || "Vrac";
    const mode = project?.config?.mode || "video";
    const bucket = typeof getBucketForProject === "function" ? getBucketForProject(project.type || "music", mode) : `${project.type || "music"}-${mode}`;
    const loaded = [];

    for (const info of chosen) {
      const key = `${block}::${info.relativePath || info.uri || info.name}`;
      let existing = (state.cache.media || []).find((item) => item.gestionnaireKey === key || item.sourceKey === key);
      if (!existing) {
        const base64 = GestionnaireLibrary.readFileBase64(info.uri);
        if (!base64) continue;
        const file = base64ToFile(base64, info.name, info.mimeType);
        existing = {
          id: `apk_gestion_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          owner: state.profile || project.owner || "admin",
          bucket,
          mediaType: mode,
          fileName: file.name,
          mimeType: file.type || info.mimeType || `${mode}/*`,
          size: file.size || Number(info.size || 0),
          createdAt: new Date().toISOString(),
          block,
          orientation: project?.config?.aspectRatio || "vertical",
          tags: ["gestionnaire", "apk", block],
          temporary: true,
          sourceApp: "gestionnaire",
          sourceKey: key,
          gestionnaireKey: key,
          relativePath: info.relativePath || "",
          blob: file
        };
        state.cache.media.unshift(existing);
      }
      loaded.push(existing);
    }

    return loaded;
  }

  function makeTimeline(mediaIds, durationSec, mode = "video") {
    const ids = mediaIds.filter(Boolean);
    const total = Math.max(1, Number(durationSec || 30));
    const each = total / Math.max(1, ids.length);
    let cursor = 0;
    return ids.map((id, index) => {
      const start = Number(cursor.toFixed(3));
      const end = index === ids.length - 1 ? Number(total.toFixed(3)) : Number((cursor + each).toFixed(3));
      cursor = end;
      return { mediaId: id, start, end, transition: "fade", effect: mode === "image" ? "zoom" : "clean" };
    });
  }

  async function prepareProjectBeforeRender(projectId) {
    const project = state.cache.projects.find((p) => p.id === projectId);
    if (!project) return null;

    const selectedIds = Array.isArray(project.config?.selectedMediaIds) ? project.config.selectedMediaIds : [];
    const existingSelected = selectedIds
      .map((id) => state.cache.media.find((media) => media.id === id && media.blob))
      .filter(Boolean);

    if (existingSelected.length) return project;

    toast("APK : récupération des médias depuis Gestionnaire…");
    haptic("soft");

    const loaded = await loadGestionnaireMediaForProject(project);
    if (!loaded.length) {
      toast("Aucun média trouvé. Ouvre Gestionnaire puis importe le bloc avant le rendu.");
      return project;
    }

    const ids = loaded.map((item) => item.id);
    const duration = Number(project.config?.targetDuration || 30);
    const nextProject = {
      ...project,
      updatedAt: new Date().toISOString(),
      config: {
        ...project.config,
        primaryBlock: loaded[0]?.block || project.config?.primaryBlock || "Vrac",
        allowedBlocks: Array.from(new Set([...(project.config?.allowedBlocks || []), loaded[0]?.block || "Vrac"])),
        selectedMediaIds: ids,
        montagePlan: {
          ...(project.config?.montagePlan || {}),
          transitionStyle: project.config?.montagePlan?.transitionStyle || "fade",
          effectStyle: project.config?.montagePlan?.effectStyle || "clean",
          selectedMediaIds: ids,
          timeline: makeTimeline(ids, duration, project.config?.mode || "video")
        }
      }
    };

    const index = state.cache.projects.findIndex((p) => p.id === project.id);
    if (index >= 0) state.cache.projects[index] = nextProject;

    try { await projectPut(nextProject); } catch {}
    toast(`${ids.length} média${ids.length > 1 ? "s" : ""} récupéré${ids.length > 1 ? "s" : ""}. Lancement du rendu…`);
    return nextProject;
  }

  async function robustRender(projectId) {
    if (running) return;
    running = true;
    try {
      await prepareProjectBeforeRender(projectId);
      if (typeof realRenderProjectVideo === "function") {
        await realRenderProjectVideo(projectId);
      } else if (typeof window.renderProjectVideo === "function") {
        await window.renderProjectVideo(projectId);
      }
    } finally {
      running = false;
    }
  }

  function install() {
    if (!APK() || !window.state) return;
    if (!realRenderProjectVideo && typeof window.renderProjectVideo === "function") {
      realRenderProjectVideo = window.renderProjectVideo;
    }
  }

  document.addEventListener("click", (event) => {
    if (!APK()) return;
    const button = event.target.closest('[data-action="render-project-video"]');
    if (!button) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    install();
    robustRender(button.dataset.id).catch((error) => {
      console.error(error);
      toast(error?.message || "Erreur rendu APK.");
    });
  }, true);

  setInterval(install, 500);
  setTimeout(install, 800);
})();
