/* V18.2 - Matching titre / médias
   Objectif : choisir les vidéos/images qui correspondent mieux au titre du projet. */
(function () {
  const VERSION = "V18.2";

  const STOP_WORDS = new Set([
    "le", "la", "les", "un", "une", "des", "du", "de", "d", "et", "ou", "a", "à", "au", "aux",
    "en", "dans", "sur", "pour", "avec", "sans", "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses",
    "clip", "officiel", "official", "lyrics", "lyric", "video", "vidéo", "music", "musique", "feat", "ft"
  ]);

  const MOOD_KEYWORDS = {
    sombre: ["sombre", "noir", "nuit", "ombre", "dark", "froid", "solitude", "seul", "triste", "peur"],
    rap: ["rap", "street", "rue", "urbain", "ghetto", "quartier", "freestyle", "drill", "trap"],
    emotion: ["coeur", "cœur", "amour", "pleure", "douleur", "maman", "famille", "souvenir", "fragile"],
    luxe: ["billet", "argent", "cash", "revolution", "révolution", "victoire", "roi", "boss"],
    cinema: ["cinema", "cinéma", "epique", "épique", "film", "dramatique", "hero", "héros"],
    futur: ["futur", "spatial", "espace", "robot", "cyber", "ia", "neon", "néon"]
  };

  function clean(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function tokens(value) {
    return clean(value)
      .replace(/[^a-z0-9#]+/g, " ")
      .split(/\s+/)
      .map(v => v.trim())
      .filter(v => v.length >= 3 && !STOP_WORDS.has(v));
  }

  function titleMood(title) {
    const text = clean(title);
    const moods = [];
    for (const [mood, words] of Object.entries(MOOD_KEYWORDS)) {
      if (words.some(w => text.includes(clean(w)))) moods.push(mood);
    }
    return moods;
  }

  function mediaText(media) {
    return clean([
      media?.fileName,
      media?.name,
      media?.title,
      media?.block,
      media?.category,
      media?.collection,
      ...(Array.isArray(media?.tags) ? media.tags : [])
    ].filter(Boolean).join(" "));
  }

  function scoreMediaForTitle(media, title) {
    const titleTokens = tokens(title);
    const moods = titleMood(title);
    const text = mediaText(media);
    let score = 0;

    for (const token of titleTokens) {
      if (text.includes(token)) score += 10;
    }

    for (const mood of moods) {
      const words = MOOD_KEYWORDS[mood] || [];
      if (words.some(w => text.includes(clean(w)))) score += 18;
    }

    const block = clean(media?.block || "");
    if (moods.includes("rap") && /(moi|vrac|urbain|rap|street|clip)/.test(block)) score += 8;
    if (moods.includes("sombre") && /(horreur|sombre|vrac|moi)/.test(block)) score += 8;
    if (moods.includes("futur") && /(science|fiction|fantaisie|futur)/.test(block)) score += 8;
    if (moods.includes("emotion") && /(documentaire|moi|vrac)/.test(block)) score += 6;

    if (media?.mediaType === "video") score += 4;
    if (media?.orientation === "vertical") score += 2;

    return score;
  }

  function sortByTitleMatch(list, title) {
    if (!Array.isArray(list) || !list.length) return list;
    const cleanTitle = String(title || "").trim();
    if (!cleanTitle) return list;

    return [...list]
      .map((media, index) => ({ media, index, score: scoreMediaForTitle(media, cleanTitle) }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map(item => item.media);
  }

  function patchFormData(fd) {
    if (!(fd instanceof FormData)) return;
    const title = fd.get("title") || fd.get("projectTitle") || fd.get("name") || "";
    if (!title) return;

    for (const key of ["candidatesJson", "mediaManifestJson", "candidates"]) {
      const raw = fd.get(key);
      if (!raw || typeof raw !== "string") continue;
      try {
        const data = JSON.parse(raw);
        if (!Array.isArray(data) || data.length < 2) continue;
        const sorted = sortByTitleMatch(data, title);
        fd.set(key, JSON.stringify(sorted));
        console.log(`Title match ${VERSION} : ${sorted.length} médias triés pour "${title}".`);
      } catch {}
    }
  }

  const previousFetch = window.fetch.bind(window);
  window.fetch = function titleMatchFetch(resource, options = {}) {
    try {
      const url = typeof resource === "string" ? resource : resource?.url || "";
      if ((url.includes("/api/project/prepare") || url.includes("/api/render/video")) && options.body instanceof FormData) {
        patchFormData(options.body);
      }
    } catch (error) {
      console.warn("title-match-engine", error);
    }
    return previousFetch(resource, options);
  };

  window.scoreMediaForTitle = scoreMediaForTitle;
  window.sortMediaByTitleMatch = sortByTitleMatch;

  console.log(`Title match engine ${VERSION} actif : les médias sont triés selon le titre.`);
})();
