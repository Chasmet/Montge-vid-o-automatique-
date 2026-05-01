/* V39 - Outil CapCut : upload vidéo complète puis sous-titres OpenAI complets */
(function () {
  const VERSION = 'V39';
  let busy = false;
  let selectedVideo = null;
  let selectedVideoUrl = '';
  let lastResultBlob = null;
  let lastResultUrl = '';
  let lastSrt = '';

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

  function clean(value) {
    return (value || '').toString().trim();
  }

  function safeName(value) {
    return clean(value || 'video_capcut').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80) || 'video_capcut';
  }

  function revokeUrl(url) {
    if (url) {
      try { URL.revokeObjectURL(url); } catch {}
    }
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

  function renderToolBox() {
    const fileName = selectedVideo?.name || 'Aucune vidéo choisie';
    return `
      <section class="result-box" id="capcutOpenAiSubtitlesBox">
        <div class="result-box-head"><h3>🎞️ Sous-titres OpenAI pour vidéo CapCut</h3></div>
        <p class="small-note">Tu fais ton clip complet dans CapCut, tu l’uploades ici, puis OpenAI transcrit toute la vidéo et Render incruste les sous-titres dans un nouveau MP4.</p>

        <label class="field">
          <span>Vidéo complète CapCut</span>
          <input id="capcutVideoInput" type="file" accept="video/*" />
        </label>

        <p class="small-note">Fichier : ${fileName}</p>

        ${selectedVideoUrl ? `
          <video class="result-video" controls playsinline preload="metadata" src="${selectedVideoUrl}"></video>
        ` : ''}

        <div class="grid two">
          <label class="field">
            <span>Format vidéo</span>
            <select id="capcutAspectRatio">${orientationOptions(localStorage.getItem('capcut_subtitle_ratio') || 'vertical')}</select>
          </label>
          <label class="field">
            <span>Style sous-titres</span>
            <select id="capcutSubtitleStyle">${styleOptions(localStorage.getItem('capcut_subtitle_style') || 'classic')}</select>
          </label>
        </div>

        <div class="prompt-actions">
          <button type="button" class="primary-btn" data-action="capcut-openai-subtitle" ${selectedVideo && !busy ? '' : 'disabled'}>
            ${busy ? 'Traitement en cours...' : 'Créer vidéo sous-titrée OpenAI'}
          </button>
        </div>

        ${lastResultUrl ? `
          <div class="result-box mini-box">
            <div class="result-box-head"><h3>✅ Vidéo sous-titrée prête</h3></div>
            <video class="result-video" controls playsinline preload="metadata" src="${lastResultUrl}"></video>
            <div class="prompt-actions">
              <button type="button" class="primary-btn" data-action="capcut-download-final">Télécharger la vidéo sous-titrée</button>
              <button type="button" class="secondary-btn" data-action="capcut-copy-srt">Copier le SRT OpenAI</button>
            </div>
          </div>
        ` : ''}
      </section>
    `;
  }

  function injectBox() {
    if (!ready()) return;
    if (!['dashboard', 'projects'].includes(state.route)) return;
    if (document.getElementById('capcutOpenAiSubtitlesBox')) return;
    const target = document.querySelector('#screen .app-grid') || document.querySelector('#screen');
    if (!target) return;
    target.insertAdjacentHTML('afterbegin', renderToolBox());
  }

  function refreshBox() {
    const old = document.getElementById('capcutOpenAiSubtitlesBox');
    if (old) old.outerHTML = renderToolBox();
    else injectBox();
  }

  async function saveMedia(blob, fileName) {
    if (typeof mediaPut !== 'function' || typeof uid !== 'function') return null;
    const media = {
      id: uid('capcut_subtitled'),
      owner: state.profile || 'admin',
      bucket: 'project-video',
      mediaType: 'video',
      fileName,
      mimeType: 'video/mp4',
      size: blob.size || 0,
      createdAt: typeof nowISO === 'function' ? nowISO() : new Date().toISOString(),
      block: 'Vrac',
      orientation: (localStorage.getItem('capcut_subtitle_ratio') || 'vertical') === 'horizontal' ? 'horizontal' : 'vertical',
      tags: ['capcut', 'openai', 'sous-titres'],
      blob
    };
    await mediaPut(media);
    if (typeof hydrateCache === 'function') await hydrateCache();
    return media;
  }

  async function createSubtitledVideo() {
    if (busy) return;
    if (!selectedVideo) return toast('Choisis d’abord une vidéo CapCut.');

    busy = true;
    refreshBox();

    try {
      const style = document.getElementById('capcutSubtitleStyle')?.value || localStorage.getItem('capcut_subtitle_style') || 'classic';
      const aspectRatio = document.getElementById('capcutAspectRatio')?.value || localStorage.getItem('capcut_subtitle_ratio') || 'vertical';
      localStorage.setItem('capcut_subtitle_style', style);
      localStorage.setItem('capcut_subtitle_ratio', aspectRatio);

      toast('OpenAI transcrit toute la vidéo CapCut...');
      const transcribeForm = new FormData();
      transcribeForm.append('audio', selectedVideo, selectedVideo.name || 'video_capcut.mp4');
      transcribeForm.append('subtitleStyle', style);
      transcribeForm.append('subtitleSyncMode', 'normal');
      transcribeForm.append('aspectRatio', aspectRatio);
      transcribeForm.append('forceTimelineZero', '1');
      transcribeForm.append('audioStartSec', '0');
      transcribeForm.append('audioEndSec', '0');

      const transcribeResponse = await fetch(`${BACKEND_BASE_URL}/api/transcribe/srt`, {
        method: 'POST',
        body: transcribeForm
      });

      let transcribeData = null;
      try { transcribeData = await transcribeResponse.json(); } catch {}
      if (!transcribeResponse.ok) throw new Error(transcribeData?.error || 'Transcription OpenAI impossible.');

      const srt = rebaseSrtToZero(transcribeData?.srt || '');
      if (!looksLikeSrt(srt)) throw new Error('OpenAI a répondu, mais les sous-titres sont invalides.');
      lastSrt = srt;

      toast('Render incruste les sous-titres dans la vidéo...');
      const burnForm = new FormData();
      burnForm.append('video', selectedVideo, selectedVideo.name || 'video_capcut.mp4');
      burnForm.append('srt', srt);
      burnForm.append('subtitleStyle', style);
      burnForm.append('subtitleSyncMode', 'normal');
      burnForm.append('aspectRatio', aspectRatio);
      burnForm.append('source', 'openai_capcut_full_video');

      const burnResponse = await fetch(`${BACKEND_BASE_URL}/api/subtitles/burn-video`, {
        method: 'POST',
        body: burnForm
      });

      if (!burnResponse.ok) {
        let msg = 'Incrustation impossible.';
        try {
          const data = await burnResponse.json();
          msg = data?.error || msg;
        } catch {}
        throw new Error(msg);
      }

      const finalBlob = await burnResponse.blob();
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
      refreshBox();
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
      lastSrt = '';
      refreshBox();
    }

    if (event.target?.id === 'capcutSubtitleStyle') {
      localStorage.setItem('capcut_subtitle_style', event.target.value || 'classic');
    }

    if (event.target?.id === 'capcutAspectRatio') {
      localStorage.setItem('capcut_subtitle_ratio', event.target.value || 'vertical');
    }
  });

  document.addEventListener('click', async (event) => {
    const action = event.target?.closest?.('[data-action]')?.dataset?.action;
    if (!action) return;

    if (action === 'capcut-openai-subtitle') {
      await createSubtitledVideo();
    }

    if (action === 'capcut-download-final') {
      if (!lastResultBlob) return toast('Aucune vidéo prête.');
      if (typeof triggerDownloadBlob === 'function') {
        triggerDownloadBlob(lastResultBlob, `${safeName(selectedVideo?.name || 'video_capcut')}_openai_sous_titres.mp4`);
      } else {
        const a = document.createElement('a');
        a.href = lastResultUrl;
        a.download = `${safeName(selectedVideo?.name || 'video_capcut')}_openai_sous_titres.mp4`;
        a.click();
      }
    }

    if (action === 'capcut-copy-srt') {
      if (!lastSrt) return toast('Aucun SRT prêt.');
      if (typeof copyText === 'function') await copyText(lastSrt);
      else {
        await navigator.clipboard.writeText(lastSrt);
        toast('SRT copié.');
      }
    }
  });

  setInterval(injectBox, 900);
  console.log(`Outil CapCut sous-titres OpenAI complet actif ${VERSION}.`);
})();
