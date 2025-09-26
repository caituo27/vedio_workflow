const JOBS_ENDPOINT = "./data/list/jobs.json";

const statusLabels = {
  processing: "处理中",
  completed: "已完成",
  failed: "失败",
};

const siteInfo = detectSiteInfo();
const MAX_VISIBLE_JOBS = 8;
const CARD_TRANSITION_MS = 280;
let latestJobMap = {};
let showingAllJobs = false;
let jobsMoreContainer;
let jobsMoreButton;

function detectSiteInfo() {
  const { origin, pathname, href, protocol } = window.location;
  const segments = pathname.split("/").filter(Boolean);
  const baseUrl = new URL(window.location.href);

  const directoryPath = (() => {
    if (pathname.endsWith("/")) {
      return pathname;
    }
    const lastSlash = pathname.lastIndexOf("/");
    if (lastSlash === -1) {
      return "/";
    }
    return pathname.slice(0, lastSlash + 1);
  })();

  let pagesBase = new URL("./", baseUrl).toString();
  if (protocol !== "file:") {
    pagesBase = new URL(directoryPath || "/", origin).toString();
  }

  const info = {
    owner: "caituo27",
    repo: "vedio_workflow",
    pagesBase,
    isFileProtocol: protocol === "file:",
    pageDir: directoryPath || "/",
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
  } else if (segments.length >= 2 && origin !== "null") {
    info.owner = segments[0];
    info.repo = segments[1];
    info.pagesBase = `${origin.replace(/\/$/, "")}/${segments[0]}/${segments[1]}/`;
  }

  return info;
}

function buildTranscriptLink(transcriptPath) {
  if (!transcriptPath) {
    return null;
  }
  const clean = transcriptPath
    .replace(/^docs\//i, "")
    .replace(/^\.\//, "")
    .replace(/^\//, "")
    .replace(/\\/g, "/");

  let rawUrl = transcriptPath;
  if (!/^https?:/i.test(transcriptPath)) {
    if (siteInfo.isFileProtocol) {
      rawUrl = clean;
    } else {
      try {
        const baseForRaw = new URL(siteInfo.pageDir || "/", window.location.origin);
        rawUrl = new URL(clean, baseForRaw).toString();
      } catch (error) {
        console.warn("无法解析 transcriptPath，使用相对路径", transcriptPath, error);
        rawUrl = clean;
      }
    }
  }

  let viewerHref;
  if (siteInfo.isFileProtocol) {
    viewerHref = `viewer.html?src=${encodeURIComponent(rawUrl)}`;
  } else {
    try {
      const dir = siteInfo.pageDir || "/";
      const normalisedDir = dir.endsWith("/") ? dir : `${dir}/`;
      const viewerUrl = new URL(`${normalisedDir}viewer.html`, window.location.origin);
      viewerUrl.searchParams.set("src", clean);
      viewerHref = viewerUrl.toString();
    } catch (error) {
      const fallbackDir = siteInfo.pageDir || "/";
      const normalisedDir = fallbackDir.endsWith("/") ? fallbackDir : `${fallbackDir}/`;
      viewerHref = `${window.location.origin}${normalisedDir}viewer.html?src=${encodeURIComponent(rawUrl)}`;
    }
  }

  return { viewerUrl: viewerHref, rawUrl, displayPath: clean };
}

async function fetchJobs() {
  try {
    const response = await fetch(`${JOBS_ENDPOINT}?cache=${Date.now()}`);
    if (!response.ok) {
      throw new Error(`无法获取任务列表: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error(error);
    return { jobs: {} };
  }
}

function slugify(input) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function extractUrlCandidate(value) {
  const match = value.match(/https?:\/\/[^\s]+/i);
  return match ? match[0] : null;
}

function extractBilibiliId(value) {
  const match = value.match(/BV[0-9A-Za-z]+/i);
  return match ? match[0] : null;
}

function normaliseInput(value) {
  const trimmed = value.trim();
  const candidateUrl = extractUrlCandidate(trimmed);
  const target = candidateUrl ?? trimmed;

  const isBiliId = /^(bv|BV)[0-9A-Za-z]+$/.test(target);
  if (isBiliId) {
    return {
      jobId: slugify(`bilibili-${target}`),
      display: `https://www.bilibili.com/video/${target}`,
    };
  }

  if (/youtube\.com|youtu\.be/.test(target)) {
    const url = target.startsWith("http") ? target : `https://${target}`;
    try {
      const parsed = new URL(url);
      let id = parsed.searchParams.get("v");
      if (parsed.hostname === "youtu.be") {
        id = parsed.pathname.slice(1);
      }
      if (!id) {
        throw new Error("无法解析 YouTube 视频 ID");
      }
      return {
        jobId: slugify(`youtube-${id}`),
        display: url,
      };
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  if (/bilibili\.com/.test(target)) {
    const url = target.startsWith("http") ? target : `https://${target}`;
    try {
      const parsed = new URL(url);
      const match = parsed.pathname.match(/BV[0-9A-Za-z]+/i);
      if (!match) {
        throw new Error("无法解析哔哩哔哩 BV 号");
      }
      return {
        jobId: slugify(`bilibili-${match[0]}`),
        display: url,
      };
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  const embeddedBiliId = extractBilibiliId(trimmed);
  if (embeddedBiliId) {
    return {
      jobId: slugify(`bilibili-${embeddedBiliId}`),
      display: `https://www.bilibili.com/video/${embeddedBiliId}`,
    };
  }

  return { isTitleSearch: true, query: trimmed.toLowerCase() };
}

const HTML_ESCAPE_LOOKUP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value) {
  if (value == null) {
    return "";
  }
  return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPE_LOOKUP[char] ?? char);
}

function formatDate(timestamp) {
  if (!timestamp) {
    return "";
  }
  try {
    return new Date(timestamp).toLocaleString();
  } catch (error) {
    return String(timestamp);
  }
}

function getSortedJobs() {
  return Object.values(latestJobMap).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function buildJobCardHTML(job) {
  const status = statusLabels[job.status] || job.status;
  const transcriptLink = buildTranscriptLink(job.transcriptPath);
  const hasTranscript = Boolean(transcriptLink);
  const jobTitle = escapeHtml(job.title || job.jobId || "未命名视频");
  const author = escapeHtml(job.author || "未知");
  const jobId = escapeHtml(job.jobId || "-");
  const updatedAt = escapeHtml(formatDate(job.updatedAt));
  const errorMessage = job.error ? `<p class="job-error">错误信息：${escapeHtml(job.error)}</p>` : "";
  const videoLink = job.videoUrl
    ? `<a href="${escapeHtml(job.videoUrl)}" target="_blank" rel="noreferrer">原视频</a>`
    : "";
  const cardAttributes = hasTranscript
    ? ` data-viewer-url="${escapeHtml(transcriptLink.viewerUrl)}" role="button" tabindex="0" aria-label="打开文字稿：${jobTitle}"`
    : "";
  const jobActions = hasTranscript ? "" : '<div class="job-actions"><span class="pending-hint">等待转写完成…</span></div>';

  return `
    <article class="job-card${hasTranscript ? " has-transcript" : ""}" data-job-id="${escapeHtml(job.jobId)}"${cardAttributes}>
      <div class="job-status-row">
        <span class="status ${job.status}">${escapeHtml(status)}</span>
        <span class="job-updated">${updatedAt}</span>
      </div>
      <h3>${jobTitle}</h3>
      <div class="job-meta">
        <span>作者：${author}</span>
        <span>任务 ID：${jobId}</span>
        ${videoLink ? `<span>${videoLink}</span>` : ""}
      </div>
      ${errorMessage}
      ${jobActions}
    </article>
  `;
}

function createJobCardElement(job) {
  const template = document.createElement("template");
  template.innerHTML = buildJobCardHTML(job).trim();
  return template.content.firstElementChild;
}

function mountInitialJobs(container) {
  const entries = getSortedJobs();
  const visibleEntries = entries.slice(0, MAX_VISIBLE_JOBS);

  if (!visibleEntries.length) {
    container.innerHTML = '<p class="hint">暂无任务数据。</p>';
  } else {
    container.innerHTML = visibleEntries.map((job) => buildJobCardHTML(job)).join("");
  }

  setupJobCardInteractions(container);
  updateMoreButton(entries.length > MAX_VISIBLE_JOBS);
  setMoreButtonDisabled(false);
}

function showMoreJobs(container, onComplete) {
  const entries = getSortedJobs();
  const additionalEntries = entries.slice(MAX_VISIBLE_JOBS);
  if (!additionalEntries.length) {
    if (typeof onComplete === "function") {
      onComplete();
    }
    return;
  }

  const existingIds = new Set(
    Array.from(container.querySelectorAll(".job-card"), (card) => card.dataset.jobId),
  );

  const fragment = document.createDocumentFragment();
  const newCards = [];

  additionalEntries.forEach((job) => {
    if (existingIds.has(job.jobId)) {
      return;
    }
    const card = createJobCardElement(job);
    card.classList.add("is-entering");
    fragment.appendChild(card);
    newCards.push(card);
  });

  if (!newCards.length) {
    if (typeof onComplete === "function") {
      onComplete();
    }
    return;
  }

  container.appendChild(fragment);

  requestAnimationFrame(() => {
    newCards.forEach((card) => {
      card.classList.add("is-entered");
    });
  });

  window.setTimeout(() => {
    newCards.forEach((card) => {
      card.classList.remove("is-entering", "is-entered");
    });
    if (typeof onComplete === "function") {
      onComplete();
    }
  }, CARD_TRANSITION_MS);
}

function hideExtraJobs(container, onComplete) {
  const allCards = Array.from(container.querySelectorAll(".job-card"));
  const extraCards = allCards.slice(MAX_VISIBLE_JOBS);
  if (!extraCards.length) {
    if (typeof onComplete === "function") {
      onComplete();
    }
    return;
  }

  extraCards.forEach((card) => {
    card.classList.add("is-leaving");
  });

  window.setTimeout(() => {
    extraCards.forEach((card) => card.remove());
    if (typeof onComplete === "function") {
      onComplete();
    }
  }, CARD_TRANSITION_MS);
}

function updateJobs(container, jobs) {
  latestJobMap = jobs;
  showingAllJobs = false;
  mountInitialJobs(container);
}

function updateLookupResult(container, jobs) {
  container.hidden = false;
  if (!jobs || jobs.length === 0) {
    container.innerHTML = '<p>未找到任务，请确认链接是否正确，或在 GitHub Actions 中手动触发新任务。</p>';
    return;
  }

  let htmlContent = '';
  jobs.forEach(job => {
    const status = statusLabels[job.status] || job.status;
    const transcriptLink = buildTranscriptLink(job.transcriptPath);
    const link = transcriptLink
      ? `<p><a href="${transcriptLink.viewerUrl}" target="_blank" rel="noreferrer">打开文字稿</a></p>`
      : '<p>任务仍在处理中，请稍后刷新页面。</p>';

    const errorMessage = job.error ? `<p class="error">错误信息：${job.error}</p>` : "";
    const author = job.author || "未知";

    htmlContent += `
      <h3>${escapeHtml(job.title || '未命名视频')}</h3>
      <p>状态：<span class="status ${job.status}">${status}</span></p>
      <p>作者：${author}</p>
      <p>最近更新：${new Date(job.updatedAt).toLocaleString()}</p>
      ${link}
      ${errorMessage}
      <hr>
    `;
  });
  container.innerHTML = htmlContent;
}

function setupWorkflowLink() {
  const link = document.getElementById("workflow-link");
  if (!link) return;
  link.href = `https://github.com/${siteInfo.owner}/${siteInfo.repo}/actions/workflows/transcript.yml`;

}

function setupJobCardInteractions(container) {
  if (!container || container.dataset.interactive === "true") return;

  const activateCard = (card, viaKeyboard = false) => {
    if (!card) return;
    const targetUrl = card.dataset.viewerUrl;
    if (!targetUrl) return;

    const hasModifier = viaKeyboard
      ? false
      : Boolean(window.event && (window.event.metaKey || window.event.ctrlKey || window.event.shiftKey || window.event.altKey));

    if (hasModifier) {
      window.open(targetUrl, "_blank", "noopener");
    } else {
      window.location.href = targetUrl;
    }
  };

  container.addEventListener("click", (event) => {
    const linkTarget = event.target.closest("a");
    if (linkTarget && container.contains(linkTarget)) {
      return;
    }
    const card = event.target.closest(".job-card[data-viewer-url]");
    if (!card || !container.contains(card)) return;
    activateCard(card);
  });

  container.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLAnchorElement) {
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest(".job-card[data-viewer-url]");
    if (!card || !container.contains(card)) return;
    event.preventDefault();
    activateCard(card, true);
  });

  container.dataset.interactive = "true";
}

function updateMoreButton(hasMore) {
  if (!jobsMoreContainer || !jobsMoreButton) return;
  if (!hasMore) {
    jobsMoreContainer.hidden = true;
    return;
  }

  jobsMoreContainer.hidden = false;
  jobsMoreButton.textContent = showingAllJobs ? "收起列表" : "查看更多";
}

function setMoreButtonDisabled(disabled) {
  if (jobsMoreButton) {
    jobsMoreButton.disabled = disabled;
  }
}

async function bootstrap() {
  setupWorkflowLink();
  const jobsContainer = document.getElementById("jobs");
  const resultContainer = document.getElementById("lookup-result");
  const form = document.getElementById("lookup-form");
  jobsMoreContainer = document.getElementById("jobs-more");
  jobsMoreButton = document.getElementById("jobs-more-button");

  if (jobsMoreButton) {
    jobsMoreButton.addEventListener("click", () => {
      if (jobsMoreButton.disabled) {
        return;
      }

      const totalJobs = getSortedJobs().length;
      if (totalJobs <= MAX_VISIBLE_JOBS) {
        return;
      }

      setMoreButtonDisabled(true);

      if (showingAllJobs) {
        showingAllJobs = false;
        updateMoreButton(true);
        hideExtraJobs(jobsContainer, () => {
          setMoreButtonDisabled(false);
          updateMoreButton(getSortedJobs().length > MAX_VISIBLE_JOBS);
        });
      } else {
        showingAllJobs = true;
        updateMoreButton(true);
        showMoreJobs(jobsContainer, () => {
          setMoreButtonDisabled(false);
          updateMoreButton(getSortedJobs().length > MAX_VISIBLE_JOBS);
        });
      }
    });
  }

  let jobs = await fetchJobs();
  updateJobs(jobsContainer, jobs.jobs || {});

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const input = formData.get("video-input") || document.getElementById("video-input").value;
    const normalized = normaliseInput(String(input));
    if (!normalized) {
      resultContainer.hidden = false;
      resultContainer.innerHTML = '<p>无法识别输入，请输入有效的链接或 BV 号。</p>';
      return;
    }

    // Refresh jobs before lookup to capture latest changes.
    jobs = await fetchJobs();
    const jobMap = jobs.jobs || {};
    updateJobs(jobsContainer, jobMap);

    let foundJobs = [];
    if (normalized.isTitleSearch) {
      const query = normalized.query;
      const allJobs = Object.values(jobMap);
      foundJobs = allJobs.filter(job => job.title && job.title.toLowerCase().includes(query)).slice(0, 10);
    } else {
      const job = jobMap[normalized.jobId];
      if (job) {
        foundJobs.push(job);
      }
    }

    updateLookupResult(resultContainer, foundJobs);
  });

  // Auto refresh job list every 60 seconds.
  setInterval(async () => {
    jobs = await fetchJobs();
    updateJobs(jobsContainer, jobs.jobs || {});
  }, 60_000);

  document.addEventListener('click', (event) => {
    if (!resultContainer || resultContainer.hidden) {
      return;
    }
    const isClickInsideResult = resultContainer.contains(event.target);
    const isClickInsideForm = form.contains(event.target);
    if (!isClickInsideResult && !isClickInsideForm) {
      resultContainer.hidden = true;
    }
  });
}

bootstrap();
