/* V45 - Retour version stable : désactive l'ancien bloc Incrustation finale */
(function () {
  function removeOldBox() {
    document.getElementById('forceBurnSubtitlesBox')?.remove();
    [...document.querySelectorAll('.result-box')].forEach((box) => {
      const text = box.textContent || '';
      if (text.includes('Incrustation finale') && text.includes('Refaire la transcription')) box.remove();
    });
  }

  document.addEventListener('click', (event) => {
    const target = event.target?.closest?.('[data-action="force-burn-subtitles"]');
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    removeOldBox();
  }, true);

  setInterval(removeOldBox, 700);
  console.log('Watchdog sous-titres V45 : ancien bloc Incrustation finale désactivé, retour au module OpenAI stable.');
})();
