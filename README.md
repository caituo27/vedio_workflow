# 视频转文字

TypeScript 驱动的自动化流水线，可从 YouTube 或哔哩哔哩提取音频，通过 OpenRouter 调用 Gemini 模型生成中文分段文字稿，并把结果同步至 GitHub Pages。该项目主要运行在 GitHub Actions，也支持本地调试和自托管。

## 项目概览
- **多平台输入**：支持 YouTube 链接、哔哩哔哩链接或直接输入 BV 号。
- **语义分段文字稿**：通过 OpenRouter 调用 Gemini 识别音频、翻译非中文内容，并按语义输出带时间标记的段落。
- **自动发布**：生成的 Markdown 文件写入 `docs/data/word/`，同时更新 `docs/data/list/jobs.json` 供前端展示，再由 Actions 推送至 Pages。
- **可追踪状态**：状态索引保留最近一次成功记录，失败任务会被清理以避免污染列表。
- **模块化管线**：按照 ingest → transform → deliver 划分，每个阶段在 `src/` 下独立维护，便于扩展和调试。

## 架构与目录
```
├── src/
│   ├── cli/                # CLI 入口 (index.ts) 与本地调试脚本 (dev.ts)
│   ├── ingest/             # 下载器，基于 yt-dlp 拉取音频
│   ├── transform/          # Gemini 调用与结果解析
│   ├── deliver/            # Markdown 写入、任务状态管理
│   └── utils/              # 进程封装、日志、slug、文件系统工具
├── docs/
│   ├── data/list/jobs.json # 前端读取的任务索引
│   ├── data/word/          # 自动生成的文字稿 Markdown
│   ├── index.html          # GitHub Pages 首页与状态面板
│   └── viewer.html         # 文稿阅读器，配合 viewer.js 渲染
├── .github/workflows/      # Actions 工作流 (transcript.yml)
├── dist/                   # TypeScript 编译产物
├── package.json            # npm 脚本、依赖定义
├── tsconfig.json           # TypeScript 配置
└── README.md
```

运行期间会在 `.cache/audio/` 内暂存下载的音频文件，流水线结束后会自动清理。

## 环境要求
- Node.js 20+
- Python (供 `yt-dlp` 使用)
- `ffmpeg`/`ffprobe`
- OpenRouter API Key（默认使用 `google/gemini-2.0-flash-lite-001` 模型，可通过环境变量覆盖）
- 可选：`yt-dlp` cookies（绕过登录校验时使用）

## 安装与本地调试
```bash
npm install               # 安装依赖
npm run build             # 编译 TypeScript 到 dist/
DEV_VIDEO="https://youtu.be/xxxx" \
OPENROUTER_API_KEY="your-key" \
npm run dev               # 直接运行开发脚本
```

或使用 CLI 编译后执行：

```bash
npm run build
node dist/cli/index.js "https://youtu.be/xxxx"
```

输出的 Markdown 位于 `docs/data/word/<job-id>.md`，任务索引文件会同步更新。

## 环境变量
- `OPENROUTER_API_KEY`：必填，用于通过 OpenRouter 调用 Gemini；兼容旧的 `GEMINI_API_KEY`。
- `OPENROUTER_GEMINI_MODEL`：可选，OpenRouter 模型 ID（默认 `google/gemini-2.0-flash-lite-001`，兼容 `GEMINI_MODEL_ID` 和 `OPENROUTER_MODEL_ID`）。
- `DEV_VIDEO`：本地调试脚本读取的视频链接或 BV 号。
- `YT_DLP_COOKIES_PATH`：可选，指向 `yt-dlp` cookies 文件，应为绝对路径。
- `YT_DLP_COOKIES` (Actions Secret)：若设置，工作流会写入临时文件并自动声明 `YT_DLP_COOKIES_PATH`。

## CLI 使用指南
```bash
node dist/cli/index.js <video> [options]

选项：
  -k, --api-key <key>   覆盖默认的 OPENROUTER_API_KEY（兼容 GEMINI_API_KEY）
  -m, --model <id>      指定 OpenRouter 模型 ID（默认 google/gemini-2.0-flash-lite-001）
  -o, --output <dir>    自定义 Markdown 输出目录 (默认 docs/data/word)
```

默认会根据输入链接生成 `jobId`，并在状态索引中写入最新执行记录。

## GitHub Actions 工作流
- 定义：`.github/workflows/transcript.yml`
- 触发：手动 `workflow_dispatch(video_url)`
- 流程：
  1. 安装 Node.js 20 与 Python，准备 `yt-dlp` 与 `ffmpeg`；
  2. `npm install && npm run build` 编译 CLI；
  3. 若提供 cookies secret，则生成临时 cookies 文件；
  4. 使用 `node dist/cli/index.js <video_url>` 执行流水线；
  5. 有文稿生成时提交 `docs/` 变更并推送；
  6. 上传 Pages artifact，并在成功后部署。

如需排查错误，可在 Actions 日志中查看 `downloadAudio`、`transcribeWithGemini` 等阶段打印的上下文信息。

## GitHub Pages 前端
- `docs/index.html`：展示任务列表与查询入口，定期轮询 `jobs.json`。
- 查询输入可接受链接或 BV 号，客户端会对输入做归一与验证。
- 列表项点击后跳转到 `viewer.html`，在阅读器中以 Markdown 形式展示文字稿。
- 静态脚本会自动推断仓库归属，用于构建完整的 Pages 链接。

## 常见问题
- **长视频是否会超时？** 建议控制在 10 分钟以内，可按需调整 `yt-dlp` 参数或拆分音频。
- **Gemini 返回不是合法 JSON？** 管线会尝试通过 `jsonrepair` 纠正格式，仍失败时会抛出完整响应以便调试提示词。
- **如何清理临时音频？** CLI 在收尾阶段会尽可能删除 `.cache/audio/` 中生成的文件，若进程异常退出可手动清理。

## 后续规划
- 补充单元测试与端到端回归脚本。
- 支持批量排队与失败重试策略。
- 增加缓存策略以减少重复下载。
- 在 Markdown 中插入更多元数据（视频简介、章节等）。
