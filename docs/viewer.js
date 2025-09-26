import { marked } from "https://cdn.jsdelivr.net/npm/marked@12.0.2/lib/marked.esm.js";

const statusEl = document.getElementById("viewer-status");
const contentEl = document.getElementById("viewer-content");
const metaEl = document.getElementById("viewer-meta");
const titleEl = document.getElementById("viewer-title");
const shellEl = document.querySelector(".viewer-shell");
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
})();

(function handleProgressListeners() {
  const throttled = throttle(updateProgress, 80);
  window.addEventListener("scroll", throttled, { passive: true });
  window.addEventListener("resize", () => {
    measureArticle(throttled);
  });
})();

(async function main() {
  const brand = document.querySelector(".nav-brand");
  if (brand) {
    const link = document.createElement("a");
    link.href = "./index.html";
    link.className = brand.className;
    link.style.textDecoration = "none";
    link.append(...brand.childNodes);
    brand.replaceWith(link);
  }

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
})()

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

  const htmlWithExtraBreaks = marked.parse(body, { mangle: false, headerIds: false, breaks: true }).replace(/<br>/g, "<br><br>");
  contentEl.innerHTML = htmlWithExtraBreaks;
  contentEl.hidden = false;
  statusEl.hidden = true;

  enhanceParagraphs();
  measureArticle(updateProgress);

  const videoLinkItem = metaItems.find((item) => item.toLowerCase().startsWith("视频链接"));
  const sourceLinkItem = `原始文本：<a href="#" id="view-source-link">点击查看</a>`;

  const footerLinks = [videoLinkItem, sourceLinkItem].filter(Boolean);

  if (footerLinks.length > 0) {
    const footerEl = document.createElement("footer");
    footerEl.className = "viewer-thread-footer";
    footerEl.innerHTML = footerLinks.map((item) => `<span>${marked.parseInline(item)}</span>`).join(" · ");
    contentEl.insertAdjacentElement("afterend", footerEl);

    const viewSourceLink = document.getElementById("view-source-link");
    if (viewSourceLink) {
      viewSourceLink.addEventListener("click", async (event) => {
        event.preventDefault();
        try {
          const response = await fetch(sourceUrl);
          if (!response.ok) {
            throw new Error(`无法获取原始文件: ${response.status}`);
          }
          const text = await response.text();
          const newTab = window.open();
          newTab.document.write("<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><title>原始文本</title><style>body { white-space: pre-wrap; font-family: monospace; padding: 1rem; color: #333; background: #fdfdfd; }</style></head><body></body></html>");
          newTab.document.body.textContent = text;
          newTab.document.close();
        } catch (error) {
          console.error("查看原始文本失败:", error);
          alert("无法加载原始文本文件。详情请查看控制台。");
        }
      });
    }
  }
}

function setError(message) {
  statusEl.textContent = message;
  statusEl.classList.add("error");
}

function detectSiteInfo() {
  const { origin, pathname, href, protocol } = window.location;
  const segments = pathname.split("/").filter(Boolean);
  const baseUrl = new URL(window.location.href);
  const pagesBase = new URL("./", baseUrl).toString();
  const info = {
    owner: "caituo27",
    repo: "vedio_workflow",
    pagesBase,
    isFileProtocol: protocol === "file:",
  };

  if (protocol === "file:") {
    return info;
  }

  const hostMatch = origin.match(/^https:\/\/([^\.]+)\.github\.io/i);

  if (hostMatch) {
    info.owner = hostMatch[1];
    if (segments.length >= 1) {
      info.repo = segments[0];
      info.pagesBase = `${origin.replace(/\/$/, "")}/${info.repo}/`;
    }
  }
  else if (segments.length >= 2 && origin !== "null") {
    info.owner = segments[0];
    info.repo = segments[1];
    info.pagesBase = `${origin.replace(/\/$/, "")}/${segments[0]}/${segments[1]}/`;
  }

  return info;
}

function resolveSource(src) {
  const normalised = src.replace(/^\.\//, "").replace(/^\//, "");

  try {
    return new URL(src).toString();
  } catch (error) {
    if (siteInfo.isFileProtocol) {
      return normalised;
    }
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

function buildMetaItems(metaItems) {
  return metaItems.filter((item) => {
    const normalised = item.trim().toLowerCase();
    if (normalised.startsWith("原始语言")) return false;
    if (normalised.startsWith("视频作者")) return false;
    if (normalised.startsWith("生成时间")) return false;
    if (normalised.startsWith("视频链接")) return false;
    if (normalised.startsWith("原始文本")) return false;
    return true;
  });
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
  const isDark = theme === "dark";
  shellEl.classList.toggle("viewer-dark", isDark);
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
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

(function handleNavVisibility() {
  let lastScrollY = window.scrollY;
  const header = document.querySelector('.nav[data-animate]');
  const footer = document.querySelector('.footer[data-animate]');
  const threshold = 200; // Only hide after scrolling 200px

  window.addEventListener('scroll', () => {
    if (!header || !footer) {
      return;
    }

    if (window.scrollY > lastScrollY && window.scrollY > threshold) {
      // Scrolling down
      header.classList.add('is-hidden');
      footer.classList.add('is-hidden');
    } else {
      // Scrolling up
      header.classList.remove('is-hidden');
      footer.classList.remove('is-hidden');
    }
    lastScrollY = window.scrollY;
  });
})();