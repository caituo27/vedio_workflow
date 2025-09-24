# Repository Guidelines

## Project Structure & Module Organization
Start by keeping runtime code under `src/` with one folder per pipeline stage. For example, ingest adapters should live in `src/ingest/`, transformation routines in `src/transform/`, and delivery logic in `src/deliver/`. CLI entry points and orchestration helpers belong in `src/cli/`. Store reusable shell or ffmpeg helpers in `scripts/`. Place sample footage and fixtures in `assets/` (use short clips ≤10s). When adding documentation or diagrams, place them in `docs/`. Tests live in `tests/` and mirror the `src/` tree.

## Build, Test, and Development Commands
Create or reuse the `Makefile` helpers below to keep workflows consistent:
- `make setup` – create the virtualenv and install `requirements.txt`.
- `make dev` – run the default pipeline against `assets/sample.mp4` and stream logs to the console.
- `make build` – generate distributable artifacts in `dist/` (Docker image or zipped CLI).
- `make lint` – run static analysis and formatting checks.
If you prefer raw commands, use `python -m pip install -r requirements.txt`, `pytest`, and `python -m vedio_workflow.cli run config/dev.yaml`.

## Coding Style & Naming Conventions
Target Python 3.11, use 4-space indentation, and keep lines ≤100 chars. Modules and packages follow `snake_case`; classes use `PascalCase`; CLI commands use hyphenated names. Run `ruff format` before committing. Configuration files should be lowercase with dashes, e.g., `configs/live-stream.yaml`.

## Testing Guidelines
Use `pytest` with fixtures under `tests/fixtures`. Name tests after the feature they cover (`test_transcode_queue.py`). High-impact code (pipeline scheduling, retries, billing) must include regression tests and should reach ≥85% coverage. For ffmpeg-heavy logic, add golden-file snapshots under `tests/data/`.

## Commit & Pull Request Guidelines
Write commits using imperative mood and the pattern `area: summary` (`pipeline: add retry backoff`). Keep PRs scoped to one change set, include a short checklist of verification steps, and attach screenshots or log snippets for pipeline runs. Link related issues with `Closes #ID` and flag breaking changes in the description. Request reviews from at least one maintainer familiar with the touched pipeline.

## 当前任务
1. 明确需求与假设：Gemini API 密钥通过 GitHub Secrets 配置；输出按内容分段的中文 Markdown 文字稿（非中文音频需自动翻译为中文）；`src/deliver` 负责 Markdown 生成；GitHub Pages 前端需提供入口，允许用户输入 YouTube 或哔哩哔哩视频链接，并查看任务状态与结果。
2. 设计 TypeScript 模块：`src/ingest` 负责根据输入链接下载视频并抽取音频；`src/transform` 使用 Gemini 完成转录、翻译与分段；`src/deliver` 输出 Markdown 文件并写入 `docs/`；`src/cli` 负责整体流程编排；GitHub Pages 前端提供链接输入表单并轮询工作流状态。
3. 搭建基础设施：编写 `README.md` 说明项目结构与工作流程；创建 GitHub Actions 工作流驱动脚本执行（读取 Secrets，更新 Pages 内容）；记录密钥配置方式；确保工作流产出能同步任务状态与最终文字稿到静态站点。
