import path from "node:path";
import { readJsonFile, writeJsonFile, ensureDir } from "../utils/fs.js";
import { info } from "../utils/logger.js";

export type JobStatus = "processing" | "completed" | "failed";

export type JobRecord = {
    jobId: string;
    title: string;
    videoUrl: string;
    transcriptPath?: string;
    status: JobStatus;
    updatedAt: string;
    error?: string;
    author?: string;
};

export type JobIndex = {
    jobs: Record<string, JobRecord>;
};

const STATUS_FILE = path.resolve("docs/data/list/jobs.json");

function sanitiseTranscriptPath(transcriptPath: string): string {
    const normalised = transcriptPath
        .replace(/^docs\//i, "")
        .replace(/^\.\//, "")
        .replace(/^\//, "")
        .replace(/\\/g, "/");
    return normalised;
}

async function loadIndex(): Promise<JobIndex> {
    const data = await readJsonFile<JobIndex>(STATUS_FILE);
    if (data) {
        const filteredEntries = Object.fromEntries(
            Object.entries(data.jobs).filter(([, record]) => record.status !== "failed"),
        );
        return { jobs: filteredEntries };
    }
    return { jobs: {} };
}

async function saveIndex(index: JobIndex): Promise<void> {
    const filteredEntries = Object.fromEntries(
        Object.entries(index.jobs).filter(([, record]) => record.status !== "failed"),
    );
    await ensureDir(path.dirname(STATUS_FILE));
    await writeJsonFile(STATUS_FILE, { jobs: filteredEntries });
}

export async function updateJob(record: JobRecord): Promise<void> {
    const index = await loadIndex();
    index.jobs[record.jobId] = record;
    info(`更新任务状态: ${record.jobId} -> ${record.status}`);
    await saveIndex(index);
}

export async function markProcessing(
    jobId: string,
    details: { title: string; videoUrl: string; author?: string },
): Promise<JobRecord> {
    const record = {
        jobId,
        title: details.title,
        videoUrl: details.videoUrl,
        status: "processing",
        updatedAt: new Date().toISOString(),
        ...(details.author ? { author: details.author } : {}),
    } satisfies JobRecord;
    await updateJob(record);
    return record;
}

export async function markCompleted(
    jobId: string,
    details: { title: string; videoUrl: string; transcriptPath: string; author?: string },
): Promise<JobRecord> {
    const transcriptPath = sanitiseTranscriptPath(details.transcriptPath);
    const record = {
        jobId,
        title: details.title,
        videoUrl: details.videoUrl,
        transcriptPath,
        status: "completed",
        updatedAt: new Date().toISOString(),
        ...(details.author ? { author: details.author } : {}),
    } satisfies JobRecord;
    await updateJob(record);
    return record;
}

export async function markFailed(
    jobId: string,
    details: { title: string; videoUrl: string; error: Error; author?: string },
): Promise<JobRecord> {
    const record = {
        jobId,
        title: details.title,
        videoUrl: details.videoUrl,
        status: "failed",
        updatedAt: new Date().toISOString(),
        error: details.error.message,
        ...(details.author ? { author: details.author } : {}),
    } satisfies JobRecord;
    await updateJob(record);
    return record;
}
