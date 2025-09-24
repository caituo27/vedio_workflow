import { marked } from "https://cdn.jsdelivr.net/npm/marked@12.0.2/lib/marked.esm.js";

const statusEl = document.getElementById("viewer-status");
const contentEl = document.getElementById("viewer-content");
const titleEl = document.getElementById("viewer-title");
const metaEl = document.getElementById("viewer-meta");

const siteInfo = detectSiteInfo();
const params = new URLSearchParams(window.location.search);
const srcParam = params.get("src");

(async function main() {
  if (!srcParam) {
    setError("缺少 src 参数，无法定位文字稿文件。");
    return;
  }

  const sourceUrl = resolveSource(srcParam);
  if (!sourceUrl) {
    setError("无法解析文字稿地址。");
    return;
  }

  try {
    const response = await fetch(`${sourceUrl}?cache=${Date.now()}`);
    if (!response.ok) {
      throw new Error(`获取文字稿失败：${response.status}`);
    }

    const markdown = await response.text();
    renderMarkdown(markdown, sourceUrl);
  } catch (error) {
    console.error(error);
    setError((error && error.message) || "加载失败");
  }
})();

function renderMarkdown(markdown, sourceUrl) {
  const headingMatch = markdown.match(/^#\s+(.+)$/m);
  const displayTitle = headingMatch ? headingMatch[1].trim() : "文字稿";

  titleEl.textContent = displayTitle;
  document.title = `${displayTitle} · 文字稿`;

  const html = marked.parse(markdown, { mangle: false, headerIds: false });
  contentEl.innerHTML = html;
  contentEl.hidden = false;
  statusEl.hidden = true;

  metaEl.innerHTML = `
    <span>原始 Markdown：<a href="${sourceUrl}" target="_blank" rel="noreferrer">打开原文件</a></span>
  `;
}

function setError(message) {
  statusEl.textContent = message;
  statusEl.classList.add("error");
}

function detectSiteInfo() {
  const { origin, pathname } = window.location;
  const segments = pathname.split("/").filter(Boolean);
  const info = {
    owner: "USERNAME",
    repo: "vedio_workflow",
    pagesBase: `${origin.replace(/\/$/, "")}/`,
  };

  const hostMatch = origin.match(/^https:\/\/([^\.]+)\.github\.io/i);

  if (hostMatch) {
    info.owner = hostMatch[1];
    if (segments.length >= 1) {
      info.repo = segments[0];
      info.pagesBase = `${origin.replace(/\/$/, "")}/${info.repo}/`;
    }
  } else if (segments.length >= 2) {
    info.owner = segments[0];
    info.repo = segments[1];
    info.pagesBase = `${origin.replace(/\/$/, "")}/${segments[0]}/${segments[1]}/`;
  }

  return info;
}

function resolveSource(src) {
  try {
    return new URL(src).toString();
  } catch (error) {
    const normalised = src.replace(/^\.\//, "").replace(/^\//, "");
    try {
      return new URL(normalised, siteInfo.pagesBase).toString();
    } catch (err) {
      console.error(err);
      return null;
    }
  }
}
