export function isAiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY || process.env.AI_API_KEY);
}

export function getAiConfig() {
  return {
    configured: isAiConfigured(),
    model: process.env.AI_MODEL || "gpt-4o-mini",
    base: process.env.AI_BASE_URL || "https://api.openai.com/v1"
  };
}

export function parseJsonContent(content) {
  const text = String(content || "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("AI 返回内容不是 JSON");
  }
  return JSON.parse(text.slice(start, end + 1));
}

export async function chatCompletion({ system, user, maxTokens = 1400, timeout = 30000 }) {
  const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
  if (!apiKey) {
    throw new Error("未配置 AI Key");
  }

  const baseUrl = String(process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = process.env.AI_MODEL || "gpt-4o-mini";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: "你只输出合法 JSON，不输出其他文字。" },
          { role: "user", content: user }
        ],
        response_format: { type: "json_object" }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`AI 接口请求失败 (${response.status}): ${body.slice(0, 200)}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    return parseJsonContent(content);
  } finally {
    clearTimeout(timer);
  }
}

export async function aiExpand(raw) {
  const data = await chatCompletion({
    system:
      "你是开源代码项目搜索策略专家，擅长把极短关键词或很长很口语化的需求，提炼成适合多个代码托管平台检索的精准搜索词。",
    user: [
      `用户想找一个开源项目，原始输入如下（可能是极短关键词，也可能是很长的口语化描述）：`,
      JSON.stringify(raw),
      "请先判断输入类型：",
      "1. 如果是极短关键词（例如“考试系统”），直接围绕它扩展同义叫法、细分场景、常见技术栈和英文说法；",
      "2. 如果是很长、很口语化的描述，先剔除铺垫、情绪、背景和无关内容，提炼出用户真正想要的项目类型、核心功能、目标场景、技术偏好；",
      "3. 不要直接把长句或整段描述当作搜索词，要从长文中提取简短的核心短语。",
      "然后生成 5 到 6 组搜索词，要求：",
      "1. 每组包含 query（中文搜索词）和 queryEn（对应英文搜索词）；",
      "2. 搜索词必须是简短、独立的短语，不要包含完整句子和口语化废话；",
      "3. 覆盖中文叫法、英文叫法、细分场景、核心技术关键词；",
      "4. 每组标注适合的平台，尽量覆盖 GitHub、Gitee、GitCode、GitLab。",
      "只返回 JSON：",
      JSON.stringify({
        expanded: [
          {
            query: "在线考试系统",
            queryEn: "online exam system",
            platforms: ["github", "gitee", "gitcode", "gitlab"],
            reason: "用户需求的核心直译"
          }
        ],
        summary: "一句话总结用户真正想找什么",
        suggestions: ["如果更看重移动端，可以补充搜索关键词"]
      })
    ].join("\n")
  });

  const rawItems = Array.isArray(data.expanded) ? data.expanded : [];
  const queries = rawItems
    .map((item) => {
      const query = typeof item === "string" ? item.trim() : String(item.query || "").trim();
      if (!query || query.length > 80) return null;
      return {
        query,
        queryEn: typeof item.queryEn === "string" ? item.queryEn.trim() : "",
        source: "AI 扩展",
        platforms: Array.isArray(item.platforms) ? item.platforms : [],
        reason: typeof item.reason === "string" ? item.reason : ""
      };
    })
    .filter(Boolean)
    .slice(0, 6);

  if (!queries.length) {
    throw new Error("AI 未返回有效搜索词");
  }

  return {
    queries,
    reason: String(data.reason || data.summary || "AI 已根据需求生成搜索策略"),
    summary: String(data.summary || ""),
    suggestions: Array.isArray(data.suggestions) ? data.suggestions.map(String).slice(0, 4) : [],
    aiMode: true
  };
}

export async function aiRecommend({ query, expansions, candidates }) {
  const candidateList = candidates.slice(0, 60).map((item, index) => ({
    index: index + 1,
    fullName: item.fullName,
    provider: item.provider,
    name: item.name,
    stars: item.stars,
    language: item.language,
    updatedAt: item.updatedAt,
    topics: (item.topics || []).slice(0, 4),
    description: String(item.description || "").slice(0, 100)
  }));

  const data = await chatCompletion({
    system:
      "你是开源项目选型专家，能判断一个仓库是否真的符合用户需求，而不是只看 Star 数量。用户原始需求可能很长，请忽略口语化铺垫，只按核心功能判断。",
    user: [
      `用户需求：${JSON.stringify(query)}`,
      `AI 生成的搜索词：${JSON.stringify(
        (expansions || []).map((item) => ({
          zh: item.query,
          en: item.queryEn || ""
        }))
      )}`,
      `聚合搜索得到的候选仓库：${JSON.stringify(candidateList)}`,
      "请先筛选：忽略与需求无关的仓库，包括高 Star 但与需求无关的热门项目。",
      "对每个真正契合需求的仓库，给出契合度 fitScore（0 到 100 的整数）和契合点 fitPoints（2 到 3 条，具体说明它在功能、技术栈、场景或维护状态上哪里契合）。",
      "再从筛出的项目里挑选 3 到 5 个最值得推荐的，按推荐优先级排序。",
      "必须使用候选里的 fullName，不要编造仓库。只返回 JSON：",
      JSON.stringify({
        summary: "用一句话总结这次搜索",
        recommendations: [
          {
            fullName: "候选仓库的 fullName",
            reason: "为什么推荐它，结合功能、技术栈、维护状态说明"
          }
        ],
        screened: [
          {
            fullName: "候选仓库的 fullName",
            fitScore: 85,
            fitPoints: ["具体契合点 1", "具体契合点 2"]
          }
        ],
        suggestions: ["还可以补充搜索的关键词或下一步建议"]
      })
    ].join("\n"),
    maxTokens: 3200,
    timeout: 50000
  });

  return {
    summary: String(data.summary || ""),
    suggestions: Array.isArray(data.suggestions) ? data.suggestions.map(String).slice(0, 4) : [],
    recommendations: Array.isArray(data.recommendations) ? data.recommendations : [],
    screened: Array.isArray(data.screened) ? data.screened : []
  };
}

export async function aiScreenAll({ query, expansions, candidates, batchSize = 15 }) {
  const result = {
    summary: "",
    suggestions: [],
    recommendations: [],
    screened: []
  };
  const seenRecommendations = new Set();
  const seenScreened = new Set();

  for (let index = 0; index < candidates.length; index += batchSize) {
    const batch = candidates.slice(index, index + batchSize);
    let batchResult = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        batchResult = await aiRecommend({ query, expansions, candidates: batch });
        break;
      } catch {
        // 单批失败可重试，避免一次不稳定导致整轮筛选失败。
      }
    }
    if (!batchResult) continue;

    if (!result.summary && batchResult.summary) result.summary = batchResult.summary;
    if (batchResult.suggestions.length) result.suggestions = batchResult.suggestions;

    for (const rec of batchResult.recommendations) {
      const key = String(rec.fullName || "").trim().toLowerCase();
      if (!key || seenRecommendations.has(key)) continue;
      seenRecommendations.add(key);
      result.recommendations.push(rec);
    }

    for (const fit of batchResult.screened) {
      const key = String(fit.fullName || "").trim().toLowerCase();
      if (!key || seenScreened.has(key)) continue;
      seenScreened.add(key);
      result.screened.push(fit);
    }
  }

  return result;
}
