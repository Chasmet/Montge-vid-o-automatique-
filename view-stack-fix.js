/*
  Correctif View Stacking / Ghosting Android
  But : empêcher les menus, cartes et listes de se réinjecter en boucle.
  Le script UX précédent vérifie l'interface toutes les 450 ms : sur certains téléphones,
  cela provoque des superpositions visuelles. Ici on stabilise l'injection.
*/

(function () {
  let lastUxKey = "";
  let lastPatchAt = 0;
  let cleanupTimer = null;

  function safe(fn) {
    try {
      return fn();
    } catch (error) {
      console.warn("View stack fix:", error);
      return null;
    }
  }

  function getUxKey() {
    return safe(() => JSON.stringify({
      route: window.state?.route || "",
      profile: window.state?.profile || "",
      libraryMode: window.state?.libraryMode || "",
      libraryType: window.state?.libraryType || "",
      libraryBlockFilter: window.state?.libraryBlockFilter || "",
      mediaCount: window.state?.cache?.media?.length || 0,
      projectCount: window.state?.cache?.projects?.length || 0,
      customBlockCount: window.state?.customBlocks?.length || 0,
      hasShell: !!document.getElementById("uxFinalShell")
    })) || String(Date.now());
  }

  function removeDuplicateElements(selector) {
    const nodes = [...document.querySelectorAll(selector)];
    if (nodes.length <= 1) return;
    nodes.slice(0, -1).forEach((node) => node.remove());
  }

  function cleanupViewStack() {
    removeDuplicateElements("#uxFinalShell");
    removeDuplicateElements("#toast");
    removeDuplicateElements("#bottomNav");
    removeDuplicateElements("#screen");

    const warnings = [...document.querySelectorAll(".ux-long-warning")];
    const seenWarningParents = new Set();
    warnings.forEach((warning) => {
      const parent = warning.parentElement;
      const key = parent ? `${parent.tagName}_${parent.textContent}` : warning.textContent;
      if (seenWarningParents.has(key)) {
        warning.remove();
      } else {
        seenWarningParents.add(key);
      }
    });

    document.querySelectorAll("select").forEach((select) => {
      select.style.backgroundColor = "#1e293b";
      select.style.color = "#ffffff";
      select.style.position = "relative";
      select.style.zIndex = "2";
    });

    document.querySelectorAll(".field, .result-box, .project-card, .media-card, .ux-row-card, .ux-album, .ux-final-card").forEach((el) => {
      el.style.position = "relative";
      el.style.isolation = "isolate";
    });
  }

  function scheduleCleanup() {
    clearTimeout(cleanupTimer);
    cleanupTimer = setTimeout(cleanupViewStack, 40);
  }

  function patchUxInject() {
    if (typeof window.uxInject !== "function") return false;
    if (window.uxInject.__stablePatched) return true;

    const originalUxInject = window.uxInject;

    window.uxInject = function stableUxInject() {
      const now = Date.now();
      const key = getUxKey();
      const shellExists = !!document.getElementById("uxFinalShell");

      // Si rien n'a changé, on ne reconstruit plus la vue.
      // Ça évite le bug d'empilement visuel sur Android Chrome.
      if (shellExists && key === lastUxKey && now - lastPatchAt < 8000) {
        cleanupViewStack();
        return;
      }

      lastUxKey = key;
      lastPatchAt = now;
      originalUxInject();
      scheduleCleanup();
    };

    window.uxInject.__stablePatched = true;
    return true;
  }

  function patchUxPatchDurationLabels() {
    if (typeof window.uxPatchDurationLabels !== "function") return false;
    if (window.uxPatchDurationLabels.__stablePatched) return true;

    const originalPatch = window.uxPatchDurationLabels;

    window.uxPatchDurationLabels = function stableDurationPatch() {
      // Ne touche pas aux menus pendant que l'utilisateur manipule un select.
      const active = document.activeElement;
      if (active && active.tagName === "SELECT") return;

      originalPatch();
      cleanupViewStack();
    };

    window.uxPatchDurationLabels.__stablePatched = true;
    return true;
  }

  function patchRender() {
    if (typeof window.render !== "function") return false;
    if (window.render.__stackPatched) return true;

    const originalRender = window.render;

    window.render = function stableRender() {
      cleanupViewStack();
      const result = originalRender.apply(this, arguments);
      scheduleCleanup();
      return result;
    };

    window.render.__stackPatched = true;
    return true;
  }

  function install() {
    patchUxInject();
    patchUxPatchDurationLabels();
    patchRender();
    cleanupViewStack();
  }

  document.addEventListener("change", (event) => {
    if (event.target && event.target.tagName === "SELECT") {
      event.target.blur();
      scheduleCleanup();
    }
  }, true);

  document.addEventListener("click", () => {
    scheduleCleanup();
  }, true);

  window.addEventListener("pageshow", install);
  window.addEventListener("resize", scheduleCleanup);
  window.addEventListener("orientationchange", scheduleCleanup);

  install();
  setTimeout(install, 300);
  setTimeout(install, 1000);
})();
