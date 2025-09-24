# 视频文字稿工作流

本项目通过 TypeScript 编写的自动化流水线，从 YouTube 或哔哩哔哩获取视频音频，调用 Gemini 模型生成中文分段文字稿，并把结果发布到 GitHub Pages 前端页面展示。项目预期运行在 GitHub Actions 中，同时也可以在本地调试。

## 功能概览

- **多平台输入**：支持 YouTube 链接、哔哩哔哩链接或 BV 号。
- **自动生成中文文字稿**：Gemini 自动识别音频内容，若原文非中文会翻译为中文，并按语义分段输出。
- **Markdown 交付**：在 `docs/data/word/` 下生成结构化 Markdown 文件，并通过定制的阅读器美观呈现内容。
- **任务状态面板**：`docs/data/list/jobs.json` 记录任务状态与视频作者，GitHub Pages 前端提供查询入口，可查看任务是否完成并跳转到文字稿阅读器。
- **工作流自动部署**：GitHub Actions 拉取视频、生成文字稿、提交变更并发布到 Pages。

## 目录结构

```
├── src/
│   ├── cli/              # CLI 入口与开发脚本
│   ├── ingest/           # 视频下载与音频抽取
│   ├── transform/        # Gemini 转写与分段逻辑
│   ├── deliver/          # Markdown 写入与任务状态管理
│   └── utils/            # 共用工具方法
├── docs/
│   ├── data/list/jobs.json  # 任务状态索引（GitHub Pages 前端读取）
│   ├── data/word/           # 自动生成的 Markdown 文字稿
│   ├── index.html        # GitHub Pages 首页（查询与展示）
│   ├── app.js            # 前端脚本
│   ├── viewer.html       # 文字稿阅读器入口页
│   ├── viewer.js         # 读取并渲染 Markdown 的脚本
│   └── styles.css        # 前端样式
├── .github/workflows/    # GitHub Actions 工作流定义
├── package.json          # Node 项目配置
├── tsconfig.json         # TypeScript 编译配置
└── README.md             # 项目说明
```

## 运行前准备

1. **Gemini API Key**：前往 Google AI Studio 获取 API Key。
2. **ffmpeg 套件**：`yt-dlp` 需要依赖 `ffmpeg/ffprobe` 做格式转换。GitHub Actions 会自动通过 `apt-get install ffmpeg` 安装，本地调试请确保 `ffmpeg` 在 PATH 中。
3. **yt-dlp**：用于极速下载音视频，GitHub Actions 会自动安装。若本地调试请确保 `yt-dlp` 可用（`pip install yt-dlp`）。

## 本地开发

```bash
npm install
npm run build
# 或使用 ts-node 调试（需事先设置环境变量）
DEV_VIDEO="https://youtu.be/xxxx" GEMINI_API_KEY="your-key" npm run dev
```

调试脚本会调用 `src/cli/index.ts`，读取 `DEV_VIDEO` 作为输入。输出的 Markdown 会写入 `docs/data/word/`，同时更新 `docs/data/list/jobs.json`。

## GitHub Secrets 配置

在仓库的 Settings → Secrets and variables → Actions 中新增以下密钥：

- `GEMINI_API_KEY`：用于调用 Gemini 模型。

Actions 使用自带的 `GITHUB_TOKEN` 推送修改，无需额外配置。

## GitHub Actions 工作流

- 文件：`.github/workflows/transcript.yml`
- 触发方式：`workflow_dispatch`（手动触发）。
- 输入参数：`video_url`（YouTube 链接或哔哩哔哩 BV 号）。

执行流程：

1. Checkout 仓库；
2. 安装 Node.js、Python 与 `yt-dlp`；
3. 安装依赖并编译 TypeScript；
4. 运行 CLI 生成 Markdown 文字稿；
5. 提交更新后的 `docs/` 目录；
6. 通过 `actions/deploy-pages` 发布 GitHub Pages。

失败任务不会持久化在列表中，避免历史失败记录干扰结果。如需排查失败原因，可在 Actions 日志中查看详细报错。

## GitHub Pages 使用说明

部署成功后访问仓库的 GitHub Pages：

1. 在输入框中填写 YouTube 链接或 BV 号，点击「查询」即可查看任务状态；
2. 若任务已完成，页面会提供跳转到专属阅读页面（支持美化排版与移动端阅读）；
3. 尚未处理的输入会提示前往 GitHub Actions 手动触发工作流；
4. 任务列表区展示最近的所有任务及其状态，自动每 60 秒刷新一次。

## 常见问题

- **如何新增任务？**
  在 GitHub Actions 的 “Generate transcript” 工作流中点击「Run workflow」，填写视频链接或 BV 号即可。

- **长视频会超时吗？**
  建议使用时长不超过 10 分钟的视频（可在 `yt-dlp` 参数和 Gemini 模型请求中自行调整）。

- **Gemini 返回格式非 JSON 怎么办？**
  `transcribeWithGemini` 会尝试清理 Markdown 代码块并解析 JSON，如仍失败请在 Actions 日志中查看原始响应并调整提示词。

- **yt-dlp 提示 `Sign in to confirm you're not a bot` 怎么办？**
  CLI 会自动切换到 Android 客户端参数重试，通常即可通过校验。若 GitHub Actions 仍然失败，可在本地导出浏览器登录态的 `cookies.txt`，将其内容保存为仓库 secret（例如 `YT_DLP_COOKIES`），工作流会在运行时写入临时文件并通过 `YT_DLP_COOKIES_PATH` 提供给 `yt-dlp`。本地调试同样可以手动设置 `YT_DLP_COOKIES_PATH=/path/to/cookies.txt`。

## 后续改进方向

- 增加缓存策略，避免重复下载同一视频；
- 为核心模块补充单元测试；
- 支持批量任务与定时触发；
- 引入更细粒度的状态文件，实时推送执行进度到 Pages。
