/* V42 - Outil séparé CapCut : limite taille + mode rapide audio/SRT OpenAI */
(function () {
  const VERSION = 'V42';
  const MAX_VIDEO_MB = 260;
  const MAX_VIDEO_BYTES = MAX_VIDEO_MB * 1024 * 1024;
  const WARNING_VIDEO_MB = 180;
  let busy = false;
  let panelOpen = false;
  let selectedVideo = null;
  let selectedAudio = null;
  let selectedVideoUrl = '';
  let lastResultBlob = null;
  let lastResultUrl = '';
  let lastSrt = '';
  let statusText = '';

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
  function mb(file) { return file ? file.size / 1024 / 1024 : 0; }
  function mbText(file) { return file ? `${mb(file).toFixed(1)} Mo` : '0 Mo'; }
  function videoTooHeavy() { return selectedVideo && selectedVideo.size > MAX_VIDEO_BYTES; }
  function videoWarning() { return selectedVideo && selectedVideo.size > WARNING_VIDEO_MB * 1024 * 1024 && selectedVideo.size <= MAX_VIDEO_BYTES; }

  function setStatus(text) {
    statusText = text || '';
    refreshPanel();
    if (text) toast(text);
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

  function rebaseSrtToZero(srt) {
    if (!looksLikeSrt(srt)) return srt || '';
    const first = clean(srt).match(/(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->/);
    const offset = first ? srtTimeToSeconds(first[1]) : 0;
    if (!offset || offset < 0.35) return srt;
    return srt.replace(/(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/g, (_full, start, end) => {
      return `${secondsToSrtTime(srtTimeToSeconds(start) - offset)} --> ${secondsToSrtTime(srtTimeToSeconds(end) - offset)}`;
    });
  }

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
        <p>Mode vidéo sous-titrée ou mode rapide audio/SRT OpenAI.</p>
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
      .capcut-alert{border:1px solid rgba(251,191,36,.35);background:rgba(251,191,36,.08);border-radius:16px;padding:12px;margin:10px 0;}
      .capcut-alert-danger{border-color:rgba(248,113,113,.45);background:rgba(248,113,113,.1);}
      .capcut-status{border:1px solid rgba(34,197,94,.35);background:rgba(34,197,94,.08);border-radius:16px;padding:12px;margin:10px 0;}
    `;
    document.head.appendChild(style);
  }

  function sizeMessage() {
    if (!selectedVideo) return '';
    if (videoTooHeavy()) {
      return `<div class="capcut-alert capcut-alert-danger"><strong>Vidéo trop lourde : ${mbText(selectedVideo)}</strong><br>Maximum app : ${MAX_VIDEO_MB} Mo. Ta vidéo fait plus de 2 Go : Render ne pourra pas traiter ça depuis téléphone. Exporte dans CapCut en 720p ou 1080p compressé, ou utilise le mode rapide audio/SRT.</div>`;
    }
    if (videoWarning()) {
      return `<div class="capcut-alert"><strong>Vidéo lourde : ${mbText(selectedVideo)}</strong><br>Ça peut passer, mais ce sera lent. Recommandé : moins de 180 Mo.</div>`;
    }
    return `<div class="capcut-status">Taille OK : ${mbText(selectedVideo)}.</div>`;
  }

  function renderPanelContent() {
    const fileName = selectedVideo?.name || 'Aucune vidéo choisie';
    const audioName = selectedAudio?.name || 'Aucun audio choisi';
    const ratio = localStorage.getItem('capcut_subtitle_ratio') || 'vertical';
    const style = localStorage.getItem('capcut_subtitle_style') || 'classic';
    const canCreateVideo = selectedVideo && !busy && !videoTooHeavy();
    const canCreateSrt = selectedAudio && !busy;

    return `
      <div class="capcut-panel-head">
        <div>
          <p class="eyebrow">Outil séparé</p>
          <h2>🎞️ Sous-titres OpenAI pour vidéo CapCut</h2>
          <p class="small-note">Cette case ne touche pas au montage IA. Elle sert seulement à sous-titrer une vidéo complète ou à créer un SRT rapide depuis l’audio.</p>
        </div>
        <button type="button" class="capcut-close" data-action="close-capcut-openai-panel" aria-label="Fermer">×</button>
      </div>

      ${statusText ? `<div class="capcut-status">${statusText}</div>` : ''}

      <div class="result-box">
        <div class="result-box-head"><h3>🎬 Mode vidéo sous-titrée</h3></div>
        <label class="field"><span>Vidéo complète CapCut</span><input id="capcutVideoInput" type="file" accept="video/*" /></label>
        <p class="small-note">Fichier : ${fileName}${selectedVideo ? ` - ${mbText(selectedVideo)}` : ''}</p>
        ${sizeMessage()}
        ${selectedVideoUrl ? `<video class="capcut-preview" controls playsinline preload="metadata" src="${selectedVideoUrl}"></video>` : ''}
        <div class="grid two">
          <label class="field"><span>Format vidéo</span><select id="capcutAspectRatio">${orientationOptions(ratio)}</select></label>
          <label class="field"><span>Style sous-titres</span><select id="capcutSubtitleStyle">${styleOptions(style)}</select></label>
        </div>
        <div class="prompt-actions"><button type="button" class="primary-btn" data-action="capcut-openai-subtitle" ${canCreateVideo ? '' : 'disabled'}>${busy ? 'Traitement en cours...' : 'Créer vidéo sous-titrée OpenAI'}</button></div>
        <p class="small-note">Pour ce mode, vise moins de 180 Mo. Maximum bloqué : ${MAX_VIDEO_MB} Mo.</p>
      </div>

      <div class="result-box">
        <div class="result-box-head"><h3>⚡ Mode rapide SRT uniquement</h3></div>
        <p class="small-note">Solution rapide : exporte seulement l’audio depuis CapCut, upload l’audio ici, OpenAI génère un fichier SRT complet. Ensuite tu peux l’utiliser dans CapCut ou garder le texte.</p>
        <label class="field"><span>Audio du clip complet</span><input id="capcutAudioInput" type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.webm" /></label>
        <p class="small-note">Audio : ${audioName}${selectedAudio ? ` - ${mbText(selectedAudio)}` : ''}</p>
        <div class="prompt-actions"><button type="button" class="secondary-btn" data-action="capcut-create-srt-only" ${canCreateSrt ? '' : 'disabled'}>${busy ? 'Traitement en cours...' : 'Créer SRT OpenAI rapide'}</button></div>
      </div>

      ${lastResultUrl ? `
        <div class="capcut-mini-result">
          <h3>✅ Vidéo sous-titrée prête</h3>
          <video class="capcut-preview" controls playsinline preload="metadata" src="${lastResultUrl}"></video>
          <div class="prompt-actions"><button type="button" class="primary-btn" data-action="capcut-download-final">Télécharger la vidéo sous-titrée</button></div>
        </div>
      ` : ''}

      ${lastSrt ? `
        <div class="capcut-mini-result">
          <h3>✅ SRT OpenAI prêt</h3>
          <div class="prompt-actions">
            <button type="button" class="primary-btn" data-action="capcut-download-srt">Télécharger le SRT</button>
            <button type="button" class="secondary-btn" data-action="capcut-copy-srt">Copier le SRT</button>
          </div>
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

  function downloadBlob(blob, fileName) {
    if (typeof triggerDownloadBlob === 'function') return triggerDownloadBlob(blob, fileName);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

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

  async function createSrtFromFile(file) {
    const style = document.getElementById('capcutSubtitleStyle')?.value || localStorage.getItem('capcut_subtitle_style') || 'classic';
    const aspectRatio = document.getElementById('capcutAspectRatio')?.value || localStorage.getItem('capcut_subtitle_ratio') || 'vertical';
    const form = new FormData();
    form.append('audio', file, file.name || 'audio.mp3');
    form.append('subtitleStyle', style);
    form.append('subtitleSyncMode', 'normal');
    form.append('aspectRatio', aspectRatio);
    form.append('forceTimelineZero', '1');
    form.append('audioStartSec', '0');
    form.append('audioEndSec', '0');
    const response = await fetch(`${BACKEND_BASE_URL}/api/transcribe/srt`, { method: 'POST', body: form });
    let data = null;
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data?.error || 'Transcription OpenAI impossible.');
    const srt = rebaseSrtToZero(data?.srt || '');
    if (!looksLikeSrt(srt)) throw new Error('OpenAI a répondu, mais le SRT est invalide.');
    return srt;
  }

  async function createSrtOnly() {
    if (busy) return;
    if (!selectedAudio) return toast('Choisis d’abord un fichier audio.');
    busy = true;
    setStatus('OpenAI crée le SRT depuis l’audio...');
    try {
      lastSrt = await createSrtFromFile(selectedAudio);
      setStatus('SRT OpenAI prêt.');
    } catch (error) {
      console.error(error);
      toast(error.message || 'Erreur SRT OpenAI.');
    } finally {
      busy = false;
      refreshPanel();
    }
  }

  async function createSubtitledVideo() {
    if (busy) return;
    if (!selectedVideo) return toast('Choisis d’abord une vidéo CapCut.');
    if (videoTooHeavy()) return toast(`Vidéo trop lourde : ${mbText(selectedVideo)}. Maximum ${MAX_VIDEO_MB} Mo.`);
    busy = true;
    setStatus('Upload vers Render, puis OpenAI transcrit...');

    try {
      const style = document.getElementById('capcutSubtitleStyle')?.value || localStorage.getItem('capcut_subtitle_style') || 'classic';
      const aspectRatio = document.getElementById('capcutAspectRatio')?.value || localStorage.getItem('capcut_subtitle_ratio') || 'vertical';
      localStorage.setItem('capcut_subtitle_style', style);
      localStorage.setItem('capcut_subtitle_ratio', aspectRatio);

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
      setStatus('Vidéo CapCut sous-titrée prête.');
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
      statusText = file && file.size > MAX_VIDEO_BYTES ? `Vidéo trop lourde : ${mbText(file)}. Exporte en 720p/1080p compressé ou utilise le mode rapide SRT.` : '';
      refreshPanel();
    }
    if (event.target?.id === 'capcutAudioInput') {
      selectedAudio = event.target.files?.[0] || null;
      lastSrt = '';
      statusText = selectedAudio ? `Audio prêt : ${selectedAudio.name} - ${mbText(selectedAudio)}.` : '';
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
    if (action === 'capcut-create-srt-only') await createSrtOnly();
    if (action === 'capcut-download-final') {
      if (!lastResultBlob) return toast('Aucune vidéo prête.');
      downloadBlob(lastResultBlob, `${safeName(selectedVideo?.name || 'video_capcut')}_openai_sous_titres.mp4`);
    }
    if (action === 'capcut-download-srt') {
      if (!lastSrt) return toast('Aucun SRT prêt.');
      downloadBlob(new Blob([lastSrt], { type: 'text/plain;charset=utf-8' }), `${safeName(selectedAudio?.name || 'audio_capcut')}_openai.srt`);
    }
    if (action === 'capcut-copy-srt') {
      if (!lastSrt) return toast('Aucun SRT prêt.');
      await navigator.clipboard.writeText(lastSrt);
      toast('SRT copié.');
    }
  });

  setInterval(injectCard, 900);
  console.log(`Outil séparé CapCut sous-titres OpenAI actif ${VERSION}.`);
})();
