# 聚码搜（RepoTrove）

聚码搜（RepoTrove）是一个面向中文开发者的开源项目聚合搜索工具。输入一句自然语言，AI 会自动扩展成中英文搜索词，聚合 GitHub、Gitee、GitCode、GitLab 四个平台的结果，再让 AI 筛选出真正契合的项目，并给出契合度评分和具体契合点。

## 核心特性

- 自然语言搜索：极短关键词和长篇口语化描述都能处理
- AI 增强开关：打开后启用 AI 查询扩展、AI 二次筛选和 AI 推荐
- 四平台聚合：GitHub、Gitee、GitCode、GitLab，无需配置任何平台密钥
- 契合度评分：每个 AI 筛出的项目带有 0-100 契合度和具体契合点
- 中英双语搜索词：AI 为每组需求同时生成中文和英文搜索词
- 本地兜底：AI 关闭或不可用时自动使用本地规则，功能仍可使用
- 零第三方依赖：仅使用 Node.js 内置模块，安装即可运行
- 搜索历史：最近搜索保存在浏览器本地

## 快速开始

需要 Node.js 20+。

```bash
cp .env.example .env
npm start
```

Windows 下复制配置：

```powershell
Copy-Item .env.example .env
npm start
```

打开 `http://localhost:3000`。如果 3000 端口被占用，服务会自动向后寻找可用端口，并打印在启动日志里。

## AI 配置

项目以 AI 为核心。在页面右上角“接口状态”中可以直接配置：

- Base URL：AI 供应商地址，例如 `https://api.openai.com/v1`
- API Key：AI 供应商的 API Key
- Model Name：模型名，例如 `gpt-4o-mini`

保存后配置会写入项目的 `.env` 并立即生效。也可以直接编辑 `.env`：

```env
AI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=sk-...
AI_MODEL=gpt-4o-mini
PORT=3000
```

`OPENAI_API_KEY` 也可以替换为 `AI_API_KEY`。项目兼容 OpenAI 格式的接口。

## 使用流程

1. 在搜索框输入一句话，例如“帮我找一个考试系统”，或一段很长的功能描述
2. 打开“AI 增强”开关，让 AI 参与扩展和筛选
3. AI 先生成多组中英文搜索词，分平台聚合搜索
4. 搜索完成后，AI 对结果进行二次筛选
5. 筛出的项目按契合度排序，并显示契合点和推荐理由
6. 可以勾选“仅 AI 契合”只看筛出的项目

关闭“AI 增强”时，会使用本地规则扩展，搜索速度更快，但不生成 AI 契合点评分。

## 主要接口

### 聚合搜索

```http
POST /api/search
Content-Type: application/json
```

请求示例：

```json
{
  "query": "帮我找一个考试系统",
  "aiEnabled": true
}
```

响应包含：

- `expansions`：AI 或本地生成的搜索词
- `providers`：各平台搜索结果统计
- `results`：去重后的统一结果，AI 模式下带 `fitScore` 和 `fitPoints`
- `recommendations`：AI 推荐项目
- `aiInsights`：AI 筛选摘要、筛选数量和搜索总结

### 查询扩展

```http
POST /api/expand
Content-Type: application/json

{ "query": "帮我找一个考试系统", "aiEnabled": true }
```

### 配置

```http
GET /api/config
GET /api/settings
POST /api/settings
```

`GET /api/settings` 返回当前 AI 配置状态；`POST /api/settings` 保存 Base URL、API Key 和 Model Name。

## 目录结构

```text
server/
  index.js            HTTP 服务、静态资源、API 路由
  lib/
    ai.js             AI 扩展、推荐和二次筛选
    expander.js       AI / 本地规则查询扩展
    providers.js      GitHub、Gitee、GitCode、GitLab 搜索适配
    ranker.js         结果去重、排序和推荐理由
    settings.js       AI 配置读写
public/
  index.html          页面结构
  styles.css          界面样式
  app.js              前端交互
  vendor/lucide.min.js 本地图标库
```

## 常见问题

### 搜索为什么比较慢？

一次搜索会跨四个平台、执行多组搜索词，开启 AI 后还要做二次筛选，通常需要 30-60 秒。如果对速度更敏感，可以关闭“AI 增强”开关。

### AI 增强打开后没有生效？

检查“接口状态”里的 Base URL、API Key、Model Name 是否已正确保存，并确认“AI 增强”开关处于打开状态。AI 调用失败时会自动回落到本地模式。

### 端口被占用怎么办？

服务会自动尝试后续端口。启动日志中会显示实际地址，例如 `http://localhost:3001`。

## 后续方向

- 支持更多代码托管平台
- 项目横向对比与选型报告
- Star 趋势、维护活跃度和安全风险提示
- 收藏、订阅和团队协作筛选
- 一键部署到服务器或容器
