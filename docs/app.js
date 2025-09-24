const JOBS_ENDPOINT = "./data/jobs.json";

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
  if (/^https?:/i.test(transcriptPath)) {
    return transcriptPath;
  }
  const clean = transcriptPath
    .replace(/^docs\//i, "")
    .replace(/^\.\//, "")
    .replace(/^\//, "");
  try {
    const absolute = new URL(clean, siteInfo.pagesBase).toString();
    return absolute;
  } catch (error) {
    console.error("链接解析失败", error);
    return `${siteInfo.pagesBase}${clean}`;
  }
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

function renderJobs(container, jobs) {
  const entries = Object.values(jobs).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (!entries.length) {
    container.innerHTML = '<p class="hint">暂无任务数据。</p>';
    return;
  }

  container.innerHTML = entries
    .map((job) => {
      const status = statusLabels[job.status] || job.status;
      const transcriptUrl = buildTranscriptLink(job.transcriptPath);
      const link = transcriptUrl
        ? `<a href="${transcriptUrl}" target="_blank" rel="noreferrer">查看文字稿</a>`
        : "";
      const errorMessage = job.error
        ? `<p class="error">错误信息：${job.error}</p>`
        : "";
      return `
        <article class="job-card">
          <h3>${job.title || job.jobId}</h3>
          <p><span class="status ${job.status}">${status}</span></p>
          <p>视频链接：<a href="${job.videoUrl}" target="_blank" rel="noreferrer">打开</a></p>
          <p>最近更新：${new Date(job.updatedAt).toLocaleString()}</p>
          ${link ? `<p>${link}</p>` : ""}
          ${errorMessage}
        </article>
      `;
    })
    .join("");
}

function updateLookupResult(container, job) {
  if (!job) {
    container.hidden = false;
    container.innerHTML = '<p>未找到任务，请确认链接是否正确，或在 GitHub Actions 中手动触发新任务。</p>';
    return;
  }

  const status = statusLabels[job.status] || job.status;
  const transcriptUrl = buildTranscriptLink(job.transcriptPath);
  const link = transcriptUrl
    ? `<p><a href="${transcriptUrl}" target="_blank" rel="noreferrer">打开文字稿</a></p>`
    : '<p>任务仍在处理中，请稍后刷新页面。</p>';

  const errorMessage = job.error ? `<p class="error">错误信息：${job.error}</p>` : "";

  container.hidden = false;
  container.innerHTML = `
    <p>状态：<span class="status ${job.status}">${status}</span></p>
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
  const resultContainer = document.getElementById("lookup-result");
  const form = document.getElementById("lookup-form");

  let jobs = await fetchJobs();
  renderJobs(jobsContainer, jobs.jobs || {});

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
    const job = jobs.jobs ? jobs.jobs[normalized.jobId] : undefined;
    updateLookupResult(resultContainer, job ?? null);
  });

  // Auto refresh job list every 60 seconds.
  setInterval(async () => {
    jobs = await fetchJobs();
    renderJobs(jobsContainer, jobs.jobs || {});
  }, 60_000);
}

bootstrap();
