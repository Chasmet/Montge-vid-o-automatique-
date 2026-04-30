/* Sous-titres automatiques stylés - OpenAI transcription + incrustation vidéo */
(function () {
  const STYLE_LABELS = {
    rap: 'Rap / clip officiel',
    tiktok: 'TikTok dynamique',
    classic: 'Classique propre',
    cinema: 'Cinéma sombre'
  };

  const autoJobs = new Set();

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

  function subtitlesBox(project) {
    const hasSrt = !!project?.config?.openAiSrt;
    const style = project?.config?.subtitleStyle || 'rap';
    const videoReady = !!project?.config?.finalVideoMediaId;
    const autoEnabled = project?.config?.subtitlesEnabled !== false;

    return `
      <div class="result-box" id="openaiSubtitlesBox">
        <div class="result-box-head">
          <h3>💬 Sous-titres OpenAI stylés</h3>
        </div>
        <p class="small-note">
          Transcription réelle de l’audio, sans Gemini. Si l’option sous-titres est activée, l’application peut les incruster après le rendu.
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
            Incruster dans la vidéo
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

  function injectBox() {
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

    const style = safeText(document.getElementById('subtitleStyleSelect')?.value || project.config?.subtitleStyle || 'rap');
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

    const style = safeText(document.getElementById('subtitleStyleSelect')?.value || project.config?.subtitleStyle || 'rap');

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
    const project = activeProject();
    if (!project || !['music', 'speech'].includes(project.type)) return;
    if (project.config?.subtitlesEnabled === false) return;
    if (project.config?.renderStatus !== 'done') return;
    if (!project.config?.finalVideoMediaId) return;
    if (project.config?.subtitledVideoMediaId) return;

    const key = `${project.id}_${project.config.finalVideoMediaId}`;
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

  document.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;

    try {
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
    injectBox();
    autoSubtitleIfReady();
  }, 1000);

  console.log('Interface sous-titres OpenAI active V20.');
})();
