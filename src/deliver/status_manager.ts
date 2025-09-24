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
};

export type JobIndex = {
    jobs: Record<string, JobRecord>;
};

const STATUS_FILE = path.resolve("docs/data/jobs.json");

async function loadIndex(): Promise<JobIndex> {
    const data = await readJsonFile<JobIndex>(STATUS_FILE);
    if (data) {
        return data;
    }
    return { jobs: {} };
}

async function saveIndex(index: JobIndex): Promise<void> {
    await ensureDir(path.dirname(STATUS_FILE));
    await writeJsonFile(STATUS_FILE, index);
}

export async function updateJob(record: JobRecord): Promise<void> {
    const index = await loadIndex();
    index.jobs[record.jobId] = record;
    info(`更新任务状态: ${record.jobId} -> ${record.status}`);
    await saveIndex(index);
}

export async function markProcessing(
    jobId: string,
    details: { title: string; videoUrl: string },
): Promise<JobRecord> {
    const record: JobRecord = {
        jobId,
        title: details.title,
        videoUrl: details.videoUrl,
        status: "processing",
        updatedAt: new Date().toISOString(),
    };
    await updateJob(record);
    return record;
}

export async function markCompleted(
    jobId: string,
    details: { title: string; videoUrl: string; transcriptPath: string },
): Promise<JobRecord> {
    const record: JobRecord = {
        jobId,
        title: details.title,
        videoUrl: details.videoUrl,
        transcriptPath: details.transcriptPath,
        status: "completed",
        updatedAt: new Date().toISOString(),
    };
    await updateJob(record);
    return record;
}

export async function markFailed(
    jobId: string,
    details: { title: string; videoUrl: string; error: Error },
): Promise<JobRecord> {
    const record: JobRecord = {
        jobId,
        title: details.title,
        videoUrl: details.videoUrl,
        status: "failed",
        updatedAt: new Date().toISOString(),
        error: details.error.message,
    };
    await updateJob(record);
    return record;
}
