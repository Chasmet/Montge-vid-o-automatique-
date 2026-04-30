/* V33 - Sous-titres stables : phrase par phrase + incrustation Render réelle */
(function () {
  const choiceKey = 'openai_subtitle_style_choice_v3';
  let transcribeLock = false;
  let burnLock = false;

  const STYLE_LABELS = {
    rap: 'Rap / clip officiel',
    tiktok: 'TikTok dynamique',
    classic: 'Classique propre',
    cinema: 'Cinéma sombre'
  };

  function ready() {
    try { return typeof state !== 'undefined' && typeof render === 'function'; } catch { return false; }
  }

  function toast(message) {
    if (typeof showToast === 'function') showToast(message);
    else alert(message);
  }

  function clean(value) {
    return (value || '').toString().trim();
  }

  function activeProject() {
    if (!ready() || !state.currentResultId) return null;
    return (state.cache.projects || []).find((p) => p.id === state.currentResultId) || null;
  }

  async function getMedia(id) {
    if (!id) return null;
    if (typeof mediaGetById === 'function') return await mediaGetById(id);
    return (state.cache.media || []).find((m) => m.id === id) || null;
  }

  async function saveProject(project) {
    if (typeof projectPut !== 'function') throw new Error('Sauvegarde projet indisponible.');
    await projectPut(project);
    if (typeof hydrateCache === 'function') await hydrateCache();
  }

  function getChoice() {
    try {
      const raw = localStorage.getItem(choiceKey);
      const parsed = raw ? JSON.parse(raw) : null;
      return {
        enabled: parsed?.enabled !== false,
        style: parsed?.style || 'classic'
      };
    } catch {
      return { enabled: true, style: 'classic' };
    }
  }

  function saveChoice(choice) {
    try { localStorage.setItem(choiceKey, JSON.stringify(choice)); } catch {}
  }

  function setDraftChoice(kind, choice) {
    if (!ready()) return;
    const draft = kind === 'speech' ? state.temp?.speechDraft : state.temp?.musicDraft;
    if (!draft) return;
    draft.subtitlesEnabled = choice.enabled !== false;
    draft.subtitleStyle = choice.style || 'classic';
    draft.subtitleSyncMode = 'normal';
    draft.subtitleMode = 'auto';
  }

  function styleOptions(selected) {
    return `
      <option value="classic" ${selected === 'classic' ? 'selected' : ''}>Classique propre</option>
      <option value="rap" ${selected === 'rap' ? 'selected' : ''}>Rap / clip officiel</option>
      <option value="tiktok" ${selected === 'tiktok' ? 'selected' : ''}>TikTok dynamique</option>
      <option value="cinema" ${selected === 'cinema' ? 'selected' : ''}>Cinéma sombre</option>
    `;
  }

  function looksLikeSrt(text) {
    return /\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(text || '');
  }

  function getSrt(project) {
    const cfg = project?.config || {};
    if (looksLikeSrt(cfg.openAiSrt)) return cfg.openAiSrt;
    if (looksLikeSrt(cfg.srt)) return cfg.srt;
    if (looksLikeSrt(cfg.subtitles?.srt)) return cfg.subtitles.srt;
    return '';
  }

  function getAudioMediaId(project) {
    if (!project) return '';
    return project.type === 'speech' ? project.config?.generatedAudioMediaId : project.config?.audioMediaId;
  }

  function getBaseVideoId(project) {
    const cfg = project?.config || {};
    return cfg.subtitleBaseVideoMediaId || cfg.enhancedVideoMediaId || cfg.cleanVideoMediaId || cfg.originalFinalVideoMediaId || cfg.finalVideoMediaId || '';
  }

  function preGenerationBox(kind) {
    const choice = getChoice();
    return `
      <div class="result-box" id="openaiSubtitleChoiceBox">
        <div class="result-box-head"><h3>💬 Sous-titres vidéo</h3></div>
        <p class="small-note">Mode stable : phrase par phrase. Le mode mot par mot est désactivé temporairement pour ne pas casser la vidéo finale.</p>
        <div class="prompt-actions">
          <button type="button" class="${choice.enabled ? 'primary-btn' : 'secondary-btn'}" data-action="openai-set-subtitle-enabled" data-kind="${kind}" data-enabled="true">Avec sous-titres</button>
          <button type="button" class="${choice.enabled ? 'secondary-btn' : 'primary-btn'}" data-action="openai-set-subtitle-enabled" data-kind="${kind}" data-enabled="false">Sans sous-titres</button>
        </div>
        <label class="field"><span>Style des sous-titres</span><select id="subtitleStyleBeforeRender" data-kind="${kind}">${styleOptions(choice.style)}</select></label>
        <p class="small-note">Calage : Phrase par phrase stable.</p>
      </div>
    `;
  }

  function resultBox(project) {
    const choice = getChoice();
    const cfg = project?.config || {};
    const style = cfg.subtitleStyle || choice.style || 'classic';
    const hasSrt = !!getSrt(project);
    const videoReady = !!cfg.finalVideoMediaId;
    const done = !!cfg.subtitledVideoMediaId && cfg.finalVideoMediaId === cfg.subtitledVideoMediaId;

    return `
      <div class="result-box" id="openaiSubtitlesBox">
        <div class="result-box-head"><h3>💬 Sous-titres OpenAI stylés</h3></div>
        <p class="small-note">${done ? 'Vidéo finale sous-titrée prête.' : 'Phrase par phrase stable. Clique sur Incruster pour graver les sous-titres dans la vidéo via Render.'}</p>
        <label class="field"><span>Style des sous-titres</span><select id="subtitleStyleSelect">${styleOptions(style)}</select></label>
        <label class="field"><span>Calage</span><select id="subtitleSyncSelect" disabled><option value="normal" selected>Phrase par phrase stable</option></select></label>
        <div class="prompt-actions">
          <button type="button" class="secondary-btn" data-action="openai-transcribe-project">${hasSrt ? 'Refaire la transcription' : 'Transcrire automatiquement'}</button>
          <button type="button" class="primary-btn" data-action="openai-burn-subtitles" ${hasSrt && videoReady && !done ? '' : 'disabled'}>${done ? 'Sous-titres incrustés' : 'Incruster dans la vidéo'}</button>
        </div>
        <p class="small-note">${hasSrt ? 'Transcription OpenAI prête.' : 'Transcription à faire.'} ${videoReady ? 'Vidéo finale détectée.' : 'Vidéo pas encore prête.'}</p>
      </div>
    `;
  }

  function removeOldSubtitleBoxes() {
    [...document.querySelectorAll('.result-box')].forEach((box) => {
      const text = box.textContent || '';
      if (text.includes('Sous-titres OpenAI stylés') && !box.id) box.remove();
    });
  }

  function injectPreGenerationBox() {
    if (!ready()) return;
    if (!['musicProject', 'speechProject'].includes(state.route)) return;
    if (document.getElementById('openaiSubtitleChoiceBox')) return;
    const kind = state.route === 'speechProject' ? 'speech' : 'music';
    const oldBox = [...document.querySelectorAll('.result-box')].find((box) => box.textContent.includes('Sous-titres automatiques'));
    if (oldBox) {
      oldBox.insertAdjacentHTML('afterend', preGenerationBox(kind));
      oldBox.style.display = 'none';
      return;
    }
    const sticky = document.querySelector('.sticky-actions');
    if (sticky) sticky.insertAdjacentHTML('beforebegin', preGenerationBox(kind));
  }

  function injectResultBox() {
    if (!ready() || state.route !== 'result') return;
    removeOldSubtitleBoxes();
    const project = activeProject();
    if (!project || !['music', 'speech'].includes(project.type)) return;
    const old = document.getElementById('openaiSubtitlesBox');
    if (old) return;
    const resultBoxes = [...document.querySelectorAll('.result-box')];
    const target = resultBoxes.find((box) => box.textContent.includes('Sous-titres')) || resultBoxes[0];
    if (target) target.insertAdjacentHTML('afterend', resultBox(project));
  }

  async function patchProjectWithChoice(project) {
    const choice = getChoice();
    const next = {
      ...project,
      config: {
        ...project.config,
        subtitlesEnabled: choice.enabled !== false,
        subtitleStyle: choice.style || 'classic',
        subtitleMode: 'auto',
        subtitleSyncMode: 'normal'
      }
    };
    await saveProject(next);
    return next;
  }

  async function transcribeProject(projectArg = null) {
    if (transcribeLock) return null;
    transcribeLock = true;
    try {
      const project = projectArg || activeProject();
      if (!project) throw new Error('Projet introuvable.');
      const audioMedia = await getMedia(getAudioMediaId(project));
      if (!audioMedia?.blob) throw new Error('Audio du projet introuvable.');
      const choice = getChoice();
      const style = clean(document.getElementById('subtitleStyleSelect')?.value || project.config?.subtitleStyle || choice.style || 'classic');

      const form = new FormData();
      form.append('audio', audioMedia.blob, audioMedia.fileName || 'audio.mp3');
      form.append('subtitleStyle', style);
      form.append('subtitleSyncMode', 'normal');
      form.append('aspectRatio', project.config?.aspectRatio || 'vertical');
      if (project.type === 'music') {
        form.append('audioStartSec', String(project.config?.audioStart || 0));
        form.append('audioEndSec', String(project.config?.audioEnd || 0));
      }

      toast('Transcription OpenAI phrase par phrase...');
      const response = await fetch(`${BACKEND_BASE_URL}/api/transcribe/srt`, { method: 'POST', body: form });
      let data = null;
      try { data = await response.json(); } catch {}
      if (!response.ok) throw new Error(data?.error || 'Transcription impossible.');

      const srt = data?.srt || '';
      if (!looksLikeSrt(srt)) throw new Error('Transcription reçue mais SRT invalide.');

      const next = {
        ...project,
        updatedAt: typeof nowISO === 'function' ? nowISO() : new Date().toISOString(),
        config: {
          ...project.config,
          openAiSrt: srt,
          openAiAss: '',
          openAiWords: [],
          subtitleStyle: style,
          subtitleMode: 'auto',
          subtitleSyncMode: 'normal',
          subtitlesEnabled: true,
          subtitles: {
            ...(project.config?.subtitles || {}),
            enabled: true,
            srt,
            plainText: srt,
            source: 'openai_whisper_phrase'
          }
        }
      };

      await saveProject(next);
      state.currentResultId = next.id;
      if (typeof render === 'function') render();
      toast('Transcription prête.');
      return next;
    } finally {
      transcribeLock = false;
    }
  }

  async function burnProjectSubtitles(projectArg = null) {
    if (burnLock) return null;
    burnLock = true;
    try {
      const project = projectArg || activeProject();
      if (!project) throw new Error('Projet introuvable.');
      const srt = getSrt(project);
      if (!srt) throw new Error('Sous-titres introuvables. Clique sur Refaire la transcription.');

      const baseVideoId = getBaseVideoId(project);
      const baseVideo = await getMedia(baseVideoId);
      if (!baseVideo?.blob) throw new Error('Vidéo source introuvable. Refais la vidéo si besoin.');

      const choice = getChoice();
      const style = clean(document.getElementById('subtitleStyleSelect')?.value || project.config?.subtitleStyle || choice.style || 'classic');
      const form = new FormData();
      form.append('video', baseVideo.blob, baseVideo.fileName || 'video.mp4');
      form.append('srt', srt);
      form.append('subtitleStyle', style);
      form.append('subtitleSyncMode', 'normal');
      form.append('aspectRatio', project.config?.aspectRatio || 'vertical');

      toast('Incrustation Render des sous-titres...');
      const response = await fetch(`${BACKEND_BASE_URL}/api/subtitles/burn-video`, { method: 'POST', body: form });
      if (!response.ok) {
        let msg = 'Incrustation impossible.';
        try { const errorData = await response.json(); msg = errorData?.error || msg; } catch {}
        throw new Error(msg);
      }

      const blob = await response.blob();
      if (!blob || blob.size < 1000) throw new Error('Render a renvoyé une vidéo vide.');

      const media = {
        id: typeof uid === 'function' ? uid('subtitled_video') : `subtitled_${Date.now()}`,
        owner: state.profile,
        bucket: 'project-video',
        mediaType: 'video',
        fileName: `${(project.name || 'video').replace(/[^\w-]/g, '_')}_sous_titres.mp4`,
        mimeType: 'video/mp4',
        size: blob.size || 0,
        createdAt: typeof nowISO === 'function' ? nowISO() : new Date().toISOString(),
        block: 'Vrac',
        orientation: project.config?.aspectRatio === 'horizontal' ? 'horizontal' : 'vertical',
        tags: ['sous-titres', style, 'phrase-par-phrase', 'final'],
        blob
      };

      if (typeof mediaPut !== 'function') throw new Error('Sauvegarde vidéo indisponible.');
      await mediaPut(media);

      const next = {
        ...project,
        updatedAt: typeof nowISO === 'function' ? nowISO() : new Date().toISOString(),
        status: 'Vidéo finale sous-titrée prête',
        config: {
          ...project.config,
          subtitleStyle: style,
          subtitleSyncMode: 'normal',
          subtitleBaseVideoMediaId: baseVideoId,
          subtitledVideoMediaId: media.id,
          subtitledStyle: style,
          subtitledSyncMode: 'normal',
          finalVideoMediaId: media.id,
          renderStatus: 'done',
          renderError: ''
        }
      };

      await saveProject(next);
      state.currentResultId = next.id;
      if (typeof render === 'function') render();
      toast('Vidéo finale sous-titrée prête.');
      return next;
    } finally {
      burnLock = false;
    }
  }

  async function autoSubtitleIfReady() {
    if (!ready() || state.route !== 'result') return;
    let project = activeProject();
    if (!project || !['music', 'speech'].includes(project.type)) return;
    const choice = getChoice();
    if (project.config?.subtitlesEnabled !== (choice.enabled !== false) || project.config?.subtitleSyncMode !== 'normal') {
      project = await patchProjectWithChoice(project);
    }
  }

  document.addEventListener('change', async (event) => {
    const styleSelect = event.target.closest('#subtitleStyleBeforeRender, #subtitleStyleSelect');
    if (!styleSelect) return;
    const choice = getChoice();
    choice.style = styleSelect.value || 'classic';
    choice.enabled = true;
    saveChoice(choice);
    setDraftChoice(styleSelect.dataset.kind || 'music', choice);
    const project = activeProject();
    if (project && state.route === 'result') {
      await saveProject({ ...project, config: { ...project.config, subtitlesEnabled: true, subtitleStyle: choice.style, subtitleSyncMode: 'normal', subtitledVideoMediaId: null } });
      if (typeof render === 'function') render();
    }
    toast(`Sous-titres : ${STYLE_LABELS[choice.style] || choice.style}`);
  });

  document.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    try {
      if (target.dataset.action === 'openai-set-subtitle-enabled') {
        const choice = getChoice();
        choice.enabled = target.dataset.enabled === 'true';
        choice.style = document.getElementById('subtitleStyleBeforeRender')?.value || choice.style || 'classic';
        saveChoice(choice);
        setDraftChoice(target.dataset.kind || 'music', choice);
        if (typeof saveMusicDraft === 'function') saveMusicDraft().catch(console.error);
        if (typeof saveSpeechDraft === 'function') saveSpeechDraft().catch(console.error);
        if (typeof render === 'function') render();
        toast(choice.enabled ? 'Sous-titres activés.' : 'Sous-titres désactivés.');
      }
      if (target.dataset.action === 'openai-transcribe-project') await transcribeProject();
      if (target.dataset.action === 'openai-burn-subtitles') await burnProjectSubtitles();
    } catch (error) {
      console.error(error);
      toast(error.message || 'Erreur sous-titres.');
    }
  });

  setInterval(() => { injectPreGenerationBox(); injectResultBox(); autoSubtitleIfReady(); }, 900);
  console.log('Interface sous-titres OpenAI active V33 : phrase stable + incrustation Render.');
})();
