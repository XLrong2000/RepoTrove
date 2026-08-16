import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const ENV_PATH = path.join(ROOT, ".env");

export function getAiSettings() {
  return {
    baseUrl: process.env.AI_BASE_URL || "https://api.openai.com/v1",
    model: process.env.AI_MODEL || "gpt-4o-mini",
    apiKeyConfigured: Boolean(process.env.OPENAI_API_KEY || process.env.AI_API_KEY)
  };
}

export function maskApiKey(key) {
  const value = String(key || "");
  if (!value) return "";
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 3)}••••${value.slice(-4)}`;
}

export function getSettings() {
  return {
    ai: getAiSettings()
  };
}

function upsertEnvLine(lines, key, value) {
  const prefix = `${key}=`;
  const index = lines.findIndex((line) => line.startsWith(prefix));
  if (index === -1) {
    lines.push(`${key}=${value}`);
    return;
  }
  lines[index] = `${key}=${value}`;
}

export function saveSettings({ ai = {} } = {}) {
  const { baseUrl, apiKey, model, clearApiKey } = ai;
  const normalizedBase = String(baseUrl || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
  const normalizedModel = String(model || "gpt-4o-mini").trim();
  const normalizedKey = String(apiKey || "").trim();
  const currentKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY || "";
  const finalKey = normalizedKey || (clearApiKey ? "" : currentKey);

  if (!/^https?:\/\//.test(normalizedBase)) {
    throw new Error("Base URL 必须是 http:// 或 https:// 开头的地址");
  }
  if (!normalizedModel) {
    throw new Error("请填写 Model Name");
  }

  const existing = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf-8") : "";
  const lines = existing.split(/\r?\n/).filter((line) => line.trim());
  upsertEnvLine(lines, "AI_BASE_URL", normalizedBase);
  upsertEnvLine(lines, "AI_MODEL", normalizedModel);
  upsertEnvLine(lines, "OPENAI_API_KEY", finalKey);

  fs.writeFileSync(ENV_PATH, `${lines.join("\n")}\n`, "utf-8");

  process.env.AI_BASE_URL = normalizedBase;
  process.env.AI_MODEL = normalizedModel;
  process.env.OPENAI_API_KEY = finalKey;
  process.env.AI_API_KEY = "";

  return getSettings();
}
