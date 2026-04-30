/* V36 - Garde-fou : les sous-titres visibles et incrustés doivent venir uniquement d'OpenAI */
(function () {
  const OPENAI_SOURCE_PREFIX = 'openai';
  const CLEAN_INTERVAL_MS = 900;

  function ready() {
    try {
      return typeof state !== 'undefined' && typeof render === 'function';
    } catch {
      return false;
    }
  }

  function looksLikeSrt(text) {
    return /\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(text || '');
  }

  function isOpenAiSubtitleSource(source) {
    return (source || '').toString().toLowerCase().startsWith(OPENAI_SOURCE_PREFIX);
  }

  function activeProject() {
    if (!ready() || !state.currentResultId) return null;
    return (state.cache.projects || []).find((p) => p.id === state.currentResultId) || null;
  }

  async function saveProject(project) {
    if (typeof projectPut !== 'function') return;
    await projectPut(project);
    if (typeof hydrateCache === 'function') await hydrateCache();
  }

  function hasValidOpenAiSrt(project) {
    return looksLikeSrt(project?.config?.openAiSrt || '');
  }

  function removeLocalSubtitleDomBlocks() {
    if (!ready() || state.route !== 'result') return;

    [...document.querySelectorAll('.result-box')].forEach((box) => {
      const text = box.textContent || '';
      const isLegacySubtitleBox =
        text.includes('Sous-titres') &&
        !text.includes('OpenAI') &&
        !text.includes('Incrustation finale') &&
        box.id !== 'openaiSubtitlesBox' &&
        box.id !== 'forceBurnSubtitlesBox';

      if (!isLegacySubtitleBox) return;

      box.innerHTML = `
        <div class="result-box-head"><h3>💬 Sous-titres</h3></div>
        <div class="empty-state">
          <div class="empty-icon">🔒</div>
          <p>Sous-titres locaux désactivés.</p>
          <p class="small-note">OpenAI gère obligatoirement la transcription et l’incrustation.</p>
        </div>
      `;
    });
  }

  async function cleanLocalSubtitleData() {
    if (!ready()) return;

    if (state.temp) {
      state.temp.musicSubtitles = null;
      state.temp.speechSubtitles = null;
    }

    const project = activeProject();
    if (!project || !project.config) return;

    const subtitles = project.config.subtitles;
    const source = subtitles?.source || '';
    const hasLocalSubtitles = subtitles && !isOpenAiSubtitleSource(source);

    if (!hasLocalSubtitles) return;

    const next = {
      ...project,
      config: {
        ...project.config,
        subtitles: hasValidOpenAiSrt(project)
          ? {
              enabled: true,
              srt: project.config.openAiSrt,
              plainText: project.config.openAiSrt,
              source: 'openai_guard'
            }
          : {
              enabled: true,
              srt: '',
              plainText: '',
              source: 'openai_required'
            }
      }
    };

    await saveProject(next);
  }

  function markOpenAiButtons() {
    if (!ready() || state.route !== 'result') return;
    const project = activeProject();
    const hasOpenAi = hasValidOpenAiSrt(project);

    const openAiBox = document.getElementById('openaiSubtitlesBox');
    if (openAiBox && !openAiBox.dataset.openaiGuarded) {
      openAiBox.dataset.openaiGuarded = 'true';
      const note = document.createElement('p');
      note.className = 'small-note';
      note.textContent = 'Sécurité active : seuls les sous-titres OpenAI sont autorisés.';
      openAiBox.appendChild(note);
    }

    [...document.querySelectorAll('[data-action="force-burn-subtitles"], [data-action="openai-burn-subtitles"]')].forEach((button) => {
      if (!hasOpenAi) {
        button.disabled = true;
        button.textContent = 'Refaire la transcription OpenAI d’abord';
      }
    });
  }

  async function tick() {
    try {
      removeLocalSubtitleDomBlocks();
      markOpenAiButtons();
      await cleanLocalSubtitleData();
    } catch (error) {
      console.warn('OpenAI subtitles guard error', error);
    }
  }

  setInterval(tick, CLEAN_INTERVAL_MS);
  console.log('Garde-fou sous-titres actif V36 : OpenAI obligatoire, local/Gemini interdit.');
})();
