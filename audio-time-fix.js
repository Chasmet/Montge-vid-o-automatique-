/*
  Saisie simple des temps audio
  Exemples acceptés :
  7 = 7 secondes
  45 = 45 secondes
  1.10 = 1 min 10
  3.02 = 3 min 02
  3.50 = 3 min 50
  3:50 = 3 min 50
  3m50 = 3 min 50
*/

(function () {
  const MAX_RANGE_SECONDS = 300;

  const configs = {
    music: {
      startId: "musicStartTime",
      endId: "musicEndTime",
      startLabelId: "musicStartLabel",
      endLabelId: "musicEndLabel",
      rangeLabelId: "musicRangeLabel",
      getDuration: () => Number(state?.temp?.musicAudioDuration || 0),
      getDraft: () => state.temp.musicDraft,
      actionIds: [
        "musicPilotBtn",
        "musicAnalyzeBtn",
        "musicIdeasBtn",
        "musicMetaBtn"
      ],
      formId: "musicProjectForm"
    },
    sora: {
      startId: "soraStartTime",
      endId: "soraEndTime",
      startLabelId: "soraStartLabel",
      endLabelId: "soraEndLabel",
      rangeLabelId: "soraRangeLabel",
      getDuration: () => Number(state?.temp?.soraAudioDuration || 0),
      getDraft: () => state.temp.soraDraft,
      actionIds: [],
      formId: "soraForm"
    }
  };

  function cleanText(value) {
    return (value || "").toString().trim().toLowerCase().replaceAll(",", ".");
  }

  function parseSmartTime(value) {
    const raw = cleanText(value);
    if (!raw) return { ok: true, seconds: 0 };

    const compact = raw.replace(/\s+/g, "");

    let match = compact.match(/^(\d+)m(?:in)?(\d{1,2})?s?$/);
    if (match) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2] || 0);
      if (seconds >= 60) return { ok: false, error: "Les secondes doivent être entre 00 et 59." };
      return { ok: true, seconds: minutes * 60 + seconds };
    }

    match = compact.match(/^(\d+)[:.](\d{1,2})$/);
    if (match) {
      const minutes = Number(match[1]);
      const secondText = match[2];
      const seconds = Number(secondText.length === 1 ? secondText.padStart(2, "0") : secondText);
      if (seconds >= 60) return { ok: false, error: "Format invalide. Exemple correct : 3.50 pour 3 min 50." };
      return { ok: true, seconds: minutes * 60 + seconds };
    }

    if (/^\d+$/.test(compact)) {
      return { ok: true, seconds: Number(compact) };
    }

    return { ok: false, error: "Format invalide. Utilise 7, 1.10, 3.50 ou 3:50." };
  }

  function formatSmartTime(seconds) {
    const safe = Math.max(0, Math.round(Number(seconds || 0)));
    if (safe < 60) return `${safe} s`;
    const min = Math.floor(safe / 60);
    const sec = safe % 60;
    return sec ? `${min} min ${String(sec).padStart(2, "0")}` : `${min} min`;
  }

  function getConfigFromInput(input) {
    return Object.values(configs).find((config) => input && [config.startId, config.endId].includes(input.id));
  }

  function getConfigFromAction(target) {
    return Object.values(configs).find((config) => {
      if (!target) return false;
      if (config.formId && target.id === config.formId) return true;
      return config.actionIds.includes(target.id);
    });
  }

  function ensureHint(input, type) {
    if (!input) return null;
    const id = `${input.id}SmartHint`;
    let hint = document.getElementById(id);

    if (!hint) {
      hint = document.createElement("div");
      hint.id = id;
      hint.className = "smart-time-hint";
      input.insertAdjacentElement("afterend", hint);
    }

    hint.dataset.type = type || "normal";
    return hint;
  }

  function setHint(input, message, type = "normal") {
    const hint = ensureHint(input, type);
    if (!hint) return;
    hint.textContent = message || "Format accepté : 7, 1.10, 3.50, 3:50";
    hint.classList.toggle("error", type === "error");
  }

  function prepareInputs() {
    Object.values(configs).forEach((config) => {
      const startInput = document.getElementById(config.startId);
      const endInput = document.getElementById(config.endId);

      [startInput, endInput].forEach((input) => {
        if (!input) return;
        if (input.dataset.smartTimeReady === "1") return;

        input.type = "text";
        input.inputMode = "decimal";
        input.autocomplete = "off";
        input.placeholder = input.id.includes("End") ? "Ex : 3.50" : "Ex : 7";
        input.dataset.smartTimeReady = "1";

        setHint(input, "Format : 7 = 7 s, 3.50 = 3 min 50");
      });
    });
  }

  function applySmartTime(config) {
    if (!config) return { ok: true };

    const startInput = document.getElementById(config.startId);
    const endInput = document.getElementById(config.endId);
    if (!startInput || !endInput) return { ok: true };

    const startParsed = parseSmartTime(startInput.value);
    const endParsed = parseSmartTime(endInput.value);

    if (!startParsed.ok) {
      setHint(startInput, startParsed.error, "error");
      return { ok: false, error: startParsed.error };
    }

    if (!endParsed.ok) {
      setHint(endInput, endParsed.error, "error");
      return { ok: false, error: endParsed.error };
    }

    const audioDuration = config.getDuration();
    const maxAudio = audioDuration > 0 ? audioDuration : Number.POSITIVE_INFINITY;

    const start = Math.min(Math.max(0, startParsed.seconds), maxAudio);
    const end = Math.min(Math.max(0, endParsed.seconds), maxAudio);
    const range = Math.max(0, end - start);

    const draft = config.getDraft();
    draft.start = start;
    draft.end = end;

    const startLabel = document.getElementById(config.startLabelId);
    const endLabel = document.getElementById(config.endLabelId);
    const rangeLabel = document.getElementById(config.rangeLabelId);

    if (startLabel) startLabel.textContent = formatSmartTime(start);
    if (endLabel) endLabel.textContent = formatSmartTime(end);
    if (rangeLabel) rangeLabel.textContent = formatSmartTime(range);

    setHint(startInput, `Compris : ${formatSmartTime(start)}`);
    setHint(endInput, `Compris : ${formatSmartTime(end)}`);

    if (end <= start) {
      setHint(endInput, "La fin doit être après le début. Exemple : début 7, fin 3.50", "error");
      return { ok: false, error: "La fin doit être après le début." };
    }

    if (range > MAX_RANGE_SECONDS) {
      setHint(endInput, "Maximum autorisé : 5 minutes.", "error");
      return { ok: false, error: "Maximum autorisé : 5 minutes." };
    }

    return { ok: true, start, end, range };
  }

  function convertForOriginalHandlers(config) {
    const validation = applySmartTime(config);
    if (!validation.ok) return validation;

    const startInput = document.getElementById(config.startId);
    const endInput = document.getElementById(config.endId);
    if (!startInput || !endInput) return validation;

    const originalStart = startInput.value;
    const originalEnd = endInput.value;

    startInput.value = String(validation.start);
    endInput.value = String(validation.end);

    setTimeout(() => {
      if (document.body.contains(startInput)) startInput.value = originalStart;
      if (document.body.contains(endInput)) endInput.value = originalEnd;
      applySmartTime(config);
    }, 80);

    return validation;
  }

  function installGlobalListeners() {
    if (window.__audioTimeFixInstalled) return;
    window.__audioTimeFixInstalled = true;

    document.addEventListener("input", (event) => {
      const config = getConfigFromInput(event.target);
      if (!config) return;
      setTimeout(() => applySmartTime(config), 0);
    }, true);

    document.addEventListener("change", (event) => {
      const config = getConfigFromInput(event.target);
      if (!config) return;
      setTimeout(() => applySmartTime(config), 0);
    }, true);

    document.addEventListener("click", (event) => {
      const target = event.target.closest("button");
      const config = getConfigFromAction(target);
      if (!config) return;

      const result = convertForOriginalHandlers(config);
      if (!result.ok) {
        event.preventDefault();
        event.stopImmediatePropagation();
        try { showToast(result.error); } catch {}
      }
    }, true);

    document.addEventListener("submit", (event) => {
      const config = getConfigFromAction(event.target);
      if (!config) return;

      const result = convertForOriginalHandlers(config);
      if (!result.ok) {
        event.preventDefault();
        event.stopImmediatePropagation();
        try { showToast(result.error); } catch {}
      }
    }, true);
  }

  function boot() {
    prepareInputs();
    Object.values(configs).forEach(applySmartTime);
    installGlobalListeners();
  }

  const observer = new MutationObserver(() => {
    clearTimeout(observer._timer);
    observer._timer = setTimeout(boot, 50);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  window.addEventListener("pageshow", boot);
  setTimeout(boot, 100);
  setTimeout(boot, 700);
})();
