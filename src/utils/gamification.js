const getXPNeeded = (level) => {
  return 100 + (level - 1) * 75;
};

const calculateLevelTitle = (reviewsCount) => {
  if (reviewsCount >= 500) return "Divindade do Cinema";
  if (reviewsCount >= 250) return "Entidade Cinematográfica";
  if (reviewsCount >= 100) return "Oráculo da Sétima Arte";
  if (reviewsCount >= 50) return "Mestre da Crítica";
  if (reviewsCount >= 20) return "Cinéfilo Experiente";
  if (reviewsCount >= 10) return "Cinéfilo";
  if (reviewsCount >= 5) return "Crítico Iniciante";
  return "Espectador";
};

const TROPHIES_LIST = [
  { id: "wat_10", title: "Iniciando a Coleção", criteria: "watched", threshold: 10, icon: "Play" },
  { id: "wat_50", title: "Maratonista de Respeito", criteria: "watched", threshold: 50, icon: "Flame" },
  { id: "wat_100", title: "Cinéfilo Dedicado", criteria: "watched", threshold: 100, icon: "MonitorPlay" },
  { id: "wat_500", title: "Viciado em Telas", criteria: "watched", threshold: 500, icon: "Film" },
  { id: "wat_1000", title: "Olhos de Titânio", criteria: "watched", threshold: 1000, icon: "Eye" },
  { id: "rev_1", title: "Primeira de Muitas", criteria: "reviews", threshold: 1, icon: "PenTool" },
  { id: "rev_10", title: "Crítico em Ascensão", criteria: "reviews", threshold: 10, icon: "Zap" },
  { id: "rev_50", title: "Lenda das Reviews", criteria: "reviews", threshold: 50, icon: "Crown" },
  { id: "rev_100", title: "A Voz da Razão", criteria: "reviews", threshold: 100, icon: "Mic2" },
  { id: "rev_500", title: "O Próprio Roteiro", criteria: "reviews", threshold: 500, icon: "Feather" },
  { id: "xp_1000", title: "Veterano do CineSorte", criteria: "totalXp", threshold: 1000, icon: "Shield" },
  { id: "xp_5000", title: "Mestre do XP", criteria: "totalXp", threshold: 5000, icon: "ShieldCheck" },
  { id: "xp_20000", title: "Lenda Viva", criteria: "totalXp", threshold: 20000, icon: "Star" },
  { id: "soc_10", title: "Popular na Roda", criteria: "followers", threshold: 10, icon: "Users" },
  { id: "soc_100", title: "Influenciador", criteria: "followers", threshold: 100, icon: "Radio" },
  { id: "soc_1000", title: "Celebridade", criteria: "followers", threshold: 1000, icon: "Camera" },
  { id: "vet_1", title: "Novato Promissor", criteria: "accountAge", threshold: 1, icon: "Baby" },
  { id: "vet_6", title: "Habitué do Cinema", criteria: "accountAge", threshold: 6, icon: "Coffee" },
  { id: "vet_12", title: "Veterano Real", criteria: "accountAge", threshold: 12, icon: "Medal" },
  { id: "vet_36", title: "Ancestral", criteria: "accountAge", threshold: 36, icon: "Hourglass" }
];

const checkTrophies = (userData, type, value) => {
  const newTrophies = [];
  const currentTrophyIds = new Set((userData.trophies || []).map((t) => t.id));

  TROPHIES_LIST.forEach((t) => {
    if (t.criteria === type && !currentTrophyIds.has(t.id) && value >= t.threshold) {
      newTrophies.push({
        id: t.id,
        title: t.title,
        icon: t.icon,
        awardedAt: new Date(),
      });
    }
  });

  if (userData.createdAt) {
      const createdAt = userData.createdAt.toDate ? userData.createdAt.toDate() : new Date(userData.createdAt);
      const now = new Date();
      const diffMonths = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24 * 30));

      TROPHIES_LIST.forEach((t) => {
        if (t.criteria === 'accountAge' && !currentTrophyIds.has(t.id) && diffMonths >= t.threshold) {
          newTrophies.push({
            id: t.id,
            title: t.title,
            icon: t.icon,
            awardedAt: new Date(),
          });
        }
      });
  }
  return newTrophies;
};

module.exports = { getXPNeeded, checkTrophies, calculateLevelTitle };