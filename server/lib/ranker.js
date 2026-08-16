function text(value) {
  return String(value || "").toLowerCase();
}

function cleanTerm(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function keywordTerms(query, expansions) {
  const set = new Set();
  const base = cleanTerm(query);
  if (base) set.add(base);
  for (const item of expansions || []) {
    const term = cleanTerm(item.query);
    if (term) set.add(term);
  }
  return Array.from(set).filter((term) => term.length >= 2).slice(0, 6);
}

function relevanceScore(item, terms) {
  if (!terms.length) return 0.4;
  const descriptionLead = text(item.description).slice(0, 140);
  const haystack = [
    text(item.fullName),
    text(item.name),
    descriptionLead,
    text((item.topics || []).join(" "))
  ].join(" ");
  let hits = 0;
  for (const term of terms) {
    if (haystack.includes(term)) hits += 1;
  }
  return hits / Math.min(terms.length, 4);
}

function recencyScore(updatedAt) {
  const timestamp = Date.parse(updatedAt);
  if (!timestamp) return 0.5;
  const days = Math.max(0, (Date.now() - timestamp) / 86400000);
  return Math.max(0, 1 - Math.log2(days + 1) / 9);
}

function qualityScore(item) {
  let score = 0;
  if (item.description && item.description.trim()) score += 0.4;
  if (item.license) score += 0.2;
  if (Array.isArray(item.topics) && item.topics.length) score += 0.2;
  if (item.language) score += 0.2;
  return score;
}

function daysSince(updatedAt) {
  const timestamp = Date.parse(updatedAt);
  if (!timestamp) return null;
  return Math.max(0, Math.round((Date.now() - timestamp) / 86400000));
}

function buildReason(item, relevance, starScore) {
  const parts = [];
  if (starScore >= 0.65) parts.push("综合热度高");
  else if (starScore >= 0.35) parts.push("热度不错");
  if (relevance >= 0.55) parts.push("与需求匹配度高");
  const days = daysSince(item.updatedAt);
  if (days != null && days <= 180) parts.push(`近期仍在维护（${days} 天前更新）`);
  if (parts.length < 3 && item.language) parts.push(`${item.language} 项目`);
  if (!parts.length) parts.push("综合表现靠前");
  return parts.slice(0, 3).join("，");
}

export function rankResults(results, query, expansions) {
  const terms = keywordTerms(query, expansions);
  const maxStars = Math.max(1, ...results.map((item) => item.stars || 0));

  const scored = results.map((item) => {
    const starScore = Math.log10((item.stars || 0) + 1) / Math.log10(maxStars + 1);
    const relevance = relevanceScore(item, terms);
    const recency = recencyScore(item.updatedAt);
    const quality = qualityScore(item);
    const score = starScore * 0.32 + relevance * 0.4 + recency * 0.1 + quality * 0.18;
    return {
      ...item,
      score: Number(score.toFixed(4)),
      reason: buildReason(item, relevance, starScore)
    };
  });

  scored.sort((a, b) => b.score - a.score || b.stars - a.stars);
  const pool = scored.slice();
  const recommendations = [];
  const selectedProviders = new Set();
  while (recommendations.length < 5 && pool.length) {
    let index = pool.findIndex((item) => !selectedProviders.has(item.provider));
    if (index === -1) index = 0;
    const [item] = pool.splice(index, 1);
    recommendations.push(item);
    selectedProviders.add(item.provider);
  }
  return {
    results: scored.map((item, index) => ({ ...item, rank: index + 1 })),
    recommendations: recommendations.map((item, index) => ({ ...item, rank: index + 1 }))
  };
}
