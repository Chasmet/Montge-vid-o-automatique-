/* V37 - Sous-titres OpenAI uniquement : timeline vidéo à 0 seconde */
(function () {
  const choiceKey = 'openai_subtitle_style_choice_v3';
  let transcribeLock = false;
  let burnLock = false;

  const STYLE_LABELS = {
    classic: 'Classique propre',
    rap: 'Rap / clip officiel',
    tiktok: 'TikTok dynamique',
    cinema: 'Cinéma sombre'
  };

  function ready() {
    try { return typeof state !== 'undefined' && typeof render === 'function'; } catch { return false; }
  }

  function toast(message) {
    if (typeof showToast === 'function') showToast(message);
    else alert(message);
  }

  function clean(value) { return (value || '').toString().trim(); }

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
      return { enabled: parsed?.enabled !== false, style: parsed?.style || 'classic' };
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
    draft.subtitleMode = 'openai_only';
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

  function srtTimeToSeconds(value) {
    const match = clean(value).replace(',', '.').match(/(\d+):(\d+):(\d+)\.(\d+)/);
    if (!match) return 0;
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${match[4] || '0'}`);
  }

  function secondsToSrtTime(value) {
    const totalMs = Math.max(0, Math.round(Number(value || 0) * 1000));
    const ms = totalMs % 1000;
    const totalSeconds = Math.floor(totalMs / 1000);
    const s = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const m = totalMinutes % 60;
    const h = Math.floor(totalMinutes / 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  }

  function firstSrtStart(srt) {
    const match = clean(srt).match(/(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->/);
    return match ? srtTimeToSeconds(match[1]) : 0;
  }

  function rebaseSrtToZero(srt) {
    if (!looksLikeSrt(srt)) return srt || '';
    const offset = firstSrtStart(srt);
    if (!offset || offset < 0.35) return srt;
    return srt.replace(/(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/g, (_full, start, end) => {
      const newStart = secondsToSrtTime(srtTimeToSeconds(start) - offset);
      const newEnd = secondsToSrtTime(srtTimeToSeconds(end) - offset);
      return `${newStart} --> ${newEnd}`;
    });
  }

  function getOpenAiSrt(project) {
    const cfg = project?.config || {};
    if (looksLikeSrt(cfg.openAiSrt)) return cfg.openAiSrt;
    return '';
  }

  function getBaseVideoId(project) {
    const cfg = project?.config || {};
    return cfg.enhancedVideoMediaId || cfg.cleanVideoMediaId || cfg.originalFinalVideoMediaId || cfg.finalVideoMediaId || '';
  }

  async function getFinalVideoSource(project) {
    const videoId = getBaseVideoId(project);
    const videoMedia = await getMedia(videoId);
    if (!videoMedia?.blob) return null;
    return { media: videoMedia, fileName: videoMedia.fileName || 'video_finale.mp4' };
  }

  function isSubtitled(project) {
    const cfg = project?.config || {};
    return !!cfg.subtitledVideoMediaId && cfg.finalVideoMediaId === cfg.subtitledVideoMediaId;
  }

  function preGenerationBox(kind) {
    const choice = getChoice();
    return `
      <div class="result-box" id="openaiSubtitleChoiceBox">
        <div class="result-box-head"><h3>💬 Sous-titres OpenAI</h3></div>
        <p class="small-note">OpenAI uniquement. Le temps choisi manuellement pour couper l’audio ne décale plus les sous-titres : la timeline repart à 0 seconde sur la vidéo finale.</p>
        <div class="prompt-actions">
          <button type="button" class="${choice.enabled ? 'primary-btn' : 'secondary-btn'}" data-action="openai-set-subtitle-enabled" data-kind="${kind}" data-enabled="true">Avec sous-titres</button>
          <button type="button" class="${choice.enabled ? 'secondary-btn' : 'primary-btn'}" data-action="openai-set-subtitle-enabled" data-kind="${kind}" data-enabled="false">Sans sous-titres</button>
        </div>
        <label class="field"><span>Style des sous-titres</span><select id="subtitleStyleBeforeRender" data-kind="${kind}">${styleOptions(choice.style)}</select></label>
        <p class="small-note">Calage : phrase par phrase OpenAI, timeline vidéo 0 s.</p>
      </div>
    `;
  }

  function resultBox(project) {
    const choice = getChoice();
    const cfg = project?.config || {};
    const style = cfg.subtitleStyle || choice.style || 'classic';
    const hasSrt = !!getOpenAiSrt(project);
    const videoReady = !!cfg.finalVideoMediaId;
    const done = isSubtitled(project);
    return `
      <div class="result-box" id="openaiSubtitlesBox">
        <div class="result-box-head"><h3>💬 Sous-titres OpenAI stylés</h3></div>
        <p class="small-note">${done ? 'Vidéo finale sous-titrée prête.' : 'OpenAI transcrit la vidéo finale complète. Le minutage manuel de l’audio est ignoré pour éviter le décalage.'}</p>
        <label class="field"><span>Style des sous-titres</span><select id="subtitleStyleSelect">${styleOptions(style)}</select></label>
        <label class="field"><span>Calage</span><select id="subtitleSyncSelect" disabled><option value="normal" selected>Phrase par phrase OpenAI - début à 0 s</option></select></label>
        <div class="prompt-actions">
          <button type="button" class="secondary-btn" data-action="openai-transcribe-project" ${videoReady && !done ? '' : 'disabled'}>${hasSrt ? 'Refaire la transcription OpenAI' : 'Transcrire avec OpenAI'}</button>
          <button type="button" class="primary-btn" data-action="openai-burn-subtitles" ${hasSrt && videoReady && !done ? '' : 'disabled'}>${done ? 'Sous-titres incrustés' : 'Incruster OpenAI dans la vidéo'}</button>
        </div>
        <p class="small-note">${hasSrt ? 'SRT OpenAI prêt.' : 'Aucun SRT OpenAI complet pour le moment.'} ${videoReady ? 'Vidéo finale détectée.' : 'Vidéo pas encore prête.'}</p>
      </div>
    `;
  }

  function removeLegacySubtitleBoxes() {
    [...document.querySelectorAll('.result-box')].forEach((box) => {
      const text = box.textContent || '';
      if (box.id === 'openaiSubtitlesBox') return;
      if (box.id === 'openaiSubtitleChoiceBox') return;
      if (box.id === 'forceBurnSubtitlesBox') return;
      if (text.includes('Sous-titres')) box.remove();
    });
  }

  function injectPreGenerationBox() {
    if (!ready()) return;
    if (!['musicProject', 'speechProject'].includes(state.route)) return;
    if (document.getElementById('openaiSubtitleChoiceBox')) return;
    const kind = state.route === 'speechProject' ? 'speech' : 'music';
    const oldBox = [...document.querySelectorAll('.result-box')].find((box) => box.textContent.includes('Sous-titres automatiques'));
    if (oldBox) oldBox.remove();
    const sticky = document.querySelector('.sticky-actions');
    if (sticky) sticky.insertAdjacentHTML('beforebegin', preGenerationBox(kind));
  }

  function injectResultBox() {
    if (!ready() || state.route !== 'result') return;
    removeLegacySubtitleBoxes();
    const project = activeProject();
    if (!project || !['music', 'speech'].includes(project.type)) return;
    if (document.getElementById('openaiSubtitlesBox')) return;
    const qualityBox = document.getElementById('videoQualityResultBox');
    const firstBox = [...document.querySelectorAll('.result-box')][0];
    const target = qualityBox || firstBox;
    if (target) target.insertAdjacentHTML('afterend', resultBox(project));
  }

  async function transcribeProject(projectArg = null) {
    if (transcribeLock) return null;
    transcribeLock = true;
    try {
      const project = projectArg || activeProject();
      if (!project) throw new Error('Projet introuvable.');
      const source = await getFinalVideoSource(project);
      if (!source?.media?.blob) throw new Error('Vidéo finale introuvable. Lance d’abord le rendu vidéo.');

      const choice = getChoice();
      const style = clean(document.getElementById('subtitleStyleSelect')?.value || project.config?.subtitleStyle || choice.style || 'classic');
      const form = new FormData();
      form.append('audio', source.media.blob, source.fileName);
      form.append('subtitleStyle', style);
      form.append('subtitleSyncMode', 'normal');
      form.append('aspectRatio', project.config?.aspectRatio || 'vertical');
      form.append('forceTimelineZero', '1');
      form.append('audioStartSec', '0');
      form.append('audioEndSec', '0');

      toast('Transcription OpenAI sur la vidéo finale...');
      const response = await fetch(`${BACKEND_BASE_URL}/api/transcribe/srt`, { method: 'POST', body: form });
      let data = null;
      try { data = await response.json(); } catch {}
      if (!response.ok) throw new Error(data?.error || 'Transcription OpenAI impossible.');

      const srt = rebaseSrtToZero(data?.srt || '');
      if (!looksLikeSrt(srt)) throw new Error('OpenAI a répondu, mais le SRT est invalide.');

      const next = {
        ...project,
        updatedAt: typeof nowISO === 'function' ? nowISO() : new Date().toISOString(),
        config: {
          ...project.config,
          openAiSrt: srt,
          openAiAss: '',
          openAiWords: [],
          subtitleStyle: style,
          subtitleMode: 'openai_only',
          subtitleSyncMode: 'normal',
          subtitleTranscriptionSource: 'openai_final_video_zero_timeline',
          subtitlesEnabled: true,
          subtitledVideoMediaId: null,
          subtitles: { enabled: true, srt, plainText: srt, source: 'openai_final_video_zero_timeline' }
        }
      };

      await saveProject(next);
      state.currentResultId = next.id;
      if (typeof render === 'function') render();
      toast('Transcription OpenAI complète prête.');
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
      const srt = getOpenAiSrt(project);
      if (!srt) throw new Error('Clique d’abord sur Transcrire avec OpenAI.');
      const baseVideoId = getBaseVideoId(project);
      const baseVideo = await getMedia(baseVideoId);
      if (!baseVideo?.blob) throw new Error('Vidéo source introuvable.');

      const choice = getChoice();
      const style = clean(document.getElementById('subtitleStyleSelect')?.value || project.config?.subtitleStyle || choice.style || 'classic');
      const form = new FormData();
      form.append('video', baseVideo.blob, baseVideo.fileName || 'video.mp4');
      form.append('srt', rebaseSrtToZero(srt));
      form.append('subtitleStyle', style);
      form.append('subtitleSyncMode', 'normal');
      form.append('aspectRatio', project.config?.aspectRatio || 'vertical');
      form.append('source', 'openai_only');

      toast('Incrustation OpenAI dans la vidéo...');
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
        fileName: `${(project.name || 'video').replace(/[^\w-]/g, '_')}_openai_sous_titres.mp4`,
        mimeType: 'video/mp4',
        size: blob.size || 0,
        createdAt: typeof nowISO === 'function' ? nowISO() : new Date().toISOString(),
        block: 'Vrac',
        orientation: project.config?.aspectRatio === 'horizontal' ? 'horizontal' : 'vertical',
        tags: ['openai', 'sous-titres', style, 'final'],
        blob
      };

      if (typeof mediaPut !== 'function') throw new Error('Sauvegarde vidéo indisponible.');
      await mediaPut(media);

      const next = {
        ...project,
        updatedAt: typeof nowISO === 'function' ? nowISO() : new Date().toISOString(),
        status: 'Vidéo finale sous-titrée OpenAI prête',
        config: {
          ...project.config,
          subtitleStyle: style,
          subtitleMode: 'openai_only',
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
      toast('Vidéo finale avec sous-titres OpenAI prête.');
      return next;
    } finally {
      burnLock = false;
    }
  }

  async function patchProjectWithChoice(project) {
    const choice = getChoice();
    const next = {
      ...project,
      config: { ...project.config, subtitlesEnabled: choice.enabled !== false, subtitleStyle: choice.style || 'classic', subtitleMode: 'openai_only', subtitleSyncMode: 'normal' }
    };
    await saveProject(next);
    return next;
  }

  async function autoSubtitleIfReady() {
    if (!ready() || state.route !== 'result') return;
    const project = activeProject();
    if (!project || !['music', 'speech'].includes(project.type)) return;
    const choice = getChoice();
    if (project.config?.subtitlesEnabled !== (choice.enabled !== false) || project.config?.subtitleMode !== 'openai_only') {
      await patchProjectWithChoice(project);
    }
  }

  document.addEventListener('change', async (event) => {
    const select = event.target.closest('#subtitleStyleBeforeRender, #subtitleStyleSelect');
    if (!select) return;
    const choice = getChoice();
    choice.style = select.value || 'classic';
    choice.enabled = true;
    saveChoice(choice);
    setDraftChoice(select.dataset.kind || 'music', choice);
    const project = activeProject();
    if (project && state.route === 'result') {
      await saveProject({ ...project, config: { ...project.config, subtitlesEnabled: true, subtitleStyle: choice.style, subtitleMode: 'openai_only', subtitledVideoMediaId: null } });
      if (typeof render === 'function') render();
    }
    toast(`Sous-titres OpenAI : ${STYLE_LABELS[choice.style] || choice.style}`);
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
        toast(choice.enabled ? 'Sous-titres OpenAI activés.' : 'Sous-titres désactivés.');
      }
      if (target.dataset.action === 'openai-transcribe-project') await transcribeProject();
      if (target.dataset.action === 'openai-burn-subtitles') await burnProjectSubtitles();
    } catch (error) {
      console.error(error);
      toast(error.message || 'Erreur sous-titres OpenAI.');
    }
  });

  setInterval(() => { injectPreGenerationBox(); injectResultBox(); autoSubtitleIfReady(); }, 900);
  console.log('Interface sous-titres active V37 : OpenAI uniquement, timeline vidéo à 0 seconde.');
})();
