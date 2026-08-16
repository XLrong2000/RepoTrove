const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const PLATFORM_META = {
  github: { name: "GitHub", color: "#24292f" },
  gitee: { name: "Gitee", color: "#c71d23" },
  gitcode: { name: "GitCode", color: "#1a6ee0" },
  gitlab: { name: "GitLab", color: "#e24329" }
};

const LANGUAGE_COLORS = {
  JavaScript: "#f1e05a",
  TypeScript: "#3178c6",
  Java: "#b07219",
  Python: "#3572a5",
  Go: "#00add8",
  Rust: "#dea584",
  C: "#555555",
  "C++": "#f34b7d",
  "C#": "#178600",
  PHP: "#4f5d95",
  Ruby: "#701516",
  Vue: "#41b883",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Swift: "#f05138",
  Kotlin: "#a97bff",
  Shell: "#89e051"
};

const state = {
  providers: {},
  results: [],
  recommendations: [],
  expansions: [],
  aiMode: false,
  expansionReason: "",
  aiEnabled: false,
  aiInsights: {
    ranking: "本地",
    summary: "",
    suggestions: [],
    requiresAi: true
  },
  activeProvider: "all",
  sort: "default",
  minStars: 0,
  language: "all",
  aiFilterOnly: false,
  history: [],
  loading: false
};

const queryInput = $("#queryInput");
const searchForm = $("#searchForm");
const searchButton = $("#searchButton");
const workspace = $("#workspace");
const expansionChips = $("#expansionChips");
const expansionMeta = $("#expansionMeta");
const recommendations = $("#recommendations");
const providerTabs = $("#providerTabs");
const resultsList = $("#resultsList");
const sortSelect = $("#sortSelect");
const starsSelect = $("#starsSelect");
const languageSelect = $("#languageSelect");
const configDialog = $("#configDialog");
const configBody = $("#configBody");
const historyDialog = $("#historyDialog");
const historyBody = $("#historyBody");
const toastEl = $("#toast");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return map[char];
  });
}

function refreshIcons() {
  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons();
  }
}

function formatNumber(value) {
  const number = Number(value) || 0;
  if (number >= 1000000) return `${(number / 1000000).toFixed(1)}m`;
  if (number >= 1000) {
    return number >= 10000 ? `${Math.round(number / 1000)}k` : `${(number / 1000).toFixed(1)}k`;
  }
  return String(number);
}

function timeAgo(value) {
  const timestamp = Date.parse(value);
  if (!timestamp) return "";
  const days = Math.floor((Date.now() - timestamp) / 86400000);
  if (days <= 0) return "今天更新";
  if (days < 30) return `${days} 天前更新`;
  if (days < 365) return `${Math.round(days / 30)} 个月前更新`;
  return `${Math.round(days / 365)} 年前更新`;
}

function colorForLanguage(language) {
  if (LANGUAGE_COLORS[language]) return LANGUAGE_COLORS[language];
  let hash = 0;
  for (const char of String(language || "")) {
    hash = (hash * 31 + char.charCodeAt(0)) % 360;
  }
  return `hsl(${hash}, 45%, 55%)`;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "请求失败");
  }
  return data;
}

function autoResizeTextarea() {
  queryInput.style.height = "auto";
  queryInput.style.height = `${Math.min(120, Math.max(48, queryInput.scrollHeight))}px`;
}

async function refreshAiBanner() {
  try {
    const config = await api("/api/config");
    const banner = $("#aiBanner");
    const text = $("#aiBannerText");
    if (config.ai.configured) {
      if (state.aiEnabled) {
        banner.hidden = true;
      } else {
        banner.hidden = false;
        text.textContent = "AI 增强已关闭";
      }
    } else {
      banner.hidden = false;
      text.textContent = "AI 未配置 · 当前为本地降级模式";
    }
  } catch {
    // 状态刷新失败不影响主流程。
  }
}

function addHistory(query) {
  const lower = query.toLowerCase();
  state.history = [query, ...state.history.filter((item) => item.toLowerCase() !== lower)].slice(0, 8);
  localStorage.setItem("repo-search-history", JSON.stringify(state.history));
}

function loadHistory() {
  try {
    state.history = JSON.parse(localStorage.getItem("repo-search-history") || "[]");
  } catch {
    state.history = [];
  }
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastEl._timer);
  toastEl._timer = setTimeout(() => toastEl.classList.remove("show"), 2200);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("链接已复制");
  } catch {
    const input = document.createElement("textarea");
    input.value = text;
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
    toast("链接已复制");
  }
}

function setLoading(loading) {
  state.loading = loading;
  searchButton.disabled = loading;
  const label = searchButton.querySelector("span");
  label.textContent = loading ? "搜索中" : "搜索";
  searchButton.classList.toggle("loading", loading);
}

function renderSkeleton() {
  resultsList.innerHTML = Array.from({ length: 5 }, () => '<div class="skeleton-card"></div>').join("");
}

function renderWorkspace() {
  workspace.hidden = false;
  renderExpansions();
  renderTabs();
  renderLanguageOptions();
  renderRecommendations();
  renderResults();
  refreshIcons();
}

function renderExpansions() {
  const modeText = state.aiMode
    ? "AI 中英扩展"
    : state.aiEnabled
      ? "AI 未生效，使用本地模式"
      : "本地模式";
  expansionMeta.textContent = `共 ${state.expansions.length} 组搜索词 · ${modeText}`;
  expansionChips.innerHTML = state.expansions
    .map((item) => {
      const label =
        item.queryEn && item.queryEn !== item.query
          ? `${escapeHtml(item.query)} · ${escapeHtml(item.queryEn)}`
          : escapeHtml(item.query);
      return `
        <button class="chip" data-expand="${escapeHtml(item.query)}" title="${escapeHtml(item.reason || item.source || "")}">
          <i data-lucide="search"></i>${label}
        </button>`;
    })
    .join("");
}

function renderTabs() {
  const total = new Set(state.results.map((item) => item.fullName.toLowerCase())).size;
  const tabs = [
    `<button class="segment ${state.activeProvider === "all" ? "active" : ""}" data-provider="all">
      综合<span class="count">${total}</span>
    </button>`
  ];

  for (const provider of Object.values(state.providers)) {
    const statusClass = !provider.ok ? "error" : "";
    const dotColor = provider.ok ? "#16a34a" : "#dc2626";
    tabs.push(`
      <button class="segment ${state.activeProvider === provider.key ? "active" : ""} ${statusClass}" data-provider="${provider.key}">
        <span class="provider-dot" style="--dot:${dotColor}"></span>
        ${provider.name}<span class="count">${provider.count}</span>
      </button>`);
  }
  providerTabs.innerHTML = tabs.join("");
}

function renderLanguageOptions() {
  const current = languageSelect.value;
  const languages = Array.from(new Set(state.results.map((item) => item.language).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  languageSelect.innerHTML = `<option value="all">全部语言</option>` +
    languages.map((language) => `<option value="${escapeHtml(language)}">${escapeHtml(language)}</option>`).join("");
  if ([...languageSelect.options].some((option) => option.value === current)) {
    languageSelect.value = current;
  }
}

function renderRecommendations() {
  const mode = state.aiInsights?.ranking === "AI" ? "AI 推荐" : "本地推荐";
  const modeClass = state.aiInsights?.ranking === "AI" ? "ai" : "local";
  const screenMeta =
    state.aiInsights?.screenedCount
      ? `<div class="screen-meta">AI 筛选：从 ${state.aiInsights.candidateCount || 0} 个结果中筛出 ${state.aiInsights.screenedCount} 个高契合项目</div>`
      : "";
  if (!state.recommendations.length) {
    recommendations.innerHTML = `
      <div class="recommend-head">
        <span class="mode-pill ${modeClass}">${mode}</span>
      </div>
      <div class="panel-empty">暂无推荐</div>`;
    return;
  }
  const summary = state.aiInsights?.summary
    ? `<p class="ai-summary">${escapeHtml(state.aiInsights.summary)}</p>`
    : "";
  const suggestions = (state.aiInsights?.suggestions || [])
    .map((suggestion) => `<span class="suggestion-chip">${escapeHtml(suggestion)}</span>`)
    .join("");
  recommendations.innerHTML = `
    <div class="recommend-head">
      <span class="mode-pill ${modeClass}">${mode}</span>
    </div>
    ${screenMeta}
    ${summary}
    <ol class="recommend-list">
      ${state.recommendations
        .map(
          (item) => `
            <li class="recommend-item">
              <span class="rank-badge">${item.rank}</span>
              <div class="recommend-content">
                <a class="recommend-name" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.name)}</a>
                <div class="recommend-meta">
                  <span class="platform-text" style="--platform-color:${PLATFORM_META[item.provider].color}">${PLATFORM_META[item.provider].name}</span>
                  · ${formatNumber(item.stars)} stars
                </div>
                <p class="recommend-reason">${escapeHtml(item.reason)}</p>
              </div>
            </li>`
        )
        .join("")}
    </ol>`;
  if (suggestions) {
    recommendations.insertAdjacentHTML(
      "beforeend",
      `<div class="suggestion-row">${suggestions}</div>`
    );
  }
}

function getFilteredResults() {
  let list = state.activeProvider === "all" ? state.results.slice() : state.results.filter((item) => item.provider === state.activeProvider);

  if (state.aiFilterOnly) {
    list = list.filter((item) => item.aiScreened);
  }
  if (state.language !== "all") {
    list = list.filter((item) => item.language === state.language);
  }
  if (state.minStars > 0) {
    list = list.filter((item) => item.stars >= state.minStars);
  }

  if (state.sort === "stars") {
    list.sort((a, b) => b.stars - a.stars);
  } else if (state.sort === "updated") {
    list.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  } else if (state.sort === "name") {
    list.sort((a, b) => a.fullName.localeCompare(b.fullName));
  }
  return list;
}

function renderResults() {
  const list = getFilteredResults();
  if (!list.length) {
    resultsList.innerHTML = '<div class="list-empty">没有符合条件的结果</div>';
    refreshIcons();
    return;
  }

  resultsList.innerHTML = list
    .map((item) => {
      const meta = PLATFORM_META[item.provider] || { name: item.provider, color: "#24292f" };
      const topics = (item.topics || [])
        .slice(0, 4)
        .map((topic) => `<span class="topic">${escapeHtml(topic)}</span>`)
        .join("");
      return `
        <article class="repo-card" style="--platform-color:${meta.color}">
          <div class="repo-card-main">
            <div class="repo-title-row">
              <span class="platform-badge">${meta.name}</span>
              <a class="repo-name" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.name)}</a>
            </div>
            <div class="repo-full">${escapeHtml(item.fullName)}</div>
            ${item.description ? `<p class="repo-desc">${escapeHtml(item.description)}</p>` : ""}
            ${item.aiScreened
              ? `
                <div class="fit-block">
                  <span class="fit-score">契合度 ${escapeHtml(item.fitScore)}</span>
                  ${item.fitPoints?.length
                    ? `<ul class="fit-points">${item.fitPoints.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>`
                    : ""}
                </div>`
              : ""}
            ${topics ? `<div class="repo-topics">${topics}</div>` : ""}
            <div class="repo-meta">
              <span class="stat"><i data-lucide="star"></i>${formatNumber(item.stars)}</span>
              <span class="stat"><i data-lucide="git-fork"></i>${formatNumber(item.forks)}</span>
              ${item.language ? `<span class="language-dot" style="--lang:${colorForLanguage(item.language)}"></span><span>${escapeHtml(item.language)}</span>` : ""}
              ${item.updatedAt ? `<span>${timeAgo(item.updatedAt)}</span>` : ""}
            </div>
          </div>
          <div class="repo-actions">
            <a class="icon-button" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer" title="打开仓库">
              <i data-lucide="external-link"></i>
            </a>
            ${item.homepage ? `<a class="icon-button" href="${escapeHtml(item.homepage)}" target="_blank" rel="noreferrer" title="项目主页"><i data-lucide="globe"></i></a>` : ""}
            <button class="icon-button copy-button" data-copy="${escapeHtml(item.url)}" title="复制链接">
              <i data-lucide="copy"></i>
            </button>
          </div>
        </article>`;
    })
    .join("");
  refreshIcons();
}

function resetFilters() {
  state.activeProvider = "all";
  state.sort = "default";
  state.minStars = 0;
  state.language = "all";
  state.aiFilterOnly = false;
  sortSelect.value = "default";
  starsSelect.value = "0";
  languageSelect.value = "all";
  const aiFitOnly = $("#aiFitOnly");
  if (aiFitOnly) aiFitOnly.checked = false;
}

async function handleSearch(queryOverride) {
  if (state.loading) return;
  const query = String(queryOverride || queryInput.value).trim();
  if (!query) {
    toast("先输入一个搜索需求");
    return;
  }
  queryInput.value = query;
  addHistory(query);
  resetFilters();
  setLoading(true);
  workspace.hidden = false;
  renderSkeleton();

  try {
    const data = await api("/api/search", {
      method: "POST",
      body: JSON.stringify({ query, aiEnabled: state.aiEnabled })
    });
    state.providers = Object.fromEntries(data.providers.map((provider) => [provider.key, provider]));
    state.results = data.results;
    state.recommendations = data.recommendations;
    state.expansions = data.expansions;
    state.aiMode = data.aiMode;
    state.expansionReason = data.expansionReason;
    state.aiInsights = data.aiInsights || state.aiInsights;
    renderWorkspace();
    if (!data.results.length) {
      toast("没有找到结果，换个说法试试");
    }
  } catch (error) {
    resultsList.innerHTML = `<div class="error-panel">${escapeHtml(error.message)}</div>`;
  } finally {
    setLoading(false);
  }
}

async function openConfig() {
  try {
    const [config, settings] = await Promise.all([api("/api/config"), api("/api/settings")]);
    const platformStatus = config.providers
      .map((provider) => {
        const meta = PLATFORM_META[provider.key] || { name: provider.key, color: "#24292f" };
        const available = provider.available !== false;
        const dotColor = available ? "#16a34a" : "#dc2626";
        return `
          <li class="status-item">
            <span class="status-name">
              <span class="provider-dot" style="--dot:${dotColor}"></span>${meta.name}
            </span>
            <span class="status-pill ${available ? "ok" : "warn"}">${available ? "可用" : "不可用"}</span>
          </li>`;
      })
      .join("");
    const keyState = settings.ai.apiKeyConfigured
      ? `<span class="settings-key-state ok">当前 Key：${escapeHtml(config.ai.apiKeyMasked || "已配置")}</span>`
      : '<span class="settings-key-state warn">当前 Key：未配置</span>';
    const clearCheckbox = settings.ai.apiKeyConfigured
      ? '<label class="checkbox-row"><input type="checkbox" name="clearApiKey" /> 清除已保存的 API Key</label>'
      : "";
    configBody.innerHTML = `
      <form id="aiSettingsForm" class="settings-form">
        <div class="settings-heading">AI 供应商</div>
        <label class="field">
          <span>Base URL</span>
          <input name="baseUrl" value="${escapeHtml(settings.ai.baseUrl)}" placeholder="https://api.openai.com/v1" required />
        </label>
        <label class="field">
          <span>API Key</span>
          <input
            name="apiKey"
            type="password"
            placeholder="${settings.ai.apiKeyConfigured ? "已配置，留空则保持不变" : "请输入 API Key"}"
            autocomplete="off"
          />
        </label>
        <label class="field">
          <span>Model Name</span>
          <input name="model" value="${escapeHtml(settings.ai.model)}" placeholder="gpt-4o-mini" required />
        </label>
        ${clearCheckbox}
        <div class="settings-meta">${keyState}</div>
        <div class="settings-divider"></div>
        <div class="settings-heading">平台状态</div>
        <ul class="status-list">${platformStatus}</ul>
        <div class="dialog-actions">
          <button type="submit" class="button button-primary">
            <i data-lucide="save"></i><span>保存配置</span>
          </button>
        </div>
      </form>`;
    refreshIcons();
    configBody.querySelector("#aiSettingsForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = Object.fromEntries(new FormData(event.currentTarget));
      try {
        await api("/api/settings", {
          method: "POST",
          body: JSON.stringify({
            baseUrl: formData.baseUrl,
            apiKey: formData.apiKey,
            model: formData.model,
            clearApiKey: Boolean(formData.clearApiKey)
          })
        });
        toast("配置已保存");
        await refreshAiBanner();
        configDialog.close();
      } catch (error) {
        toast(error.message);
      }
    });
    configDialog.showModal();
  } catch (error) {
    toast(error.message);
  }
}

function openHistory() {
  if (!state.history.length) {
    historyBody.innerHTML = '<div class="panel-empty">暂无搜索历史</div>';
  } else {
    historyBody.innerHTML = `
      <div class="history-list">
        ${state.history
          .map(
            (item) => `
              <button class="history-item" data-history="${escapeHtml(item)}">
                <i data-lucide="clock"></i>${escapeHtml(item)}
              </button>`
          )
          .join("")}
      </div>`;
  }
  refreshIcons();
  historyDialog.showModal();
}

function bindEvents() {
  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    handleSearch();
  });

  $("#clearButton").addEventListener("click", () => {
    queryInput.value = "";
    queryInput.focus();
    autoResizeTextarea();
  });

  queryInput.addEventListener("input", autoResizeTextarea);
  queryInput.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      handleSearch();
    }
  });

  $("#aiToggle").addEventListener("change", (event) => {
    state.aiEnabled = event.target.checked;
    localStorage.setItem("repo-ai-switch", state.aiEnabled ? "1" : "0");
    refreshAiBanner();
  });

  $("#exampleRow").addEventListener("click", (event) => {
    const chip = event.target.closest("[data-example]");
    if (chip) handleSearch(chip.dataset.example);
  });

  expansionChips.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-expand]");
    if (chip) handleSearch(chip.dataset.expand);
  });

  providerTabs.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-provider]");
    if (!tab) return;
    state.activeProvider = tab.dataset.provider;
    renderTabs();
    renderResults();
    refreshIcons();
  });

  sortSelect.addEventListener("change", () => {
    state.sort = sortSelect.value;
    renderResults();
  });

  starsSelect.addEventListener("change", () => {
    state.minStars = Number(starsSelect.value) || 0;
    renderResults();
  });

  languageSelect.addEventListener("change", () => {
    state.language = languageSelect.value;
    renderResults();
  });

  $("#aiFitOnly").addEventListener("change", (event) => {
    state.aiFilterOnly = event.target.checked;
    renderResults();
  });

  resultsList.addEventListener("click", (event) => {
    const copyButton = event.target.closest("[data-copy]");
    if (copyButton) {
      copyText(copyButton.dataset.copy);
      return;
    }
  });

  $("#configButton").addEventListener("click", openConfig);
  $("#historyButton").addEventListener("click", openHistory);
  $("#aiBannerButton").addEventListener("click", openConfig);

  historyBody.addEventListener("click", (event) => {
    const item = event.target.closest("[data-history]");
    if (!item) return;
    historyDialog.close();
    handleSearch(item.dataset.history);
  });

  $$(".dialog-close").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog")?.close());
  });

  [configDialog, historyDialog].forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  });
}

function init() {
  loadHistory();
  state.aiEnabled = localStorage.getItem("repo-ai-switch") === "1";
  $("#aiToggle").checked = state.aiEnabled;
  bindEvents();
  autoResizeTextarea();
  refreshAiBanner();
  refreshIcons();
}

init();
