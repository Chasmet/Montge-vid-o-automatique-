/* V38 - Montage manuel strict : si un bloc est choisi, l'app ne prend jamais ailleurs */
(function () {
  const VERSION = 'V38';

  function ready() {
    try {
      return typeof state !== 'undefined' && state?.temp && Array.isArray(state?.cache?.media);
    } catch {
      return false;
    }
  }

  function toast(message) {
    if (typeof showToast === 'function') showToast(message);
    else console.log(message);
  }

  function clean(value) {
    return (value || '').toString().trim();
  }

  function normalizeBlockName(value) {
    if (typeof normalizeBlock === 'function') return normalizeBlock(value);
    return clean(value) || 'Vrac';
  }

  function orientationOk(targetRatio, mediaOrientation) {
    if (typeof orientationMatches === 'function') return orientationMatches(targetRatio, mediaOrientation);
    if (targetRatio === 'vertical') return ['vertical', 'square', 'unknown', '', null, undefined].includes(mediaOrientation);
    return ['horizontal', 'square', 'unknown', '', null, undefined].includes(mediaOrientation);
  }

  function currentKindAndDraft() {
    if (!ready()) return null;
    if (state.route === 'speechProject') return { kind: 'speech', draft: state.temp.speechDraft };
    if (state.route === 'musicProject') return { kind: 'music', draft: state.temp.musicDraft };
    return null;
  }

  function wantedBucket(kind, draft) {
    if (typeof getBucketForProject === 'function') return getBucketForProject(kind, draft.mode || 'video');
    return `${kind}-${(draft.mode || 'video') === 'video' ? 'video' : 'image'}`;
  }

  function allowedBlocksForDraft(draft) {
    if (!draft) return ['Vrac'];
    if (draft.mediaSourceMode === 'multi') {
      const blocks = (draft.allowedBlocks || []).map(normalizeBlockName).filter(Boolean);
      return blocks.length ? blocks : [normalizeBlockName(draft.primaryBlock || 'Vrac')];
    }
    return [normalizeBlockName(draft.primaryBlock || 'Vrac')];
  }

  function sortNewestFirst(list) {
    return [...list].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }

  function blockCandidates(kind, draft, strictOrientation = true) {
    const bucket = wantedBucket(kind, draft);
    const allowedBlocks = allowedBlocksForDraft(draft);
    const ratio = draft.aspectRatio || 'vertical';

    return sortNewestFirst((state.cache.media || []).filter((media) => {
      if (media.owner !== state.profile) return false;
      if (media.bucket !== bucket) return false;
      if (!allowedBlocks.includes(normalizeBlockName(media.block || 'Vrac'))) return false;
      if (strictOrientation && !orientationOk(ratio, media.orientation || 'unknown')) return false;
      return true;
    }));
  }

  function enforceDraft(kind, draft, silent = true) {
    if (!draft || draft.montageMode !== 'manual') return false;

    const allowedBlocks = allowedBlocksForDraft(draft);
    if (draft.mediaSourceMode === 'single') {
      draft.allowedBlocks = [normalizeBlockName(draft.primaryBlock || allowedBlocks[0] || 'Vrac')];
    } else {
      draft.allowedBlocks = allowedBlocks;
    }

    draft.manualBlockStrict = true;
    draft.aiCanChangeBlock = false;
    draft.strictBlockOnly = true;

    const candidatesWithOrientation = blockCandidates(kind, draft, true);
    const candidatesAnyOrientation = blockCandidates(kind, draft, false);
    const candidates = candidatesWithOrientation.length ? candidatesWithOrientation : candidatesAnyOrientation;
    const allowedIds = new Set(candidates.map((m) => m.id));
    const beforeIds = Array.isArray(draft.selectedMediaIds) ? draft.selectedMediaIds : [];
    const keptIds = beforeIds.filter((id) => allowedIds.has(id));

    // Si l'utilisateur a déjà sélectionné des médias du bon bloc, on garde son choix.
    // Si rien n'est sélectionné, on remplit uniquement avec les médias du bloc choisi.
    draft.selectedMediaIds = keptIds.length ? keptIds : candidates.map((m) => m.id);

    if (!silent) {
      if (!candidates.length) {
        toast(`Montage manuel : aucun média trouvé dans le bloc ${allowedBlocks.join(', ')}.`);
      } else {
        toast(`Montage manuel verrouillé sur : ${allowedBlocks.join(', ')} (${draft.selectedMediaIds.length} média${draft.selectedMediaIds.length > 1 ? 's' : ''}).`);
      }
    }

    return true;
  }

  function enforceCurrentDraft(silent = true) {
    const current = currentKindAndDraft();
    if (!current) return false;
    return enforceDraft(current.kind, current.draft, silent);
  }

  function patchDraftOnInputs() {
    document.addEventListener('change', (event) => {
      const target = event.target;
      if (!target) return;
      const id = target.id || '';
      const name = target.name || '';
      const touchedBlockOrMode = /block|source|montage|mode|media/i.test(`${id} ${name}`);
      if (!touchedBlockOrMode) return;
      setTimeout(() => enforceCurrentDraft(false), 80);
    }, true);

    document.addEventListener('click', () => {
      // Capture juste avant les boutons de préparation/rendu : le brouillon est corrigé avant que script.js construise le projet.
      enforceCurrentDraft(true);
    }, true);
  }

  function addVisualLock() {
    if (!ready()) return;
    const current = currentKindAndDraft();
    if (!current || current.draft?.montageMode !== 'manual') return;
    if (document.getElementById('manualBlockGuardBox')) return;

    const blocks = allowedBlocksForDraft(current.draft);
    const count = current.draft?.selectedMediaIds?.length || 0;
    const sticky = document.querySelector('.sticky-actions');
    if (!sticky) return;

    sticky.insertAdjacentHTML('beforebegin', `
      <div class="result-box" id="manualBlockGuardBox">
        <div class="result-box-head"><h3>🔒 Manuel strict</h3></div>
        <p class="small-note">Bloc verrouillé : <strong>${blocks.map((b) => b.replace(/</g, '&lt;')).join(', ')}</strong>.</p>
        <p class="small-note">L’application ne prendra aucun média d’un autre bloc. Médias prêts : ${count}.</p>
      </div>
    `);
  }

  function tick() {
    if (!ready()) return;
    enforceCurrentDraft(true);
    addVisualLock();
  }

  patchDraftOnInputs();
  setInterval(tick, 900);
  console.log(`Garde-fou montage manuel strict actif ${VERSION}.`);
})();
