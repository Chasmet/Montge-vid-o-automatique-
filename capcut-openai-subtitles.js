/* V41 - Outil séparé CapCut : upload unique backend + sous-titres OpenAI complets */
(function () {
  const VERSION = 'V41';
  let busy = false;
  let panelOpen = false;
  let selectedVideo = null;
  let selectedVideoUrl = '';
  let lastResultBlob = null;
  let lastResultUrl = '';

  function ready() {
    try {
      return typeof state !== 'undefined' && typeof render === 'function' && typeof BACKEND_BASE_URL !== 'undefined';
    } catch {
      return false;
    }
  }

  function toast(message) {
    if (typeof showToast === 'function') showToast(message);
    else alert(message);
  }

  function clean(value) { return (value || '').toString().trim(); }
  function safeName(value) { return clean(value || 'video_capcut').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80) || 'video_capcut'; }
  function revokeUrl(url) { if (url) { try { URL.revokeObjectURL(url); } catch {} } }

  function styleOptions(selected = 'classic') {
    return `
      <option value="classic" ${selected === 'classic' ? 'selected' : ''}>Classique propre</option>
      <option value="rap" ${selected === 'rap' ? 'selected' : ''}>Rap / clip officiel</option>
      <option value="tiktok" ${selected === 'tiktok' ? 'selected' : ''}>TikTok dynamique</option>
      <option value="cinema" ${selected === 'cinema' ? 'selected' : ''}>Cinéma sombre</option>
    `;
  }

  function orientationOptions(selected = 'vertical') {
    return `
      <option value="vertical" ${selected === 'vertical' ? 'selected' : ''}>Vertical 9:16</option>
      <option value="horizontal" ${selected === 'horizontal' ? 'selected' : ''}>Horizontal 16:9</option>
    `;
  }

  function injectCard() {
    if (!ready()) return;
    if (state.route !== 'dashboard') return;
    if (document.getElementById('capcutOpenAiCard')) return;
    const grid = document.querySelector('#screen .app-grid') || document.querySelector('#screen');
    if (!grid) return;

    const card = document.createElement('button');
    card.id = 'capcutOpenAiCard';
    card.type = 'button';
    card.className = 'profile-card dashboard-card result-box';
    card.setAttribute('data-action', 'open-capcut-openai-panel');
    card.style.textAlign = 'left';
    card.style.width = '100%';
    card.innerHTML = `
      <div class="profile-icon">🎞️</div>
      <div>
        <h3>Sous-titres CapCut</h3>
        <p>Upload unique. OpenAI transcrit toute la vidéo et Render incruste directement.</p>
      </div>
      <span class="small-note">Outil séparé</span>
    `;
    grid.appendChild(card);
  }

  function ensurePanelStyles() {
    if (document.getElementById('capcutOpenAiStyles')) return;
    const style = document.createElement('style');
    style.id = 'capcutOpenAiStyles';
    style.textContent = `
      .capcut-panel-backdrop{position:fixed;inset:0;z-index:9999;background:rgba(2,6,23,.82);backdrop-filter:blur(12px);display:flex;align-items:flex-end;justify-content:center;padding:12px;}
      .capcut-panel{width:100%;max-width:720px;max-height:92vh;overflow:auto;border:1px solid rgba(148,163,184,.25);border-radius:24px;background:var(--panel,#0f172a);box-shadow:0 24px 80px rgba(0,0,0,.45);padding:16px;}
      .capcut-panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:12px;}
      .capcut-panel-head h2{margin:0;font-size:1.2rem;}
      .capcut-close{min-width:44px;height:44px;border-radius:999px;border:1px solid rgba(148,163,184,.25);background:rgba(15,23,42,.9);color:inherit;font-size:1.2rem;}
      .capcut-preview{width:100%;max-height:360px;border-radius:18px;background:#000;margin:10px 0;}
      .capcut-mini-result{margin-top:14px;padding-top:14px;border-top:1px solid rgba(148,163,184,.18);}
    `;
    document.head.appendChild(style);
  }

  function renderPanelContent() {
    const fileName = selectedVideo?.name || 'Aucune vidéo choisie';
    const ratio = localStorage.getItem('capcut_subtitle_ratio') || 'vertical';
    const style = localStorage.getItem('capcut_subtitle_style') || 'classic';
    const sizeMo = selectedVideo ? (selectedVideo.size / 1024 / 1024).toFixed(1) : '0';

    return `
      <div class="capcut-panel-head">
        <div>
          <p class="eyebrow">Outil séparé</p>
          <h2>🎞️ Sous-titres OpenAI pour vidéo CapCut</h2>
          <p class="small-note">Cette case ne touche pas au montage IA. Elle sert seulement à sous-titrer une vidéo complète déjà montée.</p>
        </div>
        <button type="button" class="capcut-close" data-action="close-capcut-openai-panel" aria-label="Fermer">×</button>
      </div>

      <label class="field"><span>Vidéo complète CapCut</span><input id="capcutVideoInput" type="file" accept="video/*" /></label>
      <p class="small-note">Fichier : ${fileName}${selectedVideo ? ` - ${sizeMo} Mo` : ''}</p>
      ${selectedVideoUrl ? `<video class="capcut-preview" controls playsinline preload="metadata" src="${selectedVideoUrl}"></video>` : ''}

      <div class="grid two">
        <label class="field"><span>Format vidéo</span><select id="capcutAspectRatio">${orientationOptions(ratio)}</select></label>
        <label class="field"><span>Style sous-titres</span><select id="capcutSubtitleStyle">${styleOptions(style)}</select></label>
      </div>

      <div class="prompt-actions">
        <button type="button" class="primary-btn" data-action="capcut-openai-subtitle" ${selectedVideo && !busy ? '' : 'disabled'}>${busy ? 'Traitement en cours...' : 'Créer vidéo sous-titrée OpenAI'}</button>
      </div>
      <p class="small-note">Nouveau mode : un seul upload vers Render. Render extrait l’audio, OpenAI transcrit, puis FFmpeg incruste les sous-titres.</p>

      ${lastResultUrl ? `
        <div class="capcut-mini-result">
          <h3>✅ Vidéo sous-titrée prête</h3>
          <video class="capcut-preview" controls playsinline preload="metadata" src="${lastResultUrl}"></video>
          <div class="prompt-actions"><button type="button" class="primary-btn" data-action="capcut-download-final">Télécharger la vidéo sous-titrée</button></div>
        </div>
      ` : ''}
    `;
  }

  function openPanel() {
    ensurePanelStyles();
    panelOpen = true;
    let backdrop = document.getElementById('capcutOpenAiPanelBackdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'capcutOpenAiPanelBackdrop';
      backdrop.className = 'capcut-panel-backdrop';
      backdrop.innerHTML = `<section class="capcut-panel" id="capcutOpenAiPanel"></section>`;
      document.body.appendChild(backdrop);
    }
    const panel = document.getElementById('capcutOpenAiPanel');
    if (panel) panel.innerHTML = renderPanelContent();
  }

  function closePanel() { panelOpen = false; document.getElementById('capcutOpenAiPanelBackdrop')?.remove(); }
  function refreshPanel() { if (panelOpen) openPanel(); }

  async function saveMedia(blob, fileName) {
    if (typeof mediaPut !== 'function' || typeof uid !== 'function') return null;
    const media = {
      id: uid('capcut_subtitled'), owner: state.profile || 'admin', bucket: 'project-video', mediaType: 'video', fileName,
      mimeType: 'video/mp4', size: blob.size || 0, createdAt: typeof nowISO === 'function' ? nowISO() : new Date().toISOString(),
      block: 'Vrac', orientation: (localStorage.getItem('capcut_subtitle_ratio') || 'vertical') === 'horizontal' ? 'horizontal' : 'vertical',
      tags: ['capcut', 'openai', 'sous-titres'], blob
    };
    await mediaPut(media);
    if (typeof hydrateCache === 'function') await hydrateCache();
    return media;
  }

  async function createSubtitledVideo() {
    if (busy) return;
    if (!selectedVideo) return toast('Choisis d’abord une vidéo CapCut.');
    busy = true;
    refreshPanel();

    try {
      const style = document.getElementById('capcutSubtitleStyle')?.value || localStorage.getItem('capcut_subtitle_style') || 'classic';
      const aspectRatio = document.getElementById('capcutAspectRatio')?.value || localStorage.getItem('capcut_subtitle_ratio') || 'vertical';
      localStorage.setItem('capcut_subtitle_style', style);
      localStorage.setItem('capcut_subtitle_ratio', aspectRatio);

      toast('Upload unique vers Render, puis OpenAI transcrit...');
      const form = new FormData();
      form.append('video', selectedVideo, selectedVideo.name || 'video_capcut.mp4');
      form.append('subtitleStyle', style);
      form.append('aspectRatio', aspectRatio);

      const response = await fetch(`${BACKEND_BASE_URL}/api/capcut/openai-subtitles`, { method: 'POST', body: form });
      if (!response.ok) {
        let msg = 'Sous-titrage CapCut impossible.';
        try { const data = await response.json(); msg = data?.error || msg; } catch {}
        throw new Error(msg);
      }

      const finalBlob = await response.blob();
      if (!finalBlob || finalBlob.size < 1000) throw new Error('Render a renvoyé une vidéo vide.');
      lastResultBlob = finalBlob;
      revokeUrl(lastResultUrl);
      lastResultUrl = URL.createObjectURL(finalBlob);

      const outputName = `${safeName(selectedVideo.name.replace(/\.[^.]+$/, ''))}_openai_sous_titres.mp4`;
      await saveMedia(finalBlob, outputName);
      toast('Vidéo CapCut sous-titrée prête.');
    } catch (error) {
      console.error(error);
      toast(error.message || 'Erreur outil CapCut OpenAI.');
    } finally {
      busy = false;
      refreshPanel();
    }
  }

  document.addEventListener('change', (event) => {
    if (event.target?.id === 'capcutVideoInput') {
      const file = event.target.files?.[0] || null;
      selectedVideo = file;
      revokeUrl(selectedVideoUrl);
      selectedVideoUrl = file ? URL.createObjectURL(file) : '';
      revokeUrl(lastResultUrl);
      lastResultUrl = '';
      lastResultBlob = null;
      refreshPanel();
    }
    if (event.target?.id === 'capcutSubtitleStyle') localStorage.setItem('capcut_subtitle_style', event.target.value || 'classic');
    if (event.target?.id === 'capcutAspectRatio') localStorage.setItem('capcut_subtitle_ratio', event.target.value || 'vertical');
  });

  document.addEventListener('click', async (event) => {
    const action = event.target?.closest?.('[data-action]')?.dataset?.action;
    if (!action) return;
    if (action === 'open-capcut-openai-panel') openPanel();
    if (action === 'close-capcut-openai-panel') closePanel();
    if (action === 'capcut-openai-subtitle') await createSubtitledVideo();
    if (action === 'capcut-download-final') {
      if (!lastResultBlob) return toast('Aucune vidéo prête.');
      if (typeof triggerDownloadBlob === 'function') triggerDownloadBlob(lastResultBlob, `${safeName(selectedVideo?.name || 'video_capcut')}_openai_sous_titres.mp4`);
      else { const a = document.createElement('a'); a.href = lastResultUrl; a.download = `${safeName(selectedVideo?.name || 'video_capcut')}_openai_sous_titres.mp4`; a.click(); }
    }
  });

  setInterval(injectCard, 900);
  console.log(`Outil séparé CapCut sous-titres OpenAI actif ${VERSION}.`);
})();
