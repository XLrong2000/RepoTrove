import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expandQuery } from "./lib/expander.js";
import { PROVIDER_KEYS, PLATFORM_INFO, searchProviders } from "./lib/providers.js";
import { rankResults } from "./lib/ranker.js";
import { isAiConfigured, aiScreenAll } from "./lib/ai.js";
import { getAiSettings, getSettings, maskApiKey, saveSettings } from "./lib/settings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 3000);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon"
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      const error = new Error("请求体过大");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : {};
}

async function serveStatic(req, res, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.normalize(path.join(PUBLIC_DIR, relative));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== path.join(PUBLIC_DIR, "index.html")) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const data = await fs.promises.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Content-Length": data.length
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not Found");
  }
}

function getConfig() {
  const aiSettings = getAiSettings();
  return {
    ai: {
      configured: isAiConfigured(),
      model: aiSettings.model,
      base: aiSettings.baseUrl,
      apiKeyConfigured: aiSettings.apiKeyConfigured,
      apiKeyMasked: maskApiKey(process.env.OPENAI_API_KEY || process.env.AI_API_KEY)
    },
    providers: PROVIDER_KEYS.map((key) => {
      const info = PLATFORM_INFO[key];
      return {
        key,
        name: info.name,
        color: info.color,
        available: true
      };
    })
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  try {
    if (req.method === "GET" && (url.pathname === "/api/config" || url.pathname === "/api/health")) {
      sendJson(res, 200, { ok: true, ...getConfig() });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/settings") {
      sendJson(res, 200, { ok: true, ...getSettings() });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/settings") {
      const body = await readBody(req);
      const settings = saveSettings({
        ai: {
          baseUrl: body.baseUrl,
          apiKey: body.apiKey,
          model: body.model,
          clearApiKey: Boolean(body.clearApiKey)
        }
      });
      sendJson(res, 200, { ok: true, ...settings });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/expand") {
      const body = await readBody(req);
      const query = String(body.query || "").trim();
      if (!query) {
        sendJson(res, 400, { error: "请输入搜索需求" });
        return;
      }
      const aiEnabledRequested = typeof body.aiEnabled === "boolean" ? body.aiEnabled : isAiConfigured();
      const expansion = await expandQuery(query, { aiEnabled: aiEnabledRequested });
      sendJson(res, 200, { query, ...expansion });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/search") {
      const started = Date.now();
      const body = await readBody(req);
      const query = String(body.query || "").trim();
      if (!query) {
        sendJson(res, 400, { error: "请输入搜索需求" });
        return;
      }

      const wanted = Array.isArray(body.providers) && body.providers.length
        ? body.providers.filter((key) => PLATFORM_INFO[key])
        : PROVIDER_KEYS;
      const perPage = clamp(Number(body.perPage) || 8, 1, 20);
      const aiEnabledRequested = typeof body.aiEnabled === "boolean" ? body.aiEnabled : isAiConfigured();
      const expansion = await expandQuery(query, { aiEnabled: aiEnabledRequested });
      const searchQueries = expansion.queries
        .slice(0, 6)
        .flatMap((item) => {
          const queries = [item.query];
          if (item.queryEn && item.queryEn !== item.query) queries.push(item.queryEn);
          return queries;
        })
        .slice(0, 8);
      const providerResults = await searchProviders(searchQueries, {
        providers: wanted,
        perPage
      });

      const allResults = providerResults.flatMap((provider) => provider.results);
      const ranked = rankResults(allResults, query, expansion.queries);
      let recommendations = ranked.recommendations;
      let finalResults = ranked.results;
      const aiUsed = expansion.aiMode === true;
      const aiInsights = {
        ranking: aiUsed ? "AI" : "本地",
        summary: expansion.summary || "",
        suggestions: expansion.suggestions || [],
        requiresAi: !aiUsed,
        screenedCount: 0,
        candidateCount: allResults.length
      };

      if (aiUsed && allResults.length) {
        try {
          const aiRanking = await aiScreenAll({
            query,
            expansions: expansion.queries,
            candidates: ranked.results.slice(0, 30)
          });
          const byFullName = new Map(ranked.results.map((item) => [item.fullName.toLowerCase(), item]));
          const fitMap = new Map();
          for (const fit of aiRanking.screened || []) {
            const name = String(fit.fullName || "").trim().toLowerCase();
            const fitScore = Number(fit.fitScore);
            if (!name || Number.isNaN(fitScore)) continue;
            fitMap.set(name, {
              fitScore,
              fitPoints: Array.isArray(fit.fitPoints) ? fit.fitPoints.map(String).slice(0, 3) : []
            });
          }
          finalResults = ranked.results.map((item) => {
            const fit = fitMap.get(item.fullName.toLowerCase());
            return fit ? { ...item, ...fit, aiScreened: true } : item;
          });
          finalResults.sort((a, b) => {
            if (a.aiScreened !== b.aiScreened) return a.aiScreened ? -1 : 1;
            if (a.aiScreened) return b.fitScore - a.fitScore;
            return (a.rank || 999) - (b.rank || 999);
          });
          const mapped = [];
          const seen = new Set();
          for (const rec of aiRanking.recommendations) {
            if (mapped.length >= 5) break;
            const item = byFullName.get(String(rec.fullName || "").trim().toLowerCase());
            if (!item || seen.has(item.fullName.toLowerCase())) continue;
            mapped.push({ ...item, reason: rec.reason || item.reason });
            seen.add(item.fullName.toLowerCase());
          }
          for (const item of ranked.results) {
            if (mapped.length >= 5) break;
            if (!seen.has(item.fullName.toLowerCase())) {
              mapped.push(item);
              seen.add(item.fullName.toLowerCase());
            }
          }
          recommendations = mapped.map((item, index) => ({ ...item, rank: index + 1 }));
          aiInsights.ranking = "AI";
          aiInsights.summary = aiRanking.summary || "";
          aiInsights.suggestions = aiRanking.suggestions || [];
          aiInsights.screenedCount = fitMap.size;
        } catch {
          // AI 推荐失败时保留本地推荐结果。
        }
      }

      sendJson(res, 200, {
        query,
        aiMode: expansion.aiMode,
        expansionReason: expansion.reason,
        expansions: expansion.queries,
        providers: providerResults,
        results: finalResults,
        recommendations,
        aiInsights,
        meta: {
          elapsedMs: Date.now() - started,
          totalCount: allResults.length
        }
      });
      return;
    }

    if (req.method === "GET" || req.method === "HEAD") {
      await serveStatic(req, res, url.pathname);
      return;
    }

    sendJson(res, 404, { error: "接口不存在" });
  } catch (err) {
    const status = err.status || 500;
    sendJson(res, status, {
      error: status === 500 ? "服务端处理失败" : err.message || "请求失败"
    });
  }
});

function start(port) {
  server.once("error", (err) => {
    if (err.code === "EADDRINUSE" && port < PORT + 20) {
      console.log(`端口 ${port} 被占用，尝试 ${port + 1}`);
      start(port + 1);
      return;
    }
    console.error(err);
    process.exit(1);
  });
  server.listen(port, () => {
    console.log(`聚码搜已启动: http://localhost:${port}`);
  });
}

start(PORT);
