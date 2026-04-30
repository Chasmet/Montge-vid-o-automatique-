/* V35 - Sécurité sous-titres : stop auto-burn local, uniquement OpenAI SRT calé */
(function () {
  let burnLock = false;

  function ready() {
    try {
      return typeof state !== 'undefined' && typeof render === 'function';
    } catch {
      return false;
    }
  }

  function toast(message) {
    if (typeof showToast === 'function') showToast(message);
    else console.log(message);
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

  function looksLikeSrt(text) {
    return /\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(text || '');
  }

  function getOpenAiSrt(project) {
    const srt = project?.config?.openAiSrt || '';
    return looksLikeSrt(srt) ? srt : '';
  }

  function getBaseVideoId(project) {
    const cfg = project?.config || {};
    return cfg.subtitleBaseVideoMediaId || cfg.enhancedVideoMediaId || cfg.cleanVideoMediaId || cfg.originalFinalVideoMediaId || cfg.finalVideoMediaId || '';
  }

  function isFinalAlreadySubtitled(project) {
    const cfg = project?.config || {};
    return !!cfg.subtitledVideoMediaId && cfg.finalVideoMediaId === cfg.subtitledVideoMediaId;
  }

  async function burnOpenAiSubtitles(project) {
    if (burnLock) return null;
    burnLock = true;

    try {
      const srt = getOpenAiSrt(project);
      if (!srt) {
        toast('Refais d’abord la transcription calée OpenAI, puis incruste.');
        return null;
      }

      const baseVideoId = getBaseVideoId(project);
      const baseVideo = await getMedia(baseVideoId);
      if (!baseVideo?.blob) {
        toast('Vidéo source introuvable. Refais la vidéo si besoin.');
        return null;
      }

      const cfg = project.config || {};
      const style = cfg.subtitleStyle || cfg.subtitledStyle || 'classic';

      const form = new FormData();
      form.append('video', baseVideo.blob, baseVideo.fileName || 'video.mp4');
      form.append('srt', srt);
      form.append('subtitleStyle', style);
      form.append('subtitleSyncMode', 'normal');
      form.append('aspectRatio', cfg.aspectRatio || 'vertical');

      toast('Incrustation OpenAI calée dans la vidéo...');

      const response = await fetch(`${BACKEND_BASE_URL}/api/subtitles/burn-video`, {
        method: 'POST',
        body: form
      });

      if (!response.ok) {
        let msg = 'Incrustation sous-titres impossible.';
        try {
          const data = await response.json();
          msg = data?.error || msg;
        } catch {}
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
        orientation: cfg.aspectRatio === 'horizontal' ? 'horizontal' : 'vertical',
        tags: ['sous-titres', style, 'openai-srt', 'final'],
        blob
      };

      if (typeof mediaPut !== 'function') throw new Error('Sauvegarde vidéo indisponible.');
      await mediaPut(media);

      const next = {
        ...project,
        updatedAt: typeof nowISO === 'function' ? nowISO() : new Date().toISOString(),
        status: 'Vidéo finale sous-titrée prête',
        config: {
          ...cfg,
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

  function injectManualButton() {
    if (!ready() || state.route !== 'result') return;
    const project = activeProject();
    if (!project || !['music', 'speech'].includes(project.type)) return;
    if (document.getElementById('forceBurnSubtitlesBox')) return;
    if (isFinalAlreadySubtitled(project)) return;

    const hasOpenAiSrt = !!getOpenAiSrt(project);
    const html = `
      <div class="result-box" id="forceBurnSubtitlesBox">
        <div class="result-box-head"><h3>🎬 Incrustation finale</h3></div>
        <p class="small-note">${hasOpenAiSrt ? 'Sous-titres OpenAI calés prêts. Incruste-les dans la vidéo finale.' : 'Les sous-titres locaux ne sont plus utilisés. Clique d’abord sur Refaire la transcription calée.'}</p>
        <div class="prompt-actions">
          <button type="button" class="primary-btn" data-action="force-burn-subtitles" ${hasOpenAiSrt ? '' : 'disabled'}>
            🎬 Incruster OpenAI dans la vidéo
          </button>
        </div>
      </div>
    `;

    const subtitlesBox = document.getElementById('openaiSubtitlesBox') || [...document.querySelectorAll('.result-box')].find((box) => (box.textContent || '').includes('Sous-titres'));
    const videoBox = [...document.querySelectorAll('.result-box')].find((box) => (box.textContent || '').includes('Vidéo finale'));
    const target = subtitlesBox || videoBox || [...document.querySelectorAll('.result-box')][0];
    if (target) target.insertAdjacentHTML('afterend', html);
  }

  document.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-action="force-burn-subtitles"]');
    if (!target) return;
    const project = activeProject();
    if (!project) return;
    target.disabled = true;
    target.textContent = '🎬 Incrustation en cours...';
    try {
      await burnOpenAiSubtitles(project);
    } catch (error) {
      console.error(error);
      toast(error.message || 'Erreur incrustation sous-titres.');
      target.disabled = false;
      target.textContent = '🎬 Incruster OpenAI dans la vidéo';
    }
  });

  setInterval(injectManualButton, 1200);
  console.log('Sécurité sous-titres active V35 : aucun auto-burn local, OpenAI SRT uniquement.');
})();
