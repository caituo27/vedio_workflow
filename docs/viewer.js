import { marked } from "https://cdn.jsdelivr.net/npm/marked@12.0.2/lib/marked.esm.js";

const statusEl = document.getElementById("viewer-status");
const contentEl = document.getElementById("viewer-content");
const metaEl = document.getElementById("viewer-meta");
const titleEl = document.getElementById("viewer-title");
const shellEl = document.querySelector(".viewer-shell");
const themeToggleBtn = document.getElementById("theme-toggle");
const progressBar = document.getElementById("progress-bar");
const progressValue = document.getElementById("progress-value");
const actionsToggleBtn = document.getElementById("actions-toggle");
const actionsContainer = document.getElementById("viewer-actions");

const THEME_STORAGE_KEY = "vw-viewer-theme";
let articleTop = 0;
let articleHeight = 1;

const siteInfo = detectSiteInfo();
const params = new URLSearchParams(window.location.search);
const srcParam = params.get("src");

(function initTheme() {
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  const initialTheme = storedTheme || (prefersDark ? "dark" : "light");
  applyTheme(initialTheme);

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", () => {
      const nextTheme = shellEl.dataset.theme === "dark" ? "light" : "dark";
      applyTheme(nextTheme);
    });
  }
})();

if (actionsToggleBtn && actionsContainer) {
  actionsToggleBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpen = actionsContainer.classList.toggle("is-open");
    actionsToggleBtn.setAttribute("aria-expanded", String(isOpen));
  });

  document.addEventListener("click", (event) => {
    if (!actionsContainer.classList.contains("is-open")) {
      return;
    }
    if (event.target instanceof Node && (actionsContainer.contains(event.target) || actionsToggleBtn.contains(event.target))) {
      return;
    }
    actionsContainer.classList.remove("is-open");
    actionsToggleBtn.setAttribute("aria-expanded", "false");
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 768 && actionsContainer.classList.contains("is-open")) {
      actionsContainer.classList.remove("is-open");
      actionsToggleBtn.setAttribute("aria-expanded", "false");
    }
  });
}

(function handleProgressListeners() {
  const throttled = throttle(updateProgress, 80);
  window.addEventListener("scroll", throttled, { passive: true });
  window.addEventListener("resize", () => {
    measureArticle(throttled);
  });
})();

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
  const { title, metaItems, body } = splitMarkdown(markdown);
  const displayTitle = title || "文字稿";

  document.title = `${displayTitle} · 文字稿`;
  if (titleEl) {
    titleEl.textContent = displayTitle;
  }

  if (metaEl) {
    const metaFragments = buildMetaItems(metaItems, sourceUrl);
    if (metaFragments.length) {
      metaEl.innerHTML = metaFragments.map((item) => `<span>${marked.parseInline(item)}</span>`).join("");
    } else {
      metaEl.innerHTML = "";
    }
  }

  const html = marked.parse(body, { mangle: false, headerIds: false });
  contentEl.innerHTML = html;
  contentEl.hidden = false;
  statusEl.hidden = true;

  enhanceParagraphs();
  measureArticle(updateProgress);
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

function splitMarkdown(markdown) {
  let remaining = markdown;
  let title = null;

  const titleMatch = remaining.match(/^#\s+(.+?)\s*(?:\r?\n|$)/);
  if (titleMatch) {
    title = titleMatch[1].trim();
    remaining = remaining.slice(titleMatch[0].length);
  }

  const metaMatch = remaining.match(/^(?:-\s+.*(?:\r?\n|$))+\s*/);
  let metaItems = [];
  if (metaMatch) {
    const metaBlock = metaMatch[0];
    metaItems = metaBlock
      .split(/\r?\n/)
      .map((line) => line.replace(/^-\s+/, "").trim())
      .filter(Boolean);
    remaining = remaining.slice(metaBlock.length);
  }

  return { title, metaItems, body: remaining };
}

function buildMetaItems(metaItems, sourceUrl) {
  const filtered = metaItems.filter((item) => {
    const normalised = item.trim();
    const compact = normalised.replace(/\s+/g, "").toLowerCase();
    if (compact.startsWith("原始语言")) return false;
    if (compact.startsWith("视频作者")) return false;
    if (compact.startsWith("生成时间")) return false;
    return true;
  });

  const result = [...filtered];
  const videoIndex = result.findIndex((item) => /^视频链接/i.test(item));
  const sourceLabel = `原始文本：[点击查看](${sourceUrl})`;

  if (videoIndex !== -1) {
    result.splice(videoIndex + 1, 0, sourceLabel);
  } else {
    result.push(sourceLabel);
  }

  return result;
}

function enhanceParagraphs() {
  const paragraphs = contentEl.querySelectorAll("p");
  paragraphs.forEach((paragraph) => {
    paragraph.classList.add("viewer-paragraph");
  });
}

function measureArticle(afterMeasure) {
  requestAnimationFrame(() => {
    const rect = contentEl.getBoundingClientRect();
    articleTop = rect.top + window.scrollY;
    articleHeight = Math.max(contentEl.offsetHeight, 1);
    if (typeof afterMeasure === "function") {
      afterMeasure();
    }
  });
}

function updateProgress() {
  if (!progressBar || !progressValue) {
    return;
  }

  const scrollPos = window.scrollY + 120;
  const distance = scrollPos - articleTop;
  const ratio = Math.min(Math.max(distance / articleHeight, 0), 1);

  progressBar.style.height = `${ratio * 100}%`;
  progressValue.textContent = `${Math.round(ratio * 100)}%`;
}

function applyTheme(theme) {
  if (!shellEl) {
    return;
  }
  const next = theme === "dark" ? "dark" : "light";
  shellEl.dataset.theme = next;
  window.localStorage.setItem(THEME_STORAGE_KEY, next);
  if (themeToggleBtn) {
    themeToggleBtn.textContent = next === "dark" ? "☀️" : "🌙";
  }
}

function throttle(fn, wait) {
  let lastTime = 0;
  return function throttled(...args) {
    const now = Date.now();
    if (now - lastTime >= wait) {
      lastTime = now;
      fn.apply(this, args);
    }
  };
}
