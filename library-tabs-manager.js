/* V48 - Bibliothèque en onglets + gestion blocs */
(function () {
  const VERSION = 'V48';
  let currentTab = localStorage.getItem('library_active_tab') || 'quick';
  let initialized = false;

  function ready() {
    try {
      return typeof state !== 'undefined'
        && typeof render === 'function'
        && typeof mediaDelete === 'function'
        && typeof projectPut === 'function'
        && typeof hydrateCache === 'function'
        && typeof saveCustomBlocks === 'function'
        && typeof allMediaBlocks === 'function';
    } catch {
      return false;
    }
  }

  function toast(message) {
    try { showToast(message); } catch { alert(message); }
  }

  function esc(value) {
    return (value || '').toString()
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function norm(value) {
    try { return normalizeBlock(value || 'Vrac'); } catch { return (value || 'Vrac').toString().trim() || 'Vrac'; }
  }

  function size(bytes) {
    const v = Number(bytes || 0);
    if (v < 1024 * 1024) return `${Math.round(v / 1024)} Ko`;
    if (v < 1024 * 1024 * 1024) return `${(v / 1024 / 1024).toFixed(v > 10 * 1024 * 1024 ? 0 : 1)} Mo`;
    return `${(v / 1024 / 1024 / 1024).toFixed(1)} Go`;
  }

  function currentBucket() {
    try { return getBucketForProject(state.libraryMode || 'music', state.libraryType || 'video'); }
    catch { return `${state.libraryMode || 'music'}-${state.libraryType || 'video'}`; }
  }

  function bucketLabel() {
    const type = state.libraryType === 'image' ? 'images' : 'vidéos';
    const mode = state.libraryMode === 'speech' ? 'voix IA' : 'musique';
    return `${type} ${mode}`;
  }

  function itemsForCurrentBucket() {
    const bucket = currentBucket();
    return (state.cache?.media || []).filter((item) => item.bucket === bucket);
  }

  function blockStats() {
    const groups = new Map();
    for (const block of allMediaBlocks()) {
      groups.set(norm(block), { name: norm(block), count: 0, size: 0, items: [], isCustom: (state.customBlocks || []).map(norm).includes(norm(block)) });
    }
    for (const item of itemsForCurrentBucket()) {
      const block = norm(item.block || 'Vrac');
      if (!groups.has(block)) groups.set(block, { name: block, count: 0, size: 0, items: [], isCustom: true });
      const group = groups.get(block);
      group.count += 1;
      group.size += Number(item.size || item.blob?.size || 0);
      group.items.push(item);
    }
    return [...groups.values()].sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name, 'fr');
    });
  }

  function ensureStyle() {
    if (document.getElementById('libraryTabsManagerStyle')) return;
    const style = document.createElement('style');
    style.id = 'libraryTabsManagerStyle';
    style.textContent = `
      .library-tabs-bar{position:sticky;top:0;z-index:30;display:flex;gap:10px;overflow:auto;padding:10px 0 14px;margin:0 0 12px;background:linear-gradient(180deg,rgba(2,6,23,.98),rgba(2,6,23,.76));backdrop-filter:blur(10px)}
      .library-tab-btn{flex:0 0 auto;border:1px solid rgba(148,163,184,.26);border-radius:999px;padding:12px 15px;background:rgba(15,23,42,.88);color:inherit;font-weight:900;font-size:.95rem;box-shadow:0 8px 26px rgba(0,0,0,.18)}
      .library-tab-btn.active{background:linear-gradient(135deg,#22c55e,#2563eb);border-color:rgba(255,255,255,.24);color:white}
      .library-tab-note{border:1px solid rgba(34,197,94,.25);background:rgba(34,197,94,.08);border-radius:18px;padding:12px;margin:8px 0 14px;color:rgba(226,232,240,.92)}
      .library-delete-panel{display:grid;gap:12px}
      .library-block-manage-card{border:1px solid rgba(148,163,184,.18);border-radius:20px;background:rgba(15,23,42,.72);padding:14px;display:grid;gap:10px}
      .library-block-top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
      .library-block-name{font-weight:1000;font-size:1.05rem;color:#fff}.library-block-meta{color:rgba(203,213,225,.78);font-weight:700}.library-danger{border-color:rgba(248,113,113,.38)!important;background:rgba(127,29,29,.35)!important;color:#fecaca!important}.library-muted{opacity:.55;pointer-events:none}
      body.library-tab-quick #uxFinalShell .ux-final-card.blue,body.library-tab-quick #libraryMediaGrid.closest-hidden{display:none!important}
      body.library-tab-themes #uxFinalShell .ux-final-card.blue{display:none!important}
      body.library-tab-albums #uxFinalShell .ux-final-card.green{display:none!important}
      body.library-tab-files #uxFinalShell,body.library-tab-delete #uxFinalShell{display:none!important}
      body.library-tab-quick #libraryMediaGrid,body.library-tab-themes #libraryMediaGrid,body.library-tab-albums #libraryMediaGrid{min-height:0}
    `;
    document.head.appendChild(style);
  }

  function libraryVisible() {
    return ready() && state.route === 'library' && document.getElementById('libraryMediaGrid');
  }

  function tabHtml() {
    const tabs = [
      ['quick', '⚡ Rapide'],
      ['themes', '🎨 Thématiques'],
      ['albums', '📚 Albums'],
      ['files', '📁 Tous fichiers'],
      ['delete', '🗑️ Supprimer bloc']
    ];
    return `
      <div id="libraryTabsBar" class="library-tabs-bar">
        ${tabs.map(([id, label]) => `<button type="button" class="library-tab-btn ${currentTab === id ? 'active' : ''}" data-library-tab="${id}">${label}</button>`).join('')}
      </div>
      <div id="libraryTabNote" class="library-tab-note"></div>
    `;
  }

  function noteForTab() {
    const map = {
      quick: `Vue rapide : import CHK + accès direct aux blocs. Type actif : ${bucketLabel()}.`,
      themes: 'Thématiques visuelles : importe un dossier CHK proprement, sans mélanger les fichiers.',
      albums: 'Albums/blocs : choisis un bloc pour filtrer rapidement les fichiers.',
      files: 'Tous fichiers : liste complète des médias enregistrés avec aperçu, changement de bloc et suppression fichier.',
      delete: 'Suppression blocs : vide un bloc ou supprime un bloc personnalisé. Confirmation obligatoire.'
    };
    return map[currentTab] || map.quick;
  }

  function injectTabs() {
    if (!libraryVisible()) return;
    ensureStyle();

    const panelHead = document.querySelector('#screen .panel-head');
    const stack = document.querySelector('#screen .stack-form');
    if (!stack) return;

    if (!document.getElementById('libraryTabsBar')) {
      stack.insertAdjacentHTML('afterbegin', tabHtml());
    }

    const note = document.getElementById('libraryTabNote');
    if (note) note.textContent = noteForTab();

    document.querySelectorAll('[data-library-tab]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.libraryTab === currentTab);
      btn.onclick = () => {
        currentTab = btn.dataset.libraryTab || 'quick';
        localStorage.setItem('library_active_tab', currentTab);
        applyTab();
      };
    });

    if (panelHead) panelHead.style.display = currentTab === 'quick' ? '' : 'none';
    applyTab();
  }

  function resultBoxByTitle(titleNeedle) {
    return [...document.querySelectorAll('#screen .result-box')].find((box) => (box.textContent || '').includes(titleNeedle));
  }

  function closestField(id) { return document.getElementById(id)?.closest('.field'); }

  function setVisible(el, visible) {
    if (!el) return;
    el.style.display = visible ? '' : 'none';
  }

  function applyTab() {
    if (!libraryVisible()) return;
    document.body.classList.remove('library-tab-quick','library-tab-themes','library-tab-albums','library-tab-files','library-tab-delete');
    document.body.classList.add(`library-tab-${currentTab}`);

    const hero = document.querySelector('#screen .hero-card');
    const uxShell = document.getElementById('uxFinalShell');
    const fileGridBox = resultBoxByTitle('Fichiers enregistrés');
    const deletePanel = ensureDeletePanel();
    const manualToggle = document.getElementById('uxManualToggle');

    const showUx = ['quick', 'themes', 'albums'].includes(currentTab);
    setVisible(hero, currentTab === 'quick');
    setVisible(uxShell, showUx);
    setVisible(fileGridBox, currentTab === 'files');
    setVisible(deletePanel, currentTab === 'delete');
    setVisible(manualToggle, currentTab === 'quick');

    ['libraryModeSelect','libraryTypeSelect','libraryUploadBlock','libraryBlockFilter','libraryFileInput'].forEach((id) => {
      setVisible(closestField(id), currentTab === 'files' || currentTab === 'quick');
    });
    setVisible(document.querySelector('[data-action="create-custom-block"]')?.closest('.prompt-actions'), currentTab === 'files' || currentTab === 'delete');

    const note = document.getElementById('libraryTabNote');
    if (note) note.textContent = noteForTab();
    renderDeletePanel();
  }

  function ensureDeletePanel() {
    let panel = document.getElementById('libraryDeletePanel');
    if (panel) return panel;
    const stack = document.querySelector('#screen .stack-form');
    if (!stack) return null;
    panel = document.createElement('section');
    panel.id = 'libraryDeletePanel';
    panel.className = 'result-box';
    panel.innerHTML = '<div class="result-box-head"><h3>🗑️ Supprimer / vider les blocs</h3></div><div id="libraryDeleteList" class="library-delete-panel"></div>';
    stack.appendChild(panel);
    return panel;
  }

  function renderDeletePanel() {
    const list = document.getElementById('libraryDeleteList');
    if (!list || currentTab !== 'delete') return;
    const stats = blockStats();
    list.innerHTML = stats.map((block) => {
      const canDeleteBlock = block.isCustom;
      const empty = block.count === 0;
      return `
        <article class="library-block-manage-card">
          <div class="library-block-top">
            <div>
              <div class="library-block-name">${esc(block.name)}</div>
              <div class="library-block-meta">${block.count} fichier${block.count > 1 ? 's' : ''} • ${size(block.size)} • ${block.isCustom ? 'bloc personnalisé' : 'bloc système'}</div>
            </div>
          </div>
          <div class="prompt-actions">
            <button type="button" class="secondary-btn ${block.count ? '' : 'library-muted'}" data-library-empty-block="${esc(block.name)}">Vider les fichiers</button>
            <button type="button" class="secondary-btn library-danger ${canDeleteBlock ? '' : 'library-muted'}" data-library-delete-block="${esc(block.name)}">${empty ? 'Supprimer le bloc' : 'Supprimer bloc + fichiers'}</button>
          </div>
        </article>
      `;
    }).join('') || '<div class="empty-state">Aucun bloc à gérer.</div>';
  }

  async function cleanReferencesAfterMediaDelete(ids) {
    const idSet = new Set(ids);

    try {
      state.temp.musicDraft.selectedMediaIds = (state.temp.musicDraft.selectedMediaIds || []).filter((id) => !idSet.has(id));
      state.temp.speechDraft.selectedMediaIds = (state.temp.speechDraft.selectedMediaIds || []).filter((id) => !idSet.has(id));

      for (const project of state.cache.projects || []) {
        const selected = (project.config?.selectedMediaIds || []).filter((id) => !idSet.has(id));
        let nextPlan = project.config?.montagePlan || null;
        if (nextPlan?.timeline) {
          nextPlan = {
            ...nextPlan,
            selectedMediaIds: (nextPlan.selectedMediaIds || []).filter((id) => !idSet.has(id)),
            timeline: (nextPlan.timeline || []).filter((item) => !idSet.has(item.mediaId))
          };
        }
        const finalRemoved = idSet.has(project.config?.finalVideoMediaId);
        await projectPut({
          ...project,
          updatedAt: typeof nowISO === 'function' ? nowISO() : new Date().toISOString(),
          config: {
            ...project.config,
            selectedMediaIds: selected,
            montagePlan: nextPlan,
            finalVideoMediaId: finalRemoved ? null : project.config?.finalVideoMediaId,
            renderStatus: finalRemoved ? 'draft' : project.config?.renderStatus,
            renderError: finalRemoved ? '' : project.config?.renderError
          }
        });
      }

      await saveMusicDraft?.();
      await saveSpeechDraft?.();
      await saveSoraDraft?.();
    } catch (error) {
      console.warn('Nettoyage références bloc incomplet:', error);
    }
  }

  async function emptyBlock(blockName, removeCustomAfter = false) {
    const block = norm(blockName);
    const bucket = currentBucket();
    const targets = (state.cache.media || []).filter((item) => item.bucket === bucket && norm(item.block || 'Vrac') === block);

    if (!targets.length && !removeCustomAfter) {
      toast('Bloc déjà vide.');
      return;
    }

    const message = targets.length
      ? `Supprimer ${targets.length} fichier(s) du bloc "${block}" ?`
      : `Supprimer le bloc vide "${block}" ?`;
    if (!window.confirm(message)) return;

    const ids = targets.map((item) => item.id);
    for (const item of targets) await mediaDelete(item.id);
    if (ids.length) await cleanReferencesAfterMediaDelete(ids);

    if (removeCustomAfter) {
      state.customBlocks = (state.customBlocks || []).filter((name) => norm(name) !== block);
      await saveCustomBlocks();
    }

    await hydrateCache();
    try { renderLibraryGrid(); } catch {}
    render();
    toast(removeCustomAfter ? 'Bloc supprimé.' : 'Bloc vidé.');
  }

  document.addEventListener('click', async (event) => {
    const emptyBtn = event.target?.closest?.('[data-library-empty-block]');
    const deleteBtn = event.target?.closest?.('[data-library-delete-block]');
    if (emptyBtn) {
      event.preventDefault();
      event.stopPropagation();
      await emptyBlock(emptyBtn.dataset.libraryEmptyBlock, false);
    }
    if (deleteBtn) {
      event.preventDefault();
      event.stopPropagation();
      await emptyBlock(deleteBtn.dataset.libraryDeleteBlock, true);
    }
  }, true);

  setInterval(() => {
    try { injectTabs(); } catch (error) { console.warn('Library tabs V48:', error); }
  }, 550);

  console.log(`Bibliothèque en onglets active ${VERSION}.`);
})();
