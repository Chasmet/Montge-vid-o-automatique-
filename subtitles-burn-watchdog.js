/* V28 - Surveillance finale : si les sous-titres sont prêts, ils sont vraiment incrustés dans la vidéo */
(function () {
  const running = new Set();

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

  function cleanText(value) {
    return (value || '').toString().replace(/\s+/g, ' ').trim();
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

  function looksLikeSrt(text) {
    return /\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(text || '');
  }

  function normalizeSegments(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map((item, index) => {
        const text = cleanText(item.text || item.caption || item.subtitle || item.line || item.value || '');
        const start = Number(item.start ?? item.startSec ?? item.from ?? item.begin ?? index * 3);
        const end = Number(item.end ?? item.endSec ?? item.to ?? item.finish ?? start + 3);
        return { text, start, end };
      })
      .filter((item) => item.text && Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start);
  }

  function segmentsToSrt(segments) {
    return segments
      .map((seg, index) => `${index + 1}\n${secondsToSrtTime(seg.start)} --> ${secondsToSrtTime(seg.end)}\n${seg.text}`)
      .join('\n\n');
  }

  function srtFromProject(project) {
    const cfg = project?.config || {};
    if (looksLikeSrt(cfg.openAiSrt)) return cfg.openAiSrt;
    if (looksLikeSrt(cfg.srt)) return cfg.srt;
    if (looksLikeSrt(cfg.subtitles?.srt)) return cfg.subtitles.srt;

    const segmentSources = [
      cfg.openAiSegments,
      cfg.subtitleSegments,
      cfg.subtitles?.segments,
      cfg.subtitles?.items,
      cfg.subtitles?.cues,
      cfg.analysis?.subtitles,
      cfg.analysis?.subtitleSegments
    ];

    for (const source of segmentSources) {
      const segments = normalizeSegments(source);
      if (segments.length) return segmentsToSrt(segments);
    }

    const plain = cleanText(cfg.openAiText || cfg.subtitles?.plainText || cfg.subtitles?.text || cfg.transcription || '');
    if (plain) {
      const duration = Number(cfg.duration || cfg.audioDuration || cfg.videoDuration || cfg.targetDuration || 20);
      return `1\n${secondsToSrtTime(0)} --> ${secondsToSrtTime(Math.max(3, duration || 20))}\n${plain}`;
    }

    return '';
  }

  function assFromProject(project) {
    const cfg = project?.config || {};
    return cleanText(cfg.openAiAss || cfg.ass || cfg.subtitles?.ass || '');
  }

  function getBaseVideoId(project) {
    const cfg = project?.config || {};
    return (
      cfg.subtitleBaseVideoMediaId ||
      cfg.enhancedVideoMediaId ||
      cfg.cleanVideoMediaId ||
      cfg.originalFinalVideoMediaId ||
      cfg.finalVideoMediaId ||
      ''
    );
  }

  function shouldWaitForEnhance(project) {
    const cfg = project?.config || {};
    const mode = cfg.videoSharpnessMode || 'normal';
    if (mode === 'normal') return false;
    if (cfg.enhancedVideoMediaId || cfg.subtitleBaseVideoMediaId) return false;
    return true;
  }

  async function burnSubtitles(project) {
    const cfg = project.config || {};
    const srt = srtFromProject(project);
    const ass = assFromProject(project);
    if (!srt && !ass) return null;

    const baseVideoId = getBaseVideoId(project);
    const baseVideo = await getMedia(baseVideoId);
    if (!baseVideo?.blob) return null;

    const style = cfg.subtitleStyle || cfg.subtitledStyle || 'rap';
    const syncMode = cfg.subtitleSyncMode || cfg.subtitledSyncMode || 'normal';

    const form = new FormData();
    form.append('video', baseVideo.blob, baseVideo.fileName || 'video.mp4');
    form.append('srt', srt);
    if (ass) form.append('ass', ass);
    form.append('subtitleStyle', style);
    form.append('subtitleSyncMode', syncMode);
    form.append('aspectRatio', cfg.aspectRatio || 'vertical');

    toast('Sous-titres prêts : incrustation dans la vidéo...');

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
      tags: ['sous-titres', style, syncMode, 'final'],
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
        openAiSrt: cfg.openAiSrt || srt,
        openAiAss: cfg.openAiAss || ass,
        subtitleBaseVideoMediaId: baseVideoId,
        subtitledVideoMediaId: media.id,
        subtitledStyle: style,
        subtitledSyncMode: syncMode,
        finalVideoMediaId: media.id,
        renderStatus: 'done',
        renderError: ''
      }
    };

    await saveProject(next);
    state.currentResultId = next.id;
    if (typeof render === 'function') render();
    toast('Vidéo finale avec sous-titres prête.');
    return next;
  }

  async function watchdog() {
    if (!ready() || state.route !== 'result') return;
    const project = activeProject();
    if (!project || !['music', 'speech'].includes(project.type)) return;
    const cfg = project.config || {};
    if (cfg.subtitlesEnabled === false) return;
    if (cfg.renderStatus !== 'done') return;
    if (!cfg.finalVideoMediaId) return;
    if (cfg.subtitledVideoMediaId && cfg.finalVideoMediaId === cfg.subtitledVideoMediaId) return;
    if (shouldWaitForEnhance(project)) return;

    const srt = srtFromProject(project);
    const ass = assFromProject(project);
    if (!srt && !ass) return;

    const baseId = getBaseVideoId(project);
    const key = `${project.id}_${baseId}_${cfg.subtitleStyle || 'rap'}_${cfg.subtitleSyncMode || 'normal'}_${srt.length}_${ass.length}`;
    if (running.has(key)) return;
    running.add(key);

    try {
      await burnSubtitles(project);
    } catch (error) {
      console.error(error);
      toast(error.message || 'Erreur incrustation sous-titres.');
    }
  }

  document.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-action="force-burn-subtitles"]');
    if (!target) return;
    const project = activeProject();
    if (!project) return;
    try {
      await burnSubtitles(project);
    } catch (error) {
      console.error(error);
      toast(error.message || 'Erreur incrustation sous-titres.');
    }
  });

  setInterval(watchdog, 1200);
  console.log('Watchdog incrustation sous-titres actif V28.');
})();
