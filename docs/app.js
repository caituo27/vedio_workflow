const JOBS_ENDPOINT = "./data/list/jobs.json";

const statusLabels = {
  processing: "处理中",
  completed: "已完成",
  failed: "失败",
};

const siteInfo = detectSiteInfo();

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

function buildTranscriptLink(transcriptPath) {
  if (!transcriptPath) {
    return null;
  }
  const clean = transcriptPath
    .replace(/^docs\//i, "")
    .replace(/^\.\//, "")
    .replace(/^\//, "")
    .replace(/\\/g, "/");

  const rawUrl = /^https?:/i.test(transcriptPath)
    ? transcriptPath
    : `${siteInfo.pagesBase}${clean}`;

  const viewerUrl = `${siteInfo.pagesBase}viewer.html?src=${encodeURIComponent(rawUrl)}`;

  return { viewerUrl, rawUrl };
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

  return null;
}

function renderKpis(container, entries) {
  if (!container) return;

  if (!entries.length) {
    container.innerHTML = `
      <article class="kpi-card">
        <span class="kpi-label">暂无任务</span>
        <span class="kpi-value">0</span>
      </article>
    `;
    return;
  }

  const counters = entries.reduce(
    (acc, job) => {
      acc.total += 1;
      if (job.status === "completed") acc.completed += 1;
      if (job.status === "processing") acc.processing += 1;
      if (job.status === "failed") acc.failed += 1;
      return acc;
    },
    { total: 0, completed: 0, processing: 0, failed: 0 }
  );

  const kpiItems = [
    { key: "total", label: "全部任务", value: counters.total },
    { key: "completed", label: "已完成", value: counters.completed },
    { key: "processing", label: "处理中", value: counters.processing },
    { key: "failed", label: "失败", value: counters.failed },
  ];

  container.innerHTML = kpiItems
    .map(
      (item) => `
        <article class="kpi-card${item.key !== "total" ? ` is-${item.key}` : ""}">
          <span class="kpi-label">${item.label}</span>
          <span class="kpi-value">${item.value}</span>
        </article>
      `
    )
    .join("");
}

function renderJobs(container, jobs) {
  const entries = Object.values(jobs).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  if (!entries.length) {
    container.innerHTML = '<p class="hint">暂无任务数据。</p>';
    return { entries };
  }

  container.innerHTML = entries
    .map((job) => {
      const status = statusLabels[job.status] || job.status;
      const transcriptLink = buildTranscriptLink(job.transcriptPath);
      const author = job.author || "未知";
      const jobActions = transcriptLink
        ? [
            `<a href="${transcriptLink.viewerUrl}" target="_blank" rel="noreferrer">查看文字稿</a>`,
            `<a href="${transcriptLink.rawUrl}" target="_blank" rel="noreferrer">下载 Markdown</a>`,
          ].join("")
        : '<span class="pending-hint">任务仍在处理中</span>';
      const errorMessage = job.error
        ? `<p class="job-error">错误信息：${job.error}</p>`
        : "";

      return `
        <article class="job-card">
          <div class="job-card-head">
            <div class="job-status-row">
              <span class="status ${job.status}">${status}</span>
              <span class="job-updated">最近更新：${new Date(job.updatedAt).toLocaleString()}</span>
            </div>
            <h3>${job.title || job.jobId}</h3>
            <div class="job-meta">
              <span>作者：${author}</span>
              <span>视频：<a href="${job.videoUrl}" target="_blank" rel="noreferrer">打开原视频</a></span>
            </div>
            ${errorMessage}
          </div>
          <div class="job-actions">
            ${jobActions}
          </div>
        </article>
      `;
    })
    .join("");

  return { entries };
}

function updateLookupResult(container, job) {
  if (!job) {
    container.hidden = false;
    container.innerHTML = '<p>未找到任务，请确认链接是否正确，或在 GitHub Actions 中手动触发新任务。</p>';
    return;
  }

  const status = statusLabels[job.status] || job.status;
  const transcriptLink = buildTranscriptLink(job.transcriptPath);
  const link = transcriptLink
    ? `<p><a href="${transcriptLink.viewerUrl}" target="_blank" rel="noreferrer">打开文字稿</a> · <a href="${transcriptLink.rawUrl}" target="_blank" rel="noreferrer">下载 Markdown</a></p>`
    : '<p>任务仍在处理中，请稍后刷新页面。</p>';

  const errorMessage = job.error ? `<p class="error">错误信息：${job.error}</p>` : "";
  const author = job.author || "未知";

  container.hidden = false;
  container.innerHTML = `
    <p>状态：<span class="status ${job.status}">${status}</span></p>
    <p>作者：${author}</p>
    <p>最近更新：${new Date(job.updatedAt).toLocaleString()}</p>
    ${link}
    ${errorMessage}
  `;
}

function setupWorkflowLink() {
  const link = document.getElementById("workflow-link");
  if (!link) return;
  link.href = `https://github.com/${siteInfo.owner}/${siteInfo.repo}/actions/workflows/transcript.yml`;
}

async function bootstrap() {
  setupWorkflowLink();

  const jobsContainer = document.getElementById("jobs");
  const kpisContainer = document.getElementById("kpis");
  const resultContainer = document.getElementById("lookup-result");
  const form = document.getElementById("lookup-form");
  const refreshButton = document.getElementById("refresh-jobs");

  let jobs = await fetchJobs();
  const { entries } = renderJobs(jobsContainer, jobs.jobs || {});
  renderKpis(kpisContainer, entries || []);

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
    const lookupEntries = renderJobs(jobsContainer, jobMap);
    renderKpis(kpisContainer, lookupEntries.entries || []);
    const job = jobMap[normalized.jobId];
    updateLookupResult(resultContainer, job ?? null);
  });

  if (refreshButton) {
    refreshButton.addEventListener("click", async () => {
      refreshButton.disabled = true;
      refreshButton.classList.add("is-busy");
      jobs = await fetchJobs();
      const { entries: refreshedEntries } = renderJobs(jobsContainer, jobs.jobs || {});
      renderKpis(kpisContainer, refreshedEntries || []);
      setTimeout(() => {
        refreshButton.disabled = false;
        refreshButton.classList.remove("is-busy");
      }, 400);
    });
  }

  // Auto refresh job list every 60 seconds.
  setInterval(async () => {
    jobs = await fetchJobs();
    const { entries: refreshedEntries } = renderJobs(jobsContainer, jobs.jobs || {});
    renderKpis(kpisContainer, refreshedEntries || []);
  }, 60_000);
}

bootstrap();
