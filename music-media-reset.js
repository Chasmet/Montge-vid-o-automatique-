/* V46 - Reset médias uniquement : conserve audio + métas, oublie les anciennes vidéos */
(function () {
  const VERSION = 'V46';
  let busy = false;

  function ready() {
    try {
      return typeof state !== 'undefined'
        && typeof render === 'function'
        && typeof saveMusicDraft === 'function'
        && typeof prepareMusicProjectComplete === 'function';
    } catch {
      return false;
    }
  }

  function toast(message) {
    if (typeof showToast === 'function') showToast(message);
  }

  function clearMusicMediaOnly(options = {}) {
    if (!ready()) return false;
    const { newProject = true } = options;

    state.currentResultId = null;

    state.temp.musicDraft = {
      ...state.temp.musicDraft,
      id: newProject ? null : state.temp.musicDraft.id,
      selectedMediaIds: []
    };

    state.temp.musicMontagePlan = null;
    state.temp.musicPreparingComplete = false;

    if (state.temp.musicPreparation) {
      state.temp.musicPreparation = {
        ...state.temp.musicPreparation,
        selectionReasoning: '',
        source: {
          ...(state.temp.musicPreparation.source || {}),
          mediaSelection: 'reset_media_only'
        }
      };
    }

    return true;
  }

  async function saveAndRender(message) {
    try {
      await saveMusicDraft();
    } catch (error) {
      console.warn('Sauvegarde reset médias impossible:', error);
    }
    render();
    if (message) toast(message);
  }

  async function resetMediaOnly() {
    if (!clearMusicMediaOnly({ newProject: true })) return;
    await saveAndRender('Médias oubliés. Audio et métas conservés.');
  }

  async function regenerateMediaOnly() {
    if (busy || !ready()) return;
    if (!state.temp.musicAudioFile) {
      toast('Ajoute une musique avant de changer les vidéos.');
      return;
    }

    busy = true;
    const previousMetaGeneral = state.temp.musicMetaGeneral || '';
    const previousMetaShorts = state.temp.musicMetaShorts || '';
    const previousAnalysis = state.temp.musicAnalysis || null;
    const previousClipIdeas = state.temp.musicClipIdeas || null;
    const previousSubtitles = state.temp.musicSubtitles || null;

    clearMusicMediaOnly({ newProject: true });

    try {
      await prepareMusicProjectComplete({
        successMessage: 'Nouvelle sélection vidéo prête. Métas conservées.',
        autoCreateProject: false,
        managePilotLoading: true,
        silentSuccess: true
      });

      if (previousMetaGeneral) state.temp.musicMetaGeneral = previousMetaGeneral;
      if (previousMetaShorts) state.temp.musicMetaShorts = previousMetaShorts;
      if (previousAnalysis) state.temp.musicAnalysis = previousAnalysis;
      if (previousClipIdeas) state.temp.musicClipIdeas = previousClipIdeas;
      if (previousSubtitles) state.temp.musicSubtitles = previousSubtitles;

      await saveMusicDraft();
      render();
      toast('Nouveaux médias choisis. Métas gardées.');
    } catch (error) {
      console.error(error);
      if (previousMetaGeneral) state.temp.musicMetaGeneral = previousMetaGeneral;
      if (previousMetaShorts) state.temp.musicMetaShorts = previousMetaShorts;
      if (previousAnalysis) state.temp.musicAnalysis = previousAnalysis;
      if (previousClipIdeas) state.temp.musicClipIdeas = previousClipIdeas;
      if (previousSubtitles) state.temp.musicSubtitles = previousSubtitles;
      await saveMusicDraft().catch(console.error);
      toast(error.message || 'Impossible de changer uniquement les médias.');
    } finally {
      busy = false;
      render();
    }
  }

  function injectPanel() {
    if (!ready()) return;
    if (state.route !== 'musicProject') return;
    if (document.getElementById('musicMediaResetPanel')) return;

    const form = document.getElementById('musicProjectForm');
    if (!form) return;

    const panel = document.createElement('section');
    panel.id = 'musicMediaResetPanel';
    panel.className = 'result-box';
    panel.innerHTML = `
      <div class="result-box-head">
        <h3>🎲 Vidéos du montage</h3>
      </div>
      <p class="small-note">
        Garde la même musique et les mêmes métadonnées, mais oublie les anciennes vidéos choisies.
      </p>
      <div class="prompt-actions">
        <button type="button" class="secondary-btn" data-action="music-reset-media-only">
          Oublier les vidéos sauvegardées
        </button>
        <button type="button" class="primary-btn" data-action="music-regenerate-media-only">
          Changer uniquement les vidéos
        </button>
      </div>
    `;

    const firstActions = form.querySelector('.prompt-actions') || form.firstElementChild;
    if (firstActions?.parentNode === form) {
      form.insertBefore(panel, firstActions);
    } else {
      form.appendChild(panel);
    }
  }

  document.addEventListener('click', async (event) => {
    const action = event.target?.closest?.('[data-action]')?.dataset?.action;
    if (!action) return;

    if (action === 'music-reset-media-only') {
      event.preventDefault();
      event.stopPropagation();
      await resetMediaOnly();
    }

    if (action === 'music-regenerate-media-only') {
      event.preventDefault();
      event.stopPropagation();
      await regenerateMediaOnly();
    }
  }, true);

  document.addEventListener('click', async (event) => {
    const pilotBtn = event.target?.closest?.('#musicPilotBtn');
    if (!pilotBtn || !ready()) return;

    if ((state.temp.musicDraft?.montageMode || 'auto') === 'auto') {
      clearMusicMediaOnly({ newProject: true });
      await saveMusicDraft().catch(console.error);
    }
  }, true);

  document.addEventListener('submit', async (event) => {
    if (event.target?.id !== 'musicProjectForm' || !ready()) return;

    if ((state.temp.musicDraft?.montageMode || 'auto') === 'auto') {
      clearMusicMediaOnly({ newProject: true });
      await saveMusicDraft().catch(console.error);
    }
  }, true);

  setInterval(injectPanel, 800);
  console.log(`Reset médias musique actif ${VERSION}.`);
})();
