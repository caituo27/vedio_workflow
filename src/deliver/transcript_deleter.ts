import { promises as fs } from "node:fs";
import path from "node:path";
import { readJsonFile, writeJsonFile } from "../utils/fs.js";
import { info, error as logError } from "../utils/logger.js";
import type { JobIndex } from "./status_manager.js";

const STATUS_FILE = path.resolve("docs/data/list/jobs.json");

export type DeleteResult = {
    jobId: string;
    deleted: boolean;
    markdownDeleted: boolean;
    indexUpdated: boolean;
};

async function loadIndex(): Promise<JobIndex> {
    const data = await readJsonFile<JobIndex>(STATUS_FILE);
    if (data) {
        return data;
    }
    return { jobs: {} };
}

async function saveIndex(index: JobIndex): Promise<void> {
    await writeJsonFile(STATUS_FILE, index);
}

async function deleteMarkdownFile(jobId: string, outputDir?: string): Promise<boolean> {
    const finalDir = outputDir ?? path.resolve("docs/data/word");
    const markdownPath = path.join(finalDir, `${jobId}.md`);

    try {
        await fs.unlink(markdownPath);
        info(`已删除 Markdown 文件: ${markdownPath}`);
        return true;
    } catch (err) {
        const error = err as NodeJS.ErrnoException;
        if (error.code === "ENOENT") {
            info(`Markdown 文件不存在: ${markdownPath}`);
            return false;
        }
        logError(`删除 Markdown 文件失败: ${error.message}`);
        return false;
    }
}

async function removeFromIndex(jobId: string): Promise<boolean> {
    try {
        const index = await loadIndex();

        if (!index.jobs[jobId]) {
            info(`任务 ${jobId} 不存在于索引中`);
            return false;
        }

        delete index.jobs[jobId];
        await saveIndex(index);
        info(`已从索引中移除任务: ${jobId}`);
        return true;
    } catch (err) {
        logError(`更新索引失败: ${(err as Error).message}`);
        return false;
    }
}

export async function deleteTranscript(
    jobId: string,
    options?: { outputDir?: string },
): Promise<DeleteResult> {
    info(`开始删除文字稿: ${jobId}`);

    const markdownDeleted = await deleteMarkdownFile(jobId, options?.outputDir);
    const indexUpdated = await removeFromIndex(jobId);

    const deleted = markdownDeleted || indexUpdated;

    if (deleted) {
        info(`文字稿删除完成: ${jobId}`);
    } else {
        logError(`文字稿删除失败: ${jobId} (文件和索引记录均不存在)`);
    }

    return {
        jobId,
        deleted,
        markdownDeleted,
        indexUpdated,
    };
}
