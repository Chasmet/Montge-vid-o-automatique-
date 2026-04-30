/* Amélioration netteté vidéo gratuite - V32 : Propre HD automatique, Ultra 1080p manuel */
(function () {
  const choiceKey = 'video_sharpness_choice_v1';
  const labels = { normal: 'Normal', propre: 'Propre HD automatique', ultra: 'Ultra net 1080p manuel' };
  const running = new Set();

  function ready() { try { return typeof state !== 'undefined' && typeof render === 'function'; } catch { return false; } }

  function getChoice() {
    try {
      const raw = localStorage.getItem(choiceKey);
      const parsed = raw ? JSON.parse(raw) : null;
      const mode = parsed?.mode || 'propre';
      return ['normal', 'propre', 'ultra'].includes(mode) ? mode : 'propre';
    } catch {
      return 'propre';
    }
  }

  function getAutoChoice() {
    const mode = getChoice();
    return mode === 'ultra' ? 'propre' : mode;
  }

  function saveChoice(mode) {
    try { localStorage.setItem(choiceKey, JSON.stringify({ mode })); } catch {}
  }

  function toast(message) { if (typeof showToast === 'function') showToast(message); else alert(message); }
  function activeProject() { if (!ready() || !state.currentResultId) return null; return (state.cache.projects || []).find(p => p.id === state.currentResultId) || null; }
  async function getMedia(id) { if (!id) return null; if (typeof mediaGetById === 'function') return await mediaGetById(id); return (state.cache.media || []).find(m => m.id === id) || null; }
  async function saveProject(project) { if (typeof projectPut !== 'function') throw new Error('Sauvegarde projet indisponible.'); await projectPut(project); if (typeof hydrateCache === 'function') await hydrateCache(); }

  function autoOptions(selected) {
    return `
      <option value="propre" ${selected === 'propre' ? 'selected' : ''}>Propre HD automatique</option>
      <option value="normal" ${selected === 'normal' ? 'selected' : ''}>Normal rapide</option>
    `;
  }

  function resultOptions(selected) {
    return `
      <option value="propre" ${selected === 'propre' ? 'selected' : ''}>Propre HD automatique</option>
      <option value="normal" ${selected === 'normal' ? 'selected' : ''}>Normal rapide</option>
      <option value="ultra" ${selected === 'ultra' ? 'selected' : ''}>Ultra net 1080p manuel</option>
    `;
  }

  function preBox() {
    const mode = getAutoChoice();
    return `
      <div class="result-box" id="videoQualityChoiceBox">
        <div class="result-box-head"><h3>✨ Netteté vidéo</h3></div>
        <p class="small-note">Par défaut, l’application applique automatiquement Propre HD après le rendu. Le mode Ultra net 1080p se lance manuellement sur l’écran résultat.</p>
        <label class="field"><span>Netteté automatique</span><select id="videoSharpnessBeforeRender">${autoOptions(mode)}</select></label>
        <p class="small-note">Mode automatique actuel : ${labels[mode] || mode}. Recommandé : Propre HD automatique.</p>
      </div>
    `;
  }

  function resultBox(project) {
    const mode = project?.config?.videoSharpnessMode || getChoice();
    const doneMode = project?.config?.enhancedVideoMode || '';
    const videoReady = !!project?.config?.finalVideoMediaId;
    const manualText = mode === 'ultra' ? 'Ultra 1080p est manuel : appuie sur le bouton pour l’appliquer.' : 'Propre HD s’applique automatiquement après le rendu.';
    return `
      <div class="result-box" id="videoQualityResultBox">
        <div class="result-box-head"><h3>✨ Netteté vidéo</h3></div>
        <p class="small-note">${doneMode ? `Vidéo améliorée : ${labels[doneMode] || doneMode}. Les sous-titres seront incrustés après.` : manualText}</p>
        <label class="field"><span>Qualité visuelle</span><select id="videoSharpnessResult">${resultOptions(mode)}</select></label>
        <div class="prompt-actions"><button type="button" class="primary-btn" data-action="enhance-video-now" ${videoReady ? '' : 'disabled'}>${mode === 'ultra' ? 'Appliquer Ultra 1080p' : 'Améliorer maintenant'}</button></div>
      </div>
    `;
  }

  function injectPreBox() {
    if (!ready()) return;
    if (!['musicProject', 'speechProject'].includes(state.route)) return;
    if (document.getElementById('videoQualityChoiceBox')) return;
    const sticky = document.querySelector('.sticky-actions');
    if (sticky) sticky.insertAdjacentHTML('beforebegin', preBox());
  }

  function injectResultBox() {
    if (!ready() || state.route !== 'result') return;
    const project = activeProject();
    if (!project || !['music', 'speech'].includes(project.type)) return;
    if (document.getElementById('videoQualityResultBox')) return;
    const target = document.getElementById('openaiSubtitlesBox') || [...document.querySelectorAll('.result-box')].pop();
    if (target) target.insertAdjacentHTML('afterend', resultBox(project));
  }

  async function patchProjectChoice(project) {
    if (!project) return null;
    const mode = getAutoChoice();
    const next = { ...project, config: { ...project.config, videoSharpnessMode: mode } };
    await saveProject(next);
    return next;
  }

  async function enhanceVideo(projectArg = null, forcedMode = '') {
    let project = projectArg || activeProject();
    if (!project) return null;
    const mode = forcedMode || project.config?.videoSharpnessMode || getChoice();
    if (mode === 'normal') return project;

    const sourceId = project.config?.cleanVideoMediaId || project.config?.originalFinalVideoMediaId || project.config?.finalVideoMediaId;
    const source = await getMedia(sourceId);
    if (!source?.blob) { toast('Vidéo source introuvable.'); return null; }

    const form = new FormData();
    form.append('video', source.blob, source.fileName || 'video.mp4');
    form.append('videoSharpnessMode', mode);
    form.append('aspectRatio', project.config?.aspectRatio || 'vertical');

    toast(`Amélioration ${labels[mode] || mode} en cours...`);
    const response = await fetch(`${BACKEND_BASE_URL}/api/video/enhance`, { method: 'POST', body: form });
    if (!response.ok) { let msg = 'Amélioration impossible.'; try { const data = await response.json(); msg = data?.error || msg; } catch {} throw new Error(msg); }

    const blob = await response.blob();
    const media = {
      id: typeof uid === 'function' ? uid('enhanced_video') : `enhanced_${Date.now()}`,
      owner: state.profile,
      bucket: 'project-video',
      mediaType: 'video',
      fileName: `${project.name.replace(/[^\w-]/g, '_')}_${mode}.mp4`,
      mimeType: 'video/mp4',
      size: blob.size || 0,
      createdAt: typeof nowISO === 'function' ? nowISO() : new Date().toISOString(),
      block: 'Vrac',
      orientation: project.config?.aspectRatio === 'horizontal' ? 'horizontal' : 'vertical',
      tags: ['netteté', mode, 'base-sous-titres'],
      blob
    };

    if (typeof mediaPut !== 'function') throw new Error('Sauvegarde vidéo indisponible.');
    await mediaPut(media);

    const cleanVideoId = project.config?.cleanVideoMediaId || project.config?.originalFinalVideoMediaId || project.config?.finalVideoMediaId;
    const next = {
      ...project,
      updatedAt: typeof nowISO === 'function' ? nowISO() : new Date().toISOString(),
      status: mode === 'ultra' ? 'Vidéo Ultra 1080p prête' : 'Vidéo Propre HD prête',
      config: {
        ...project.config,
        videoSharpnessMode: mode,
        cleanVideoMediaId,
        originalFinalVideoMediaId: cleanVideoId,
        enhancedVideoMediaId: media.id,
        enhancedVideoMode: mode,
        subtitleBaseVideoMediaId: media.id,
        finalVideoMediaId: media.id,
        subtitledVideoMediaId: null,
        subtitledStyle: null,
        subtitledSyncMode: null,
        renderStatus: 'done',
        renderError: ''
      }
    };

    await saveProject(next);
    state.currentResultId = next.id;
    if (typeof render === 'function') render();
    toast(mode === 'ultra' ? 'Ultra net 1080p prêt. Sous-titres ensuite.' : 'Propre HD automatique prêt. Sous-titres ensuite.');
    return next;
  }

  async function autoEnhanceIfReady() {
    if (!ready() || state.route !== 'result') return;
    let project = activeProject();
    if (!project || !['music', 'speech'].includes(project.type)) return;

    const mode = getAutoChoice();
    if (project.config?.videoSharpnessMode === 'ultra') return;
    if (project.config?.videoSharpnessMode !== mode) project = await patchProjectChoice(project);
    if (mode === 'normal') return;
    if (project.config?.renderStatus !== 'done') return;
    if (!project.config?.finalVideoMediaId) return;
    if (project.config?.enhancedVideoMediaId && project.config?.enhancedVideoMode === mode) return;

    const sourceId = project.config?.cleanVideoMediaId || project.config?.originalFinalVideoMediaId || project.config?.finalVideoMediaId;
    const key = `${project.id}_${sourceId}_${mode}`;
    if (running.has(key)) return;
    running.add(key);
    try { await enhanceVideo(project, mode); } catch (error) { console.error(error); toast(error.message || 'Erreur amélioration vidéo.'); }
  }

  document.addEventListener('change', async (event) => {
    const select = event.target.closest('#videoSharpnessBeforeRender, #videoSharpnessResult');
    if (!select) return;
    const chosen = select.value || 'propre';
    saveChoice(chosen);
    const project = activeProject();
    if (project && state.route === 'result') {
      await saveProject({ ...project, config: { ...project.config, videoSharpnessMode: chosen, enhancedVideoMediaId: null, enhancedVideoMode: null, subtitleBaseVideoMediaId: null, subtitledVideoMediaId: null } });
      if (typeof render === 'function') render();
    }
    toast(`Netteté : ${labels[chosen] || chosen}`);
  });

  document.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-action="enhance-video-now"]');
    if (!target) return;
    const project = activeProject();
    const mode = project?.config?.videoSharpnessMode || getChoice();
    try { await enhanceVideo(project, mode); } catch (error) { console.error(error); toast(error.message || 'Erreur amélioration vidéo.'); }
  });

  setInterval(() => { injectPreBox(); injectResultBox(); autoEnhanceIfReady(); }, 1100);
  console.log('Interface netteté vidéo active V32 : Propre HD auto, Ultra 1080p manuel.');
})();
