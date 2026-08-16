export const PLATFORM_INFO = {
  github: {
    key: "github",
    name: "GitHub",
    color: "#24292f",
    requiresToken: false
  },
  gitee: {
    key: "gitee",
    name: "Gitee",
    color: "#c71d23",
    requiresToken: false
  },
  gitcode: {
    key: "gitcode",
    name: "GitCode",
    color: "#1a6ee0",
    requiresToken: false
  },
  gitlab: {
    key: "gitlab",
    name: "GitLab",
    color: "#e24329",
    requiresToken: false
  }
};

export const PROVIDER_KEYS = Object.keys(PLATFORM_INFO);

function text(value) {
  return value == null ? "" : String(value);
}

function hasCjk(value) {
  return /[\u3400-\u9fff]/.test(String(value || ""));
}

function pick(obj, keys) {
  for (const key of keys) {
    if (obj[key] != null) return obj[key];
  }
  return undefined;
}

function unwrapItems(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const key of ["repositories", "projects", "items", "results", "list", "data"]) {
      if (Array.isArray(data[key])) return data[key];
    }
    if (data.data && typeof data.data === "object") {
      for (const key of ["repositories", "projects", "items", "results", "list"]) {
        if (Array.isArray(data.data[key])) return data.data[key];
      }
    }
  }
  return [];
}

function normalizeCommon(raw, provider) {
  const fullName = text(
    pick(raw, ["full_name", "fullName", "path_with_namespace", "path", "project_path"]) ||
      (raw.name && raw.owner?.login ? `${raw.owner.login}/${raw.name}` : "")
  );
  const name = text(pick(raw, ["name", "project_name"])) || fullName.split("/").pop() || fullName;
  const url =
    text(pick(raw, ["html_url", "web_url", "htmlUrl"])) ||
    (fullName
      ? provider === "gitee"
        ? `https://gitee.com/${fullName}`
        : provider === "gitcode"
          ? `https://gitcode.com/${fullName}`
          : provider === "gitlab"
            ? `https://gitlab.com/${fullName}`
            : `https://github.com/${fullName}`
      : "");

  const topics = Array.isArray(raw.topics)
    ? raw.topics.map((item) => (typeof item === "string" ? item : text(item.name))).filter(Boolean)
    : Array.isArray(raw.tag_list)
      ? raw.tag_list
      : [];

  const license = text(pick(raw, ["license", "license_name"]));
  const homepage = text(pick(raw, ["homepage", "homepage_url"]));

  return {
    id: `${provider}:${fullName}`,
    provider,
    name,
    fullName,
    url,
    homepage,
    description: text(pick(raw, ["description", "description_text", "summary"])),
    stars: Number(pick(raw, ["stargazers_count", "star_count", "stars_count", "stars", "watchers_count"]) || 0),
    forks: Number(pick(raw, ["forks_count", "fork_count", "forks"]) || 0),
    language: text(pick(raw, ["language", "primary_language"])),
    updatedAt: text(pick(raw, ["updated_at", "last_activity_at", "updatedAt", "pushed_at"])),
    topics,
    license,
    homepage
  };
}

function normalizeGiteeWeb(raw) {
  const fields = raw.fields || {};
  const first = (key) => {
    const value = fields[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const url = String(first("url") || "");
  const fullName = url
    ? url.replace(/^https?:\/\/gitee\.com\/?/, "").replace(/\/$/, "")
    : [first("owner.path.keyword"), first("path")].filter(Boolean).join("/");
  const name = fullName.split("/").pop() || String(first("title") || "").split("/").pop() || "";
  const languages = Array.isArray(fields.langs) ? fields.langs : [];
  return {
    id: `gitee:${fullName}`,
    provider: "gitee",
    name,
    fullName,
    url,
    homepage: "",
    description: String(first("description") || ""),
    stars: Number(first("count.star") || 0),
    forks: Number(first("count.fork") || 0),
    language: languages[0] || "",
    updatedAt: String(first("last_push_at") || ""),
    topics: [],
    license: String(first("license") || "")
  };
}

function normalizeGitCodeWeb(raw) {
  const fullName = String(
    raw.path_with_namespace ||
      (raw.namespace && raw.path ? `${raw.namespace}/${raw.path}` : raw.name || "")
  );
  const url = String(raw.web_url || (fullName ? `https://gitcode.com/${fullName}` : ""));
  const tags = [
    ...(Array.isArray(raw.tags) ? raw.tags.map((item) => item.name || "").filter(Boolean) : []),
    ...(Array.isArray(raw.topic_names) ? raw.topic_names.map((item) => item.name || "").filter(Boolean) : [])
  ];
  const language =
    String(raw.main_language || raw.language || "") ||
    (Array.isArray(raw.main_repository_language) ? String(raw.main_repository_language[0] || "") : "");
  return {
    id: `gitcode:${fullName}`,
    provider: "gitcode",
    name: String(raw.name || fullName.split("/").pop() || ""),
    fullName,
    url,
    homepage: "",
    description: String(raw.description || raw.description_cn || ""),
    stars: Number(raw.star_count || 0),
    forks: Number(raw.forks_count || 0),
    language,
    updatedAt: String(raw.last_activity_at || raw.updated_at || raw.created_at || ""),
    topics: Array.from(new Set(tags)).slice(0, 8),
    license: String(raw.license?.key || raw.license?.name || "")
  };
}

async function fetchJson(url, { headers = {}, timeout = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "RepoAggregator/1.0",
        Accept: "application/json",
        ...headers
      },
      signal: controller.signal
    });
    const bodyText = await response.text();
    if (!response.ok) {
      let message = bodyText.slice(0, 300);
      try {
        const parsed = JSON.parse(bodyText);
        message = parsed.error_message || parsed.message || parsed.error || message;
      } catch {
        // 保留原始错误文本。
      }
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return bodyText ? JSON.parse(bodyText) : [];
  } finally {
    clearTimeout(timer);
  }
}

async function searchGithub(query, { token, perPage }) {
  const searchQuery = hasCjk(query)
    ? `"${query.replace(/"/g, "")}"`
    : `${query} in:name,description,readme`;
  const params = new URLSearchParams({
    q: searchQuery,
    sort: "stars",
    order: "desc",
    per_page: String(perPage)
  });
  const data = await fetchJson(`https://api.github.com/search/repositories?${params}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  const items = Array.isArray(data.items) ? data.items : [];
  return {
    results: items.map((item) => normalizeCommon(item, "github")),
    total: Number(data.total_count || items.length)
  };
}

async function searchGitee(query, { token, perPage }) {
  const url = `https://so.gitee.com/v1/search/widget/wong1slagnlmzwvsu5ya?query=1048&q=${encodeURIComponent(
    query
  )}&from=0&size=${perPage}&sort_by_f=`;
  const data = await fetchJson(url, {
    headers: {
      Referer: `https://gitee.com/search?q=${encodeURIComponent(query)}&type=repository`
    }
  });
  const hits = Array.isArray(data?.hits?.hits) ? data.hits.hits : [];
  const results = hits.map(normalizeGiteeWeb);
  return {
    results,
    total: Number(data?.hits?.total?.value || results.length)
  };
}

async function searchGitCode(query, { perPage }) {
  const url = `https://web-api.gitcode.com/api/v1/search/nauth/query?q=${encodeURIComponent(
    query
  )}&type=repo&p=1&pp=${perPage}&o=desc&repo_type=0`;
  const data = await fetchJson(url, {
    headers: {
      Referer: `https://gitcode.com/search?q=${encodeURIComponent(query)}`
    }
  });
  const items = Array.isArray(data.content) ? data.content : [];
  const results = items.map(normalizeGitCodeWeb);
  return {
    results,
    total: Number(data.total || results.length)
  };
}

async function searchGitLab(query, { token, perPage }) {
  const params = new URLSearchParams({
    search: query,
    simple: "false",
    per_page: String(perPage)
  });
  const data = await fetchJson(`https://gitlab.com/api/v4/projects?${params}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  return {
    results: unwrapItems(data).map((item) => normalizeCommon(item, "gitlab")),
    total: unwrapItems(data).length
  };
}

const PROVIDER_FUNCTIONS = {
  github: searchGithub,
  gitee: searchGitee,
  gitcode: searchGitCode,
  gitlab: searchGitLab
};

function dedupe(items) {
  const map = new Map();
  for (const item of items) {
    const key = item.fullName.toLowerCase();
    const existing = map.get(key);
    if (!existing || item.stars > existing.stars) {
      map.set(key, item);
    }
  }
  return Array.from(map.values());
}

export async function searchProviders(queries, options = {}) {
  const tasks = options.providers.map(async (key) => {
    const info = PLATFORM_INFO[key];
    const started = Date.now();
    const collected = [];
    let error = null;
    let needsToken = false;

    try {
      for (const query of queries) {
        const payload = await PROVIDER_FUNCTIONS[key](query, {
          token: options.tokens?.[key] || "",
          perPage: options.perPage
        });
        const result = Array.isArray(payload) ? { results: payload } : payload;
        if (Array.isArray(result.results)) collected.push(...result.results);
        if (result.needsToken) needsToken = true;
        if (result.error && !error) error = result.error;
      }
    } catch (err) {
      error = err.message || "请求失败";
    }

    const results = dedupe(collected);
    return {
      key,
      name: info.name,
      color: info.color,
      requiresToken: info.requiresToken,
      configured: true,
      ok: !error && !needsToken,
      count: results.length,
      results,
      error,
      needsToken,
      elapsedMs: Date.now() - started
    };
  });

  return Promise.all(tasks);
}
