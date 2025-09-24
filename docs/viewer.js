import { marked } from "https://cdn.jsdelivr.net/npm/marked@12.0.2/lib/marked.esm.js";

const statusEl = document.getElementById("viewer-status");
const contentEl = document.getElementById("viewer-content");
const metaEl = document.getElementById("viewer-meta");
const titleEl = document.getElementById("viewer-title");
const shellEl = document.querySelector(".viewer-shell");
const themeToggleBtn = document.getElementById("theme-toggle");
const copyLinkBtn = document.getElementById("copy-link");
const openSourceLink = document.getElementById("open-source");
const progressBar = document.getElementById("progress-bar");
const progressValue = document.getElementById("progress-value");

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

if (copyLinkBtn) {
  copyLinkBtn.addEventListener("click", async () => {
    const originalLabel = copyLinkBtn.textContent;
    try {
      const copied = await copyText(window.location.href);
      copyLinkBtn.textContent = copied ? "已复制" : "复制失败";
    } catch (error) {
      console.error(error);
      copyLinkBtn.textContent = "复制失败";
    } finally {
      setTimeout(() => {
        copyLinkBtn.textContent = originalLabel;
      }, 1800);
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

  if (openSourceLink) {
    openSourceLink.href = sourceUrl;
  }

  if (metaEl) {
    if (metaItems.length) {
      metaEl.innerHTML = metaItems.map((item) => `<span>${marked.parseInline(item)}</span>`).join("");
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
  const lines = markdown.split(/\r?\n/);
  let index = 0;
  let title = null;

  if (lines[index] && /^#\s+/.test(lines[index])) {
    title = lines[index].replace(/^#\s+/, "").trim();
    index += 1;
  }

  while (index < lines.length && lines[index].trim() === "") {
    index += 1;
  }

  const metaItems = [];
  while (index < lines.length && /^-\s+/.test(lines[index])) {
    metaItems.push(lines[index].replace(/^-\s+/, "").trim());
    index += 1;
  }

  const body = lines.slice(index).join("\n");
  return { title, metaItems, body };
}

function enhanceParagraphs() {
  const paragraphs = contentEl.querySelectorAll("p");
  paragraphs.forEach((paragraph) => {
    const textToCopy = paragraph.textContent.trim();
    paragraph.classList.add("viewer-paragraph");

    if (!textToCopy) {
      return;
    }

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.textContent = "复制段落";
    copyButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      const original = copyButton.textContent;
      try {
        const copied = await copyText(textToCopy);
        copyButton.textContent = copied ? "已复制" : "复制失败";
      } catch (error) {
        console.error(error);
        copyButton.textContent = "复制失败";
      } finally {
        setTimeout(() => {
          copyButton.textContent = original;
        }, 1600);
      }
    });

    paragraph.appendChild(copyButton);
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

async function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch (error) {
    console.error(error);
    copied = false;
  } finally {
    document.body.removeChild(textarea);
  }

  return copied;
}
