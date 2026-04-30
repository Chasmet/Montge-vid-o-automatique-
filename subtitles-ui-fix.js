/* Sous-titres automatiques stylés - choix avant rendu + transcription OpenAI + incrustation */
(function () {
  const STYLE_LABELS = {
    rap: 'Rap / clip officiel',
    tiktok: 'TikTok dynamique',
    classic: 'Classique propre',
    cinema: 'Cinéma sombre'
  };

  const autoJobs = new Set();
  const userChoiceKey = 'openai_subtitle_style_choice_v1';

  function appReady() {
    try {
      return typeof state !== 'undefined' && typeof render === 'function';
    } catch {
      return false;
    }
  }

  function safeText(value) {
    return (value || '').toString().trim();
  }

  function getSavedChoice() {
    try {
      const raw = localStorage.getItem(userChoiceKey);
      const parsed = raw ? JSON.parse(raw) : null;
      return {
        enabled: parsed?.enabled !== false,
        style: parsed?.style || 'rap',
        mode: parsed?.mode || 'auto'
      };
    } catch {
      return { enabled: true, style: 'rap', mode: 'auto' };
    }
  }

  function saveChoice(choice) {
    try {
      localStorage.setItem(userChoiceKey, JSON.stringify(choice));
    } catch {}
  }

  function setDraftChoice(kind, choice) {
    if (!appReady()) return;
    const draft = kind === 'speech' ? state.temp?.speechDraft : state.temp?.musicDraft;
    if (!draft) return;
    draft.subtitlesEnabled = choice.enabled !== false;
    draft.subtitleStyle = choice.style || 'rap';
    draft.subtitleMode = choice.mode || 'auto';
  }

  function activeProject() {
    if (!appReady() || !state.currentResultId) return null;
    return (state.cache.projects || []).find(p => p.id === state.currentResultId) || null;
  }

  function getAudioMediaId(project) {
    if (!project) return '';
    return project.type === 'speech'
      ? project.config?.generatedAudioMediaId
      : project.config?.audioMediaId;
  }

  async function getMedia(id) {
    if (!id) return null;
    if (typeof mediaGetById === 'function') return await mediaGetById(id);
    return (state.cache.media || []).find(m => m.id === id) || null;
  }

  function getFinalVideo(project) {
    const id = project?.config?.finalVideoMediaId;
    if (!id) return null;
    return (state.cache.media || []).find(m => m.id === id) || null;
  }

  function showMsg(message) {
    if (typeof showToast === 'function') showToast(message);
    else alert(message);
  }

  async function parseJsonResponse(response, defaultMessage) {
    let data = null;
    let text = '';
    try {
      const type = response.headers.get('content-type') || '';
      if (type.includes('application/json')) data = await response.json();
      else text = await response.text();
    } catch {}
    if (!response.ok) throw new Error(data?.error || text || defaultMessage);
    return data || {};
  }

  function preGenerationBox(kind) {
    const choice = getSavedChoice();
    const title = kind === 'speech' ? 'Sous-titres voix IA' : 'Sous-titres du clip';

    return `
      <div class="result-box" id="openaiSubtitleChoiceBox">
        <div class="result-box-head">
          <h3>💬 ${title}</h3>
        </div>
        <p class="small-note">
          Choisis maintenant le style. Après le rendu, OpenAI transcrit l’audio et l’application incruste automatiquement les sous-titres.
        </p>
        <div class="prompt-actions">
          <button type="button" class="${choice.enabled ? 'primary-btn' : 'secondary-btn'}" data-action="openai-set-subtitle-enabled" data-kind="${kind}" data-enabled="true">
            Avec sous-titres stylés
          </button>
          <button type="button" class="${choice.enabled ? 'secondary-btn' : 'primary-btn'}" data-action="openai-set-subtitle-enabled" data-kind="${kind}" data-enabled="false">
            Sans sous-titres
          </button>
        </div>
        <label class="field">
          <span>Style à incruster</span>
          <select id="subtitleStyleBeforeRender" data-kind="${kind}">
            <option value="rap" ${choice.style === 'rap' ? 'selected' : ''}>Rap / clip officiel</option>
            <option value="tiktok" ${choice.style === 'tiktok' ? 'selected' : ''}>TikTok dynamique</option>
            <option value="classic" ${choice.style === 'classic' ? 'selected' : ''}>Classique propre</option>
            <option value="cinema" ${choice.style === 'cinema' ? 'selected' : ''}>Cinéma sombre</option>
          </select>
        </label>
        <p class="small-note">
          Mode actuel : ${choice.enabled ? `activé - ${STYLE_LABELS[choice.style] || choice.style}` : 'désactivé'}.
        </p>
      </div>
    `;
  }

  function subtitlesBox(project) {
    const choice = getSavedChoice();
    const hasSrt = !!project?.config?.openAiSrt;
    const style = project?.config?.subtitleStyle || choice.style || 'rap';
    const videoReady = !!project?.config?.finalVideoMediaId;
    const autoEnabled = project?.config?.subtitlesEnabled !== false;
    const done = project?.config?.subtitledVideoMediaId;

    return `
      <div class="result-box" id="openaiSubtitlesBox">
        <div class="result-box-head">
          <h3>💬 Sous-titres OpenAI stylés</h3>
        </div>
        <p class="small-note">
          ${done ? 'Vidéo sous-titrée prête.' : 'La transcription et l’incrustation se font automatiquement après le rendu si l’option est activée.'}
        </p>
        <label class="field">
          <span>Style des sous-titres</span>
          <select id="subtitleStyleSelect">
            <option value="rap" ${style === 'rap' ? 'selected' : ''}>Rap / clip officiel</option>
            <option value="tiktok" ${style === 'tiktok' ? 'selected' : ''}>TikTok dynamique</option>
            <option value="classic" ${style === 'classic' ? 'selected' : ''}>Classique propre</option>
            <option value="cinema" ${style === 'cinema' ? 'selected' : ''}>Cinéma sombre</option>
          </select>
        </label>
        <div class="prompt-actions">
          <button type="button" class="secondary-btn" data-action="openai-transcribe-project">
            ${hasSrt ? 'Refaire la transcription' : 'Transcrire automatiquement'}
          </button>
          <button type="button" class="primary-btn" data-action="openai-burn-subtitles" ${hasSrt && videoReady ? '' : 'disabled'}>
            Incruster maintenant
          </button>
        </div>
        <p class="small-note">
          ${autoEnabled ? 'Sous-titres activés.' : 'Sous-titres désactivés.'}
          ${hasSrt ? ' Transcription OpenAI prête.' : ' Transcription OpenAI pas encore faite.'}
          ${videoReady ? ' Vidéo finale détectée.' : ' Attends la fin du rendu vidéo.'}
        </p>
      </div>
    `;
  }

  function injectPreGenerationBox() {
    if (!appReady()) return;
    if (!['musicProject', 'speechProject'].includes(state.route)) return;
    if (document.getElementById('openaiSubtitleChoiceBox')) return;

    const kind = state.route === 'speechProject' ? 'speech' : 'music';
    const oldBox = [...document.querySelectorAll('.result-box')].find(box => box.textContent.includes('Sous-titres automatiques'));

    if (oldBox) {
      oldBox.insertAdjacentHTML('afterend', preGenerationBox(kind));
      oldBox.style.display = 'none';
      return;
    }

    const sticky = document.querySelector('.sticky-actions');
    if (sticky) sticky.insertAdjacentHTML('beforebegin', preGenerationBox(kind));
  }

  function injectResultBox() {
    if (!appReady() || state.route !== 'result') return;
    const project = activeProject();
    if (!project || !['music', 'speech'].includes(project.type)) return;
    if (document.getElementById('openaiSubtitlesBox')) return;

    const resultBoxes = [...document.querySelectorAll('.result-box')];
    const target = resultBoxes.find(box => box.textContent.includes('Sous-titres')) || resultBoxes[0];
    if (!target) return;

    target.insertAdjacentHTML('afterend', subtitlesBox(project));
  }

  async function saveProject(project) {
    if (typeof projectPut !== 'function') throw new Error('Sauvegarde projet indisponible.');
    await projectPut(project);
    if (typeof hydrateCache === 'function') await hydrateCache();
  }

  async function patchProjectWithChoice(project) {
    if (!project) return null;
    const choice = getSavedChoice();
    const next = {
      ...project,
      config: {
        ...project.config,
        subtitlesEnabled: choice.enabled !== false,
        subtitleStyle: choice.style || 'rap',
        subtitleMode: choice.mode || 'auto'
      }
    };
    await saveProject(next);
    return next;
  }

  async function transcribeProject(projectArg = null) {
    const project = projectArg || activeProject();
    if (!project) {
      showMsg('Projet introuvable.');
      return null;
    }

    const audioMedia = await getMedia(getAudioMediaId(project));
    if (!audioMedia?.blob) {
      showMsg('Audio du projet introuvable.');
      return null;
    }

    const choice = getSavedChoice();
    const style = safeText(document.getElementById('subtitleStyleSelect')?.value || project.config?.subtitleStyle || choice.style || 'rap');
    const form = new FormData();
    form.append('audio', audioMedia.blob, audioMedia.fileName || 'audio.mp3');
    form.append('subtitleStyle', style);
    form.append('aspectRatio', project.config?.aspectRatio || 'vertical');

    if (project.type === 'music') {
      form.append('audioStartSec', String(project.config?.audioStart || 0));
      form.append('audioEndSec', String(project.config?.audioEnd || 0));
    }

    showMsg('Transcription OpenAI en cours...');

    const response = await fetch(`${BACKEND_BASE_URL}/api/transcribe/srt`, {
      method: 'POST',
      body: form
    });

    const data = await parseJsonResponse(response, 'Transcription impossible.');

    const next = {
      ...project,
      updatedAt: typeof nowISO === 'function' ? nowISO() : new Date().toISOString(),
      config: {
        ...project.config,
        openAiSrt: data.srt || '',
        openAiAss: data.ass || '',
        subtitleStyle: style,
        subtitleMode: 'auto',
        subtitlesEnabled: true,
        subtitles: {
          ...(project.config?.subtitles || {}),
          enabled: true,
          plainText: data.srt || project.config?.subtitles?.plainText || '',
          source: 'openai_whisper'
        }
      }
    };

    await saveProject(next);
    state.currentResultId = next.id;
    if (typeof render === 'function') render();
    showMsg('Transcription OpenAI prête.');
    return next;
  }

  async function burnProjectSubtitles(projectArg = null) {
    const project = projectArg || activeProject();
    if (!project) {
      showMsg('Projet introuvable.');
      return null;
    }

    const finalVideo = getFinalVideo(project);
    if (!finalVideo?.blob) {
      showMsg('Crée d’abord la vidéo finale.');
      return null;
    }

    const srt = safeText(project.config?.openAiSrt || '');
    if (!srt) {
      showMsg('Transcris d’abord l’audio.');
      return null;
    }

    const choice = getSavedChoice();
    const style = safeText(document.getElementById('subtitleStyleSelect')?.value || project.config?.subtitleStyle || choice.style || 'rap');

    const form = new FormData();
    form.append('video', finalVideo.blob, finalVideo.fileName || 'video.mp4');
    form.append('srt', srt);
    form.append('subtitleStyle', style);
    form.append('aspectRatio', project.config?.aspectRatio || 'vertical');

    showMsg('Incrustation des sous-titres...');

    const response = await fetch(`${BACKEND_BASE_URL}/api/subtitles/burn-video`, {
      method: 'POST',
      body: form
    });

    if (!response.ok) {
      let msg = 'Incrustation impossible.';
      try {
        const errorData = await response.json();
        msg = errorData?.error || msg;
      } catch {}
      throw new Error(msg);
    }

    const blob = await response.blob();
    const media = {
      id: typeof uid === 'function' ? uid('subtitled_video') : `subtitled_${Date.now()}`,
      owner: state.profile,
      bucket: 'project-video',
      mediaType: 'video',
      fileName: `${project.name.replace(/[^\w-]/g, '_')}_sous_titres.mp4`,
      mimeType: 'video/mp4',
      size: blob.size || 0,
      createdAt: typeof nowISO === 'function' ? nowISO() : new Date().toISOString(),
      block: 'Vrac',
      orientation: project.config?.aspectRatio === 'horizontal' ? 'horizontal' : 'vertical',
      tags: ['sous-titres'],
      blob
    };

    if (typeof mediaPut !== 'function') throw new Error('Sauvegarde vidéo indisponible.');
    await mediaPut(media);

    const next = {
      ...project,
      updatedAt: typeof nowISO === 'function' ? nowISO() : new Date().toISOString(),
      status: 'Vidéo sous-titrée prête',
      config: {
        ...project.config,
        subtitleStyle: style,
        finalVideoMediaId: media.id,
        subtitledVideoMediaId: media.id,
        renderStatus: 'done',
        renderError: ''
      }
    };

    await saveProject(next);
    state.currentResultId = next.id;
    if (typeof render === 'function') render();
    showMsg('Vidéo sous-titrée prête.');
    return next;
  }

  async function autoSubtitleIfReady() {
    if (!appReady() || state.route !== 'result') return;
    let project = activeProject();
    if (!project || !['music', 'speech'].includes(project.type)) return;

    const choice = getSavedChoice();
    if (project.config?.subtitleStyle !== choice.style || project.config?.subtitlesEnabled !== (choice.enabled !== false)) {
      project = await patchProjectWithChoice(project);
    }

    if (project.config?.subtitlesEnabled === false) return;
    if (project.config?.renderStatus !== 'done') return;
    if (!project.config?.finalVideoMediaId) return;
    if (project.config?.subtitledVideoMediaId) return;

    const key = `${project.id}_${project.config.finalVideoMediaId}_${project.config.subtitleStyle || choice.style}`;
    if (autoJobs.has(key)) return;
    autoJobs.add(key);

    try {
      let updated = project;
      if (!safeText(updated.config?.openAiSrt || '')) {
        updated = await transcribeProject(project);
      }
      if (updated) {
        await burnProjectSubtitles(updated);
      }
    } catch (error) {
      console.error(error);
      showMsg(error.message || 'Erreur sous-titres OpenAI.');
    }
  }

  document.addEventListener('change', async (event) => {
    const select = event.target.closest('#subtitleStyleBeforeRender, #subtitleStyleSelect');
    if (!select) return;

    const choice = getSavedChoice();
    choice.style = select.value || 'rap';
    choice.enabled = true;
    saveChoice(choice);
    setDraftChoice(select.dataset.kind || 'music', choice);
    showMsg(`Style sous-titres : ${STYLE_LABELS[choice.style] || choice.style}`);
  });

  document.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;

    try {
      if (target.dataset.action === 'openai-set-subtitle-enabled') {
        const choice = getSavedChoice();
        choice.enabled = target.dataset.enabled === 'true';
        choice.style = document.getElementById('subtitleStyleBeforeRender')?.value || choice.style || 'rap';
        choice.mode = 'auto';
        saveChoice(choice);
        setDraftChoice(target.dataset.kind || 'music', choice);
        if (typeof saveMusicDraft === 'function') saveMusicDraft().catch(console.error);
        if (typeof saveSpeechDraft === 'function') saveSpeechDraft().catch(console.error);
        if (typeof render === 'function') render();
        showMsg(choice.enabled ? 'Sous-titres stylés activés.' : 'Sous-titres désactivés.');
      }

      if (target.dataset.action === 'openai-transcribe-project') {
        await transcribeProject();
      }
      if (target.dataset.action === 'openai-burn-subtitles') {
        await burnProjectSubtitles();
      }
    } catch (error) {
      console.error(error);
      showMsg(error.message || 'Erreur sous-titres.');
    }
  });

  setInterval(() => {
    injectPreGenerationBox();
    injectResultBox();
    autoSubtitleIfReady();
  }, 900);

  console.log('Interface sous-titres OpenAI active V22 choix avant rendu.');
})();
