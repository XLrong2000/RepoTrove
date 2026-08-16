const START_PHRASES = [
  "帮我找一个",
  "帮我找一下",
  "帮我找这样一个项目",
  "帮我找一个这样的项目",
  "我想找这样一个项目",
  "帮我找",
  "请帮我找",
  "我想要实现的效果是",
  "我想要实现一个",
  "我想要实现",
  "想实现",
  "实现的效果是",
  "能够实现",
  "可以实现",
  "我想要",
  "推荐一个",
  "推荐一下",
  "推荐",
  "求推荐",
  "找一个",
  "找一下",
  "想要一个",
  "想找一个",
  "想找",
  "有没有",
  "有没有类似",
  "需要一个",
  "需要",
  "做个",
  "做一个",
  "做一款",
  "开发一个",
  "开发一款",
  "实现一个",
  "实现",
  "写一个",
  "搭一个",
  "这样一个",
  "这样的",
  "一个",
  "找一个类似",
  "类似"
];

const END_PHRASES = [
  "开源项目",
  "项目",
  "等等",
  "什么的",
  "这一类的",
  "类似的功能",
  "这些功能",
  "吗",
  "吧",
  "啊",
  "呢",
  "的"
];

const DOMAIN_ALIASES = {
  "数据可视化": [
    "数据可视化",
    "dashboard",
    "bi 报表",
    "data visualization"
  ],
  "客户管理": [
    "crm",
    "客户管理系统",
    "customer relationship management"
  ],
  "任务管理": [
    "任务管理系统",
    "todo 应用",
    "任务看板",
    "kanban"
  ],
  "低代码": [
    "低代码平台",
    "低代码开发",
    "low-code platform",
    "lowcode"
  ],
  "考试": [
    "在线考试系统",
    "在线考试",
    "考试平台",
    "题库系统",
    "exam system",
    "online exam",
    "online examination"
  ],
  "商城": [
    "商城系统",
    "电商系统",
    "在线商城",
    "e-commerce",
    "mall system",
    "online shop"
  ],
  "电商": [
    "电商系统",
    "商城系统",
    "e-commerce platform",
    "online store"
  ],
  "博客": [
    "博客系统",
    "个人博客",
    "blog system",
    "personal blog",
    "blog platform"
  ],
  "论坛": [
    "论坛系统",
    "社区系统",
    "bbs",
    "forum system"
  ],
  "进销存": [
    "进销存系统",
    "库存管理系统",
    "erp",
    "inventory management"
  ],
  "库存": [
    "库存管理系统",
    "进销存",
    "inventory management",
    "stock system"
  ],
  "点餐": [
    "点餐系统",
    "点餐小程序",
    "restaurant ordering",
    "food ordering"
  ],
  "订餐": [
    "订餐系统",
    "点餐小程序",
    "food ordering system",
    "restaurant order"
  ],
  "招聘": [
    "招聘系统",
    "招聘平台",
    "job portal",
    "recruitment system"
  ],
  "网盘": [
    "网盘系统",
    "私有网盘",
    "file sharing",
    "cloud storage"
  ],
  "聊天": [
    "聊天机器人",
    "聊天系统",
    "chat",
    "instant messaging"
  ],
  "会议": [
    "视频会议",
    "会议系统",
    "在线会议",
    "video meeting"
  ],
  "知识库": [
    "知识库系统",
    "wiki",
    "knowledge base",
    "docs platform"
  ],
  "审批": [
    "审批系统",
    "oa 系统",
    "工作流",
    "workflow"
  ],
  "工作流": [
    "工作流引擎",
    "工作流系统",
    "workflow engine",
    "bpm"
  ],
  "爬虫": [
    "爬虫框架",
    "数据采集",
    "crawler",
    "web scraper"
  ],
  "笔记": [
    "笔记应用",
    "笔记系统",
    "note taking",
    "markdown notes"
  ],
  "crm": [
    "crm 系统",
    "客户管理系统",
    "sales management",
    "customer relationship"
  ],
  "oa": [
    "oa 系统",
    "办公自动化",
    "office automation",
    "审批系统"
  ],
  "wiki": [
    "wiki 系统",
    "知识库",
    "docs site",
    "documentation platform"
  ]
};

import { aiExpand } from "./ai.js";

function stripFillers(raw) {
  let text = String(raw || "")
    .trim()
    .replace(/[。！？，,.!?；;：:、\s]+/g, " ")
    .trim();

  let changed = true;
  while (changed) {
    changed = false;
    for (const phrase of START_PHRASES) {
      if (text.startsWith(phrase)) {
        text = text.slice(phrase.length).trim();
        changed = true;
      }
    }
  }

  changed = true;
  while (changed) {
    changed = false;
    for (const phrase of END_PHRASES) {
      if (text.endsWith(phrase)) {
        text = text.slice(0, -phrase.length).trim();
        changed = true;
      }
    }
  }

  return text.replace(/\s+/g, " ").trim();
}

function hasCjk(text) {
  return /[\u3400-\u9fff]/.test(text);
}

export function cleanQuery(raw) {
  return stripFillers(raw);
}

function extractCore(raw) {
  const base = stripFillers(raw) || String(raw || "").trim();
  if (base.length <= 24) return base;
  const clauses = String(raw || "")
    .split(/[。！？；;，,、]+/)
    .map((clause) => clause.trim())
    .filter(Boolean);
  const candidate = clauses
    .map((clause) => stripFillers(clause))
    .find((clause) => clause.length >= 2 && clause.length <= 18);
  return candidate || base.slice(0, 18).trim();
}

export function expandLocally(raw) {
  const base = extractCore(raw);
  const terms = new Set();
  terms.add(base);

  const keys = Object.keys(DOMAIN_ALIASES).sort((a, b) => b.length - a.length);
  const matchedKey = keys.find((key) => base.toLowerCase().includes(key.toLowerCase()));
  if (matchedKey) {
    for (const alias of DOMAIN_ALIASES[matchedKey]) {
      terms.add(alias);
    }
  }

  if (hasCjk(base) && !base.startsWith("在线") && base.length <= 10) {
    terms.add(`在线${base}`);
  }
  if (base.length <= 12 && !base.includes("平台")) {
    terms.add(`${base}平台`);
  }
  if (base.length <= 12 && !base.includes("系统")) {
    terms.add(`${base}系统`);
  }
  if (!hasCjk(base) && base.length <= 24) {
    terms.add(`${base} open source`);
    terms.add(`${base} project`);
  }

  const queries = Array.from(terms)
    .filter((term) => term && term.length <= 80)
    .slice(0, 6)
    .map((query) => ({ query, source: "本地扩展" }));

  return {
    queries,
    reason: "未配置 AI Key，已使用本地规则扩展",
    aiMode: false
  };
}

export async function expandQuery(raw, options = {}) {
  const input = String(raw || "").trim();
  if (!input) {
    throw new Error("请输入搜索需求");
  }
  if (options.aiEnabled) {
    try {
      return await aiExpand(input);
    } catch {
      // 任何 AI 失败都回落到本地规则，保证可用性。
    }
  }
  return expandLocally(input);
}
