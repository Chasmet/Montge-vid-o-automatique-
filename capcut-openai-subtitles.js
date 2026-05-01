/* V44 - Outil séparé sous-titres : gros fichier automatique en 1 clic */
(function () {
  const VERSION = 'V44';
  const CHUNK_SIZE = 320 * 1024 * 1024; // environ 320 Mo par morceau, sous 500 Mo
  const MAX_DIRECT_VIDEO_MB = 260;
  const MAX_DIRECT_VIDEO_BYTES = MAX_DIRECT_VIDEO_MB * 1024 * 1024;
  let busy = false;
  let panelOpen = false;
  let selectedVideo = null;
  let selectedAudio = null;
  let selectedVideoUrl = '';
  let lastResultBlob = null;
  let lastResultUrl = '';
  let lastSrt = '';
  let statusText = '';
  let progressText = '';

  function ready() {
    try { return typeof state !== 'undefined' && typeof render === 'function' && typeof BACKEND_BASE_URL !== 'undefined'; }
    catch { return false; }
  }

  function toast(message) { if (typeof showToast === 'function') showToast(message); else alert(message); }
  function clean(value) { return (value || '').toString().trim(); }
  function safeName(value) { return clean(value || 'video').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80) || 'video'; }
  function revokeUrl(url) { if (url) { try { URL.revokeObjectURL(url); } catch {} } }
  function mb(file) { return file ? file.size / 1024 / 1024 : 0; }
  function mbText(file) { return file ? `${mb(file).toFixed(1)} Mo` : '0 Mo'; }
  function videoTooHeavyForDirect() { return selectedVideo && selectedVideo.size > MAX_DIRECT_VIDEO_BYTES; }
  function chunkCount(file) { return file ? Math.ceil(file.size / CHUNK_SIZE) : 0; }

  function setStatus(text, progress = '') {
    statusText = text || '';
    progressText = progress || '';
    refreshPanel();
    if (text) toast(text);
  }

  function looksLikeSrt(text) { return /\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(text || ''); }
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
    return srt.replace(/(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/g, (_full, start, end) => `${secondsToSrtTime(srtTimeToSeconds(start) - offset)} --> ${secondsToSrtTime(srtTimeToSeconds(end) - offset)}`);
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
    if (!ready() || state.route !== 'dashboard' || document.getElementById('capcutOpenAiCard')) return;
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
      <div><h3>Sous-titres vidéo</h3><p>Gros fichier automatique : vidéo + audio, 1 clic.</p></div>
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
      .capcut-status{border:1px solid rgba(34,197,94,.35);background:rgba(34,197,94,.08);border-radius:16px;padding:12px;margin:10px 0;}
      .capcut-progress{height:12px;border-radius:999px;background:rgba(148,163,184,.18);overflow:hidden;margin:8px 0;}
      .capcut-progress > span{display:block;height:100%;width:var(--p,0%);background:linear-gradient(90deg,#22c55e,#38bdf8);}
    `;
    document.head.appendChild(style);
  }

  function sizeMessage() {
    if (!selectedVideo) return '';
    const count = chunkCount(selectedVideo);
    if (videoTooHeavyForDirect()) {
      return `<div class="capcut-alert"><strong>Gros fichier détecté : ${mbText(selectedVideo)}</strong><br>Mode conseillé : gros fichier automatique. L’application enverra la vidéo en ${count} morceaux, puis Render reconstruira la vidéo finale.</div>`;
    }
    return `<div class="capcut-status">Taille vidéo OK : ${mbText(selectedVideo)}. Tu peux utiliser le mode direct ou le mode gros fichier.</div>`;
  }

  function renderPanelContent() {
    const fileName = selectedVideo?.name || 'Aucune vidéo choisie';
    const audioName = selectedAudio?.name || 'Aucun audio choisi';
    const ratio = localStorage.getItem('capcut_subtitle_ratio') || 'vertical';
    const subStyle = localStorage.getItem('capcut_subtitle_style') || 'classic';
    const canLarge = selectedVideo && selectedAudio && !busy;
    const canDirect = selectedVideo && selectedAudio && !busy && !videoTooHeavyForDirect();
    const canSrt = selectedAudio && !busy;

    return `
      <div class="capcut-panel-head">
        <div>
          <p class="eyebrow">Outil séparé</p>
          <h2>🎞️ Sous-titres OpenAI pour grosse vidéo</h2>
          <p class="small-note">Tu sélectionnes la vidéo + l’audio, tu cliques une fois. L’application s’occupe du découpage, de l’upload, d’OpenAI et de la reconstruction.</p>
        </div>
        <button type="button" class="capcut-close" data-action="close-capcut-openai-panel" aria-label="Fermer">×</button>
      </div>
      ${statusText ? `<div class="capcut-status"><strong>${statusText}</strong>${progressText ? `<div class="capcut-progress"><span style="--p:${progressText}"></span></div><p class="small-note">Progression : ${progressText}</p>` : ''}</div>` : ''}

      <div class="result-box">
        <div class="result-box-head"><h3>🚀 Gros fichier automatique</h3></div>
        <label class="field"><span>Vidéo complète</span><input id="capcutVideoInput" type="file" accept="video/*" /></label>
        <p class="small-note">Vidéo : ${fileName}${selectedVideo ? ` - ${mbText(selectedVideo)} - ${chunkCount(selectedVideo)} morceau(x)` : ''}</p>
        ${sizeMessage()}
        ${selectedVideoUrl ? `<video class="capcut-preview" controls playsinline preload="metadata" src="${selectedVideoUrl}"></video>` : ''}
        <label class="field"><span>Audio complet du même clip</span><input id="capcutAudioInput" type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.webm" /></label>
        <p class="small-note">Audio : ${audioName}${selectedAudio ? ` - ${mbText(selectedAudio)}` : ''}</p>
        <div class="grid two">
          <label class="field"><span>Format vidéo</span><select id="capcutAspectRatio">${orientationOptions(ratio)}</select></label>
          <label class="field"><span>Style sous-titres</span><select id="capcutSubtitleStyle">${styleOptions(subStyle)}</select></label>
        </div>
        <div class="prompt-actions"><button type="button" class="primary-btn" data-action="capcut-large-auto" ${canLarge ? '' : 'disabled'}>${busy ? 'Traitement en cours...' : 'Lancer gros fichier automatique'}</button></div>
        <p class="small-note">1 clic : l’app envoie les morceaux puis Render reconstruit, segmente, incruste et renvoie le MP4 final.</p>
      </div>

      <div class="result-box">
        <div class="result-box-head"><h3>⚡ Mode direct vidéo légère</h3></div>
        <p class="small-note">Pour vidéo légère seulement, moins de ${MAX_DIRECT_VIDEO_MB} Mo.</p>
        <div class="prompt-actions"><button type="button" class="secondary-btn" data-action="capcut-openai-audio-video" ${canDirect ? '' : 'disabled'}>${busy ? 'Traitement en cours...' : 'Créer directement vidéo sous-titrée'}</button></div>
      </div>

      <div class="result-box">
        <div class="result-box-head"><h3>📝 SRT uniquement</h3></div>
        <p class="small-note">OpenAI crée seulement le fichier SRT depuis l’audio.</p>
        <div class="prompt-actions"><button type="button" class="secondary-btn" data-action="capcut-create-srt-only" ${canSrt ? '' : 'disabled'}>${busy ? 'Traitement en cours...' : 'Créer SRT OpenAI'}</button></div>
      </div>

      ${lastResultUrl ? `<div class="capcut-mini-result"><h3>✅ Vidéo finale prête</h3><video class="capcut-preview" controls playsinline preload="metadata" src="${lastResultUrl}"></video><div class="prompt-actions"><button type="button" class="primary-btn" data-action="capcut-download-final">Télécharger la vidéo sous-titrée</button></div></div>` : ''}
      ${lastSrt ? `<div class="capcut-mini-result"><h3>✅ SRT OpenAI prêt</h3><div class="prompt-actions"><button type="button" class="primary-btn" data-action="capcut-download-srt">Télécharger le SRT</button><button type="button" class="secondary-btn" data-action="capcut-copy-srt">Copier le SRT</button></div></div>` : ''}
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
    const media = { id: uid('large_subtitled'), owner: state.profile || 'admin', bucket: 'project-video', mediaType: 'video', fileName, mimeType: 'video/mp4', size: blob.size || 0, createdAt: typeof nowISO === 'function' ? nowISO() : new Date().toISOString(), block: 'Vrac', orientation: (localStorage.getItem('capcut_subtitle_ratio') || 'vertical') === 'horizontal' ? 'horizontal' : 'vertical', tags: ['gros-fichier', 'openai', 'sous-titres'], blob };
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
    setStatus('OpenAI crée le SRT depuis l’audio...', '15%');
    try { lastSrt = await createSrtFromFile(selectedAudio); setStatus('SRT OpenAI prêt.', '100%'); }
    catch (error) { console.error(error); toast(error.message || 'Erreur SRT OpenAI.'); }
    finally { busy = false; refreshPanel(); }
  }

  async function directAudioVideo() {
    if (busy) return;
    if (!selectedVideo || !selectedAudio) return toast('Choisis la vidéo et l’audio.');
    if (videoTooHeavyForDirect()) return toast('Vidéo trop lourde pour le mode direct. Utilise gros fichier automatique.');
    busy = true;
    setStatus('Mode direct : upload vidéo + audio...', '10%');
    try {
      const style = document.getElementById('capcutSubtitleStyle')?.value || localStorage.getItem('capcut_subtitle_style') || 'classic';
      const aspectRatio = document.getElementById('capcutAspectRatio')?.value || localStorage.getItem('capcut_subtitle_ratio') || 'vertical';
      const form = new FormData();
      form.append('video', selectedVideo, selectedVideo.name || 'video.mp4');
      form.append('audio', selectedAudio, selectedAudio.name || 'audio.mp3');
      form.append('subtitleStyle', style);
      form.append('aspectRatio', aspectRatio);
      const response = await fetch(`${BACKEND_BASE_URL}/api/capcut/openai-subtitles-audio-video`, { method: 'POST', body: form });
      if (!response.ok) { let msg = 'Sous-titrage direct impossible.'; try { const data = await response.json(); msg = data?.error || msg; } catch {} throw new Error(msg); }
      const blob = await response.blob();
      if (!blob || blob.size < 1000) throw new Error('Render a renvoyé une vidéo vide.');
      lastResultBlob = blob;
      revokeUrl(lastResultUrl);
      lastResultUrl = URL.createObjectURL(blob);
      await saveMedia(blob, `${safeName(selectedVideo.name.replace(/\.[^.]+$/, ''))}_openai_sous_titres.mp4`);
      setStatus('Vidéo directe sous-titrée prête.', '100%');
    } catch (error) { console.error(error); toast(error.message || 'Erreur mode direct.'); }
    finally { busy = false; refreshPanel(); }
  }

  async function largeAuto() {
    if (busy) return;
    if (!selectedVideo || !selectedAudio) return toast('Choisis la vidéo et l’audio.');
    busy = true;
    try {
      const style = document.getElementById('capcutSubtitleStyle')?.value || localStorage.getItem('capcut_subtitle_style') || 'classic';
      const aspectRatio = document.getElementById('capcutAspectRatio')?.value || localStorage.getItem('capcut_subtitle_ratio') || 'vertical';
      localStorage.setItem('capcut_subtitle_style', style);
      localStorage.setItem('capcut_subtitle_ratio', aspectRatio);
      const total = chunkCount(selectedVideo);
      setStatus('Initialisation gros fichier...', '1%');
      const initResponse = await fetch(`${BACKEND_BASE_URL}/api/capcut-large/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: selectedVideo.name, size: selectedVideo.size })
      });
      const initData = await initResponse.json();
      if (!initResponse.ok || !initData?.jobId) throw new Error(initData?.error || 'Initialisation impossible.');
      const jobId = initData.jobId;

      for (let i = 0; i < total; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(selectedVideo.size, start + CHUNK_SIZE);
        const chunk = selectedVideo.slice(start, end);
        const form = new FormData();
        form.append('jobId', jobId);
        form.append('index', String(i));
        form.append('total', String(total));
        form.append('chunk', chunk, `chunk_${i}`);
        const pct = Math.round(((i + 1) / total) * 55);
        setStatus(`Envoi morceau ${i + 1} / ${total}`, `${pct}%`);
        const response = await fetch(`${BACKEND_BASE_URL}/api/capcut-large/chunk`, { method: 'POST', body: form });
        let data = null;
        try { data = await response.json(); } catch {}
        if (!response.ok) throw new Error(data?.error || `Échec envoi morceau ${i + 1}.`);
      }

      setStatus('Tous les morceaux sont envoyés. OpenAI transcrit l’audio...', '60%');
      const processForm = new FormData();
      processForm.append('jobId', jobId);
      processForm.append('total', String(total));
      processForm.append('segmentCount', String(Math.max(2, total)));
      processForm.append('audio', selectedAudio, selectedAudio.name || 'audio.mp3');
      processForm.append('subtitleStyle', style);
      processForm.append('aspectRatio', aspectRatio);
      const processResponse = await fetch(`${BACKEND_BASE_URL}/api/capcut-large/process`, { method: 'POST', body: processForm });
      if (!processResponse.ok) {
        let msg = 'Traitement gros fichier impossible.';
        try { const data = await processResponse.json(); msg = data?.error || msg; } catch {}
        throw new Error(msg);
      }
      setStatus('Téléchargement de la vidéo finale...', '90%');
      const blob = await processResponse.blob();
      if (!blob || blob.size < 1000) throw new Error('Render a renvoyé une vidéo vide.');
      lastResultBlob = blob;
      revokeUrl(lastResultUrl);
      lastResultUrl = URL.createObjectURL(blob);
      await saveMedia(blob, `${safeName(selectedVideo.name.replace(/\.[^.]+$/, ''))}_gros_fichier_openai_sous_titres.mp4`);
      setStatus('Vidéo gros fichier sous-titrée prête.', '100%');
    } catch (error) {
      console.error(error);
      toast(error.message || 'Erreur gros fichier automatique.');
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
      statusText = file ? `Vidéo prête : ${file.name} - ${mbText(file)}.` : '';
      progressText = '';
      refreshPanel();
    }
    if (event.target?.id === 'capcutAudioInput') {
      selectedAudio = event.target.files?.[0] || null;
      lastSrt = '';
      statusText = selectedAudio ? `Audio prêt : ${selectedAudio.name} - ${mbText(selectedAudio)}.` : '';
      progressText = '';
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
    if (action === 'capcut-large-auto') await largeAuto();
    if (action === 'capcut-openai-audio-video') await directAudioVideo();
    if (action === 'capcut-create-srt-only') await createSrtOnly();
    if (action === 'capcut-download-final') {
      if (!lastResultBlob) return toast('Aucune vidéo prête.');
      downloadBlob(lastResultBlob, `${safeName(selectedVideo?.name || 'video')}_openai_sous_titres.mp4`);
    }
    if (action === 'capcut-download-srt') {
      if (!lastSrt) return toast('Aucun SRT prêt.');
      downloadBlob(new Blob([lastSrt], { type: 'text/plain;charset=utf-8' }), `${safeName(selectedAudio?.name || 'audio')}_openai.srt`);
    }
    if (action === 'capcut-copy-srt') {
      if (!lastSrt) return toast('Aucun SRT prêt.');
      await navigator.clipboard.writeText(lastSrt);
      toast('SRT copié.');
    }
  });

  setInterval(injectCard, 900);
  console.log(`Outil gros fichier automatique OpenAI actif ${VERSION}.`);
})();
