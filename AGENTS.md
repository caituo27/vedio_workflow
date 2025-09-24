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
