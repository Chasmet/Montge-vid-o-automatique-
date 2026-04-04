<script>
    // =============================================
    // CONSTANTS & STATE (inchangé)
    // =============================================
    const APP_NAME = "Studio vidéo IA";
    const DB_NAME = "montage-ia-mobile-v6";
    const DB_VERSION = 1;
    const ADMIN_PASSWORD_DEFAULT = "admin123";

    const BACKEND_BASE_URL = "https://montge-vid-o-automatique.onrender.com";
    const GEMINI_BACKEND_URL = "https://montge-vid-o-automatique-1.onrender.com";

    const DEFAULT_MEDIA_BLOCKS = ["Animé / Manga","Pixar / Cartoon","Vrac","Horreur","Science-fiction / Fantaisie","Moi","Documentaire"];
    const DURATION_OPTIONS = ["10", "15", "20", "25", "30"];

    const VOICE_FAMILY_LABELS = { naturel: "Naturel", emotion: "Émotion", dynamique: "Dynamique", special: "Spécial" };
    const VOICE_STYLE_GROUPS = { /* inchangé */ };

    let state = { /* exactement le même que ton ancien code */ 
      route: "profiles",
      history: [],
      profile: null,
      theme: "theme-dark",
      adminPassword: ADMIN_PASSWORD_DEFAULT,
      customBlocks: [],
      libraryMode: "music",
      libraryType: "image",
      libraryBlockFilter: "all",
      currentResultId: null,
      cache: { projects: [], media: [] },
      temp: {
        renderBusyProjectId: null,
        musicAudioFile: null, musicAudioUrl: "", musicAudioDuration: 0,
        musicAnalyzing: false, musicIdeasLoading: false, musicPilotLoading: false,
        musicAnalysis: null, musicClipIdeas: null, musicMontagePlan: null,
        musicMetaGeneral: "", musicMetaShorts: "",
        musicDraft: { id: null, name: "", start: 0, end: 0, targetDuration: "30", style: "social", mode: "video", montageMode: "auto", aspectRatio: "vertical", mediaSourceMode: "single", primaryBlock: "Vrac", allowedBlocks: ["Vrac"], selectedMediaIds: [] },

        speechGenerating: false, speechAudioBlob: null, speechAudioUrl: "",
        speechMetaGeneral: "", speechMetaShorts: "",
        speechDraft: {
          id: null, name: "", text: "", voiceFamily: "naturel", voiceStyle: "masculin-naturel",
          tone: "normal", speed: "1", mode: "video", montageMode: "auto", aspectRatio: "vertical",
          targetDuration: "30", mediaSourceMode: "single", primaryBlock: "Moi", allowedBlocks: ["Moi"],
          selectedMediaIds: [],
          // === NOUVEAUTÉ SOUS-TITRES ===
          subtitlesEnabled: true,
          subtitles: null
        },

        soraAudioFile: null, soraAudioUrl: "", soraAudioDuration: 0,
        soraDraft: { id: null, name: "", start: 0, end: 0, style: "realisme" },
        soraDuration: 10, lastSoraPrompts: []
      }
    };

    // =============================================
    // TOUT LE RESTE DE TON CODE (DB, UTILS, API, THEME, etc.) EST IDENTIQUE
    // Je ne répète pas tout ici pour ne pas faire 130 000 caractères inutiles.
    // Colle simplement tout ton ancien code jusqu'à la fonction render() et je te donne seulement les parties modifiées + les ajouts.
    // =============================================

    // =============================================
    // AJOUTS / CORRECTIONS (les seules parties qui changent)
    // =============================================

    // 1. Amélioration du pilotage IA (variété des médias)
    async function handleGenerateMontagePlan() {
      const draft = state.temp.musicDraft;
      let candidates = mapMediaCandidatesForAi("music", draft);

      if (!candidates.length) {
        showToast("Aucun média compatible trouvé.");
        return;
      }

      state.temp.musicPilotLoading = true;
      showToast("Gemini choisit les médias avec variété…");
      render();

      try {
        const response = await postGeminiJson("/api/gemini/select-media", {
          title: draft.name || "Montage musique",
          targetDurationSec: Number(draft.targetDuration),
          aspectRatio: draft.aspectRatio,
          mediaSourceMode: draft.mediaSourceMode,
          allowedBlocks: draft.allowedBlocks,
          analysis: state.temp.musicAnalysis || {},
          clipIdeas: state.temp.musicClipIdeas || {},
          candidates: candidates
        });

        if (response.ok && Array.isArray(response.selectedIds) && response.selectedIds.length) {
          draft.selectedMediaIds = response.selectedIds;
          state.temp.musicMontagePlan = {
            selectedMediaIds: response.selectedIds,
            timeline: response.timeline || [],
            transitionStyle: "fade",
            effectStyle: draft.mode === "image" ? "zoom" : "clean"
          };
          showToast("Plan varié généré par Gemini !");
        } else {
          throw new Error("Réponse Gemini vide");
        }
      } catch (e) {
        console.warn("Gemini select-media échoué → fallback diversifié", e);
        // Fallback avec vraie variété
        candidates = [...candidates].sort(() => Math.random() - 0.5);
        const diversified = candidates.slice(0, Math.min(8, candidates.length));
        draft.selectedMediaIds = diversified.map(m => m.id);
        state.temp.musicMontagePlan = buildLocalMontagePlanFromCandidates(diversified, Number(draft.targetDuration), draft.mode);
        showToast("Plan diversifié (mode local)");
      }

      await saveMusicDraft();
      state.temp.musicPilotLoading = false;
      render();
    }

    // 2. Sous-titres dans Voix IA
    async function handleGenerateSubtitles() {
      const draft = state.temp.speechDraft;
      if (!draft.text?.trim()) {
        showToast("Écris d’abord du texte !");
        return;
      }

      showToast("Gemini génère les sous-titres…");
      try {
        const res = await postGeminiJson("/api/gemini/generate-subtitles", {
          text: draft.text,
          duration: Number(draft.targetDuration || 30),
          voiceSpeed: Number(draft.speed || 1)
        });

        if (res.ok && Array.isArray(res.subtitles)) {
          draft.subtitles = res.subtitles;
          await saveSpeechDraft();
          showToast(`${res.subtitles.length} sous-titres générés`);
          render();
        } else {
          throw new Error("Réponse invalide");
        }
      } catch (e) {
        showToast("Erreur sous-titres : " + e.message);
      }
    }

    // 3. Mise à jour du template Voix IA (seule modification visuelle)
    function speechProjectTemplate() {
      const draft = state.temp.speechDraft;
      return panel("Voix IA", "Texte → voix + sous-titres automatiques (Gemini)", `
        <form id="speechProjectForm" class="stack-form">
          <label class="field"><span>Nom du projet</span><input id="speechProjectName" type="text" value="${escapeHtml(draft.name)}" /></label>
          <label class="field"><span>Texte à dire</span><textarea id="speechText" rows="5">${escapeHtml(draft.text)}</textarea></label>

          <div class="row-2">
            <label class="field"><span>Famille de voix</span><select id="speechVoiceFamily">\( {Object.keys(VOICE_FAMILY_LABELS).map(k => `<option value=" \){k}" \( {draft.voiceFamily===k?"selected":""}> \){VOICE_FAMILY_LABELS[k]}</option>`).join("")}</select></label>
            <label class="field"><span>Style</span><select id="speechVoiceStyle">\( {getStylesForFamily(draft.voiceFamily).map(s => `<option value=" \){s.id}" \( {draft.voiceStyle===s.id?"selected":""}> \){s.label}</option>`).join("")}</select></label>
          </div>

          <div class="row-2">
            <label class="field"><span>Durée finale</span><select id="speechDuration">${renderDurationOptions(draft.targetDuration)}</select></label>
            <label class="field"><span>Format</span><select id="speechAspectRatio"><option value="vertical" ${draft.aspectRatio==="vertical"?"selected":""}>Vertical</option><option value="horizontal" ${draft.aspectRatio==="horizontal"?"selected":""}>Horizontal</option></select></label>
          </div>

          <!-- Toggle sous-titres -->
          <label class="field" style="display:flex;align-items:center;gap:12px;font-size:15px;">
            <input type="checkbox" id="subtitlesEnabled" ${draft.subtitlesEnabled ? "checked" : ""} />
            <span>Ajouter sous-titres automatiques avec Gemini</span>
          </label>

          <div class="form-actions">
            <button type="button" id="btnGenerateSpeech" class="primary-btn">🗣️ Générer la voix IA</button>
            <button type="button" id="btnGenerateSubtitles" class="primary-btn">📝 Générer / Régénérer sous-titres</button>
          </div>

          \( {state.temp.speechAudioUrl ? `<audio controls src=" \){state.temp.speechAudioUrl}"></audio>` : ""}

          ${draft.subtitles && draft.subtitles.length ? `
            <div class="card-list" style="margin-top:16px;">
              <h3 style="margin-bottom:8px;">Sous-titres (${draft.subtitles.length})</h3>
              \( {draft.subtitles.map(s => `<div class="small-note"> \){s.start}s → ${s.end}s : ${escapeHtml(s.text)}</div>`).join("")}
            </div>` : ""}

          <div class="form-actions">
            <button type="button" id="btnRenderSpeechVideo" class="primary-btn big">🚀 Rendre la vidéo finale</button>
          </div>

          ${renderSelectableMediaCards("speech", draft, draft.selectedMediaIds || [])}
        </form>
      `);
    }

    // 4. Mise à jour des listeners (ajout des nouveaux boutons)
    function attachDynamicListeners() {
      // ... tout ton ancien code de listeners ...

      // Nouveaux listeners
      document.getElementById("btnGenerateSubtitles")?.addEventListener("click", handleGenerateSubtitles);

      const subToggle = document.getElementById("subtitlesEnabled");
      if (subToggle) {
        subToggle.addEventListener("change", (e) => {
          state.temp.speechDraft.subtitlesEnabled = e.target.checked;
          saveSpeechDraft();
        });
      }

      // Bouton pilotage IA musique (variété)
      document.getElementById("btnGenerateMontagePlan")?.addEventListener("click", handleGenerateMontagePlan);
    }

    // =============================================
    // Le reste de ton code (render, init, etc.) reste IDENTIQUE
    // =============================================
    // Colle simplement tout le reste de ton ancien script après ce bloc.
    // Seules les 4 parties ci-dessus ont été modifiées/ajoutées.

    console.log("%c✅ Nouveau script chargé – Variété des médias + Sous-titres Gemini activés", "color:#00d4ff;font-weight:bold");
</script>
