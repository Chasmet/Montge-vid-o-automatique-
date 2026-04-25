/*
  Pack visuel final - logique d'icônes contextuelles
  Ajoute des pictos et des ambiances selon le nom des blocs, sans utiliser d'images.
*/

const VISUAL_THEME_RULES = [
  { keys: ["voiture", "auto", "car", "course", "racing", "moto", "route"], icon: "🚗", cls: "ux-theme-car" },
  { keys: ["temps", "heure", "duree", "durée", "chrono", "minute", "horloge"], icon: "⏱️", cls: "ux-theme-time" },
  { keys: ["sora", "ia", "ai", "grok", "veo", "prompt", "future", "futur"], icon: "✨", cls: "ux-theme-ai" },
  { keys: ["musique", "music", "rap", "clip", "son", "audio", "chanson"], icon: "🎵", cls: "ux-theme-music" },
  { keys: ["foot", "football", "sport", "psg", "ballon", "entrainement"], icon: "⚽", cls: "ux-theme-sport" },
  { keys: ["horreur", "horror", "peur", "zombie", "clown", "dark", "sombre"], icon: "🌒", cls: "ux-theme-horror" },
  { keys: ["famille", "family", "enfant", "yvane", "nelvyn", "nelvin", "perso", "moi"], icon: "👤", cls: "ux-theme-family" },
  { keys: ["instagram", "tiktok", "reseau", "réseau", "short", "reels", "youtube"], icon: "📱", cls: "ux-theme-social" },
  { keys: ["nature", "foret", "forêt", "animal", "loup", "neige", "mer", "plage"], icon: "🌿", cls: "ux-theme-nature" },
  { keys: ["space", "espace", "spatial", "sci", "science", "fiction", "planete", "planète", "mars", "lune"], icon: "🚀", cls: "ux-theme-space" }
];

function visualNormalize(value) {
  return (value || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function visualThemeFor(text) {
  const clean = visualNormalize(text);

  for (const rule of VISUAL_THEME_RULES) {
    if (rule.keys.some((key) => clean.includes(visualNormalize(key)))) {
      return rule;
    }
  }

  return { icon: "📁", cls: "ux-theme-auto" };
}

function visualClearThemeClasses(el) {
  if (!el) return;
  el.classList.remove(
    "ux-theme-auto",
    "ux-theme-car",
    "ux-theme-time",
    "ux-theme-sora",
    "ux-theme-ai",
    "ux-theme-music",
    "ux-theme-sport",
    "ux-theme-horror",
    "ux-theme-family",
    "ux-theme-social",
    "ux-theme-nature",
    "ux-theme-space"
  );
}

function visualEnhanceFolderRows() {
  document.querySelectorAll(".ux-row-card").forEach((card) => {
    const name = card.querySelector(".ux-name")?.textContent || "";
    const path = card.querySelector(".ux-path")?.textContent || "";
    const icon = card.querySelector(".ux-icon");
    const theme = visualThemeFor(`${name} ${path}`);

    if (icon) {
      icon.textContent = theme.icon;
      visualClearThemeClasses(icon);
      icon.classList.add(theme.cls);
    }
  });
}

function visualEnhanceAlbums() {
  document.querySelectorAll(".ux-album").forEach((album) => {
    const name = album.querySelector(".ux-album-name")?.textContent || "";
    const icon = album.querySelector(".ux-album-icon");

    if (name.toLowerCase().includes("tous")) {
      if (icon) icon.textContent = "📚";
      return;
    }

    const theme = visualThemeFor(name);

    if (icon) {
      icon.textContent = theme.icon;
      visualClearThemeClasses(icon);
      icon.classList.add(theme.cls);
    }

    visualClearThemeClasses(album);
    album.classList.add(theme.cls);
  });
}

function visualEnhanceLibraryCards() {
  document.querySelectorAll(".media-card").forEach((card) => {
    const text = card.textContent || "";
    const theme = visualThemeFor(text);
    card.dataset.visualTheme = theme.cls.replace("ux-theme-", "");
  });
}

function visualEnhanceButtons() {
  const labels = [
    ["Importer", "⬆️"],
    ["Voir", "👁️"],
    ["Masquer", "🙈"],
    ["Créer", "✍️"],
    ["Actualiser", "🔄"],
    ["Télécharger", "⬇️"],
    ["Supprimer", "🗑️"],
    ["Copier", "📋"],
    ["Ouvrir", "📂"],
    ["Rendu", "🎞️"],
    ["vidéo", "🎬"],
    ["voix", "🎤"],
    ["musique", "🎵"]
  ];

  document.querySelectorAll("button").forEach((button) => {
    if (button.dataset.visualDone === "1") return;
    const txt = button.textContent.trim();
    if (!txt) return;
    if (/^[\p{Emoji}\p{Extended_Pictographic}]/u.test(txt)) {
      button.dataset.visualDone = "1";
      return;
    }

    const found = labels.find(([word]) => visualNormalize(txt).includes(visualNormalize(word)));
    if (!found) return;

    button.textContent = `${found[1]} ${txt}`;
    button.dataset.visualDone = "1";
  });
}

function visualEnhanceResultBoxes() {
  document.querySelectorAll(".result-box-head h3").forEach((title) => {
    if (title.dataset.visualDone === "1") return;
    const clean = visualNormalize(title.textContent);
    let icon = "✨";

    if (clean.includes("media") || clean.includes("média")) icon = "🗂️";
    if (clean.includes("sous-titre")) icon = "💬";
    if (clean.includes("meta") || clean.includes("réseaux") || clean.includes("reseaux")) icon = "📱";
    if (clean.includes("analyse")) icon = "🧠";
    if (clean.includes("montage")) icon = "🎞️";
    if (clean.includes("video") || clean.includes("vidéo")) icon = "🎬";
    if (clean.includes("voix")) icon = "🎤";

    title.textContent = `${icon} ${title.textContent}`;
    title.dataset.visualDone = "1";
  });
}

function visualRun() {
  visualEnhanceFolderRows();
  visualEnhanceAlbums();
  visualEnhanceLibraryCards();
  visualEnhanceButtons();
  visualEnhanceResultBoxes();
}

setInterval(() => {
  try {
    visualRun();
  } catch (error) {
    console.warn("Pack visuel", error);
  }
}, 500);

window.addEventListener("load", visualRun);
