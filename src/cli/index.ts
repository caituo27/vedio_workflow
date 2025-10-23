#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import { promises as fs } from "node:fs";
import { parseVideoSource, buildJobId } from "../utils/video.js";
import { success, error as logError } from "../utils/logger.js";
import { downloadAudio } from "../ingest/downloader.js";
import { transcribeWithGemini } from "../transform/gemini_transcriber.js";
import { deliverMarkdown } from "../deliver/markdown_writer.js";
import {
    markProcessing,
    markCompleted,
    markFailed,
    updateJob,
} from "../deliver/status_manager.js";
import type { JobRecord } from "../deliver/status_manager.js";
import { deleteTranscript } from "../deliver/transcript_deleter.js";

export type PipelineOptions = {
    apiKey?: string;
    output?: string;
};

/**
 * 解析多个视频链接，支持空格、换行、逗号、分号分隔
 */
function parseMultipleVideos(input: string): string[] {
    return input
        .split(/[\s,;，；\n\r]+/)  // 支持空格、逗号、分号（中英文）、换行符
        .map(url => url.trim())
        .filter(url => url.length > 0);
}

export async function runPipeline(videoInput: string, options: PipelineOptions): Promise<void> {
    const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error("缺少 GEMINI_API_KEY，请通过环境变量或 --api-key 传入。");
    }

    const source = parseVideoSource(videoInput);
    const jobId = buildJobId(source);

    let downloadResult: Awaited<ReturnType<typeof downloadAudio>> | undefined;

    try {
        await markProcessing(jobId, {
            title: source.videoUrl,
            videoUrl: source.videoUrl,
        });

        downloadResult = await downloadAudio(source);

        const processingRecord = {
            jobId,
            title: downloadResult.title,
            videoUrl: source.videoUrl,
            status: "processing",
            updatedAt: new Date().toISOString(),
            ...(downloadResult.author ? { author: downloadResult.author } : {}),
        } satisfies JobRecord;

        await updateJob(processingRecord);

        const transcriptOptions: { title: string; durationSeconds?: number } = {
            title: downloadResult.title,
        };
        if (typeof downloadResult.durationSeconds === "number") {
            transcriptOptions.durationSeconds = downloadResult.durationSeconds;
        }

        const transcript = await transcribeWithGemini(apiKey, downloadResult.audioPath, transcriptOptions);

        const deliverOptions: {
            jobId: string;
            title: string;
            videoUrl: string;
            outputDir?: string;
            author?: string;
        } = {
            jobId,
            title: downloadResult.title,
            videoUrl: source.videoUrl,
        };
        if (options.output) {
            deliverOptions.outputDir = options.output;
        }
        if (downloadResult.author) {
            deliverOptions.author = downloadResult.author;
        }

        const { markdownPath } = await deliverMarkdown(transcript, deliverOptions);
        const relativeTranscriptPath = path.relative(path.resolve("docs"), markdownPath);

        const completionDetails = {
            title: downloadResult.title,
            videoUrl: source.videoUrl,
            transcriptPath: relativeTranscriptPath.replace(/\\/g, "/"),
            ...(downloadResult.author ? { author: downloadResult.author } : {}),
        };

        await markCompleted(jobId, completionDetails);

        success(`任务完成，文字稿已生成: ${markdownPath}`);
    } catch (err) {
        const failure = err as Error;
        logError(`任务失败: ${failure.message}`);
        const failureDetails = {
            title: downloadResult?.title ?? source.videoUrl,
            videoUrl: source.videoUrl,
            error: failure,
            ...(downloadResult?.author ? { author: downloadResult.author } : {}),
        };

        await markFailed(jobId, failureDetails);
        throw failure;
    } finally {
        if (downloadResult?.audioPath) {
            await safeUnlink(downloadResult.audioPath);
        }
    }
}

const program = new Command();

program
    .name("vedio-workflow")
    .description("视频文字稿生成与管理工具")
    .version("1.0.0");

// 生成文字稿命令（默认命令）
program
    .command("generate", { isDefault: true })
    .description("下载视频、调用 Gemini 生成中文文字稿，并发布到 GitHub Pages")
    .argument("<videos>", "视频链接（支持多个，用空格、换行、逗号或分号分隔）")
    .option("-k, --api-key <key>", "Gemini API Key (默认读取 GEMINI_API_KEY 环境变量)")
    .option("-o, --output <dir>", "文字稿输出目录", "docs/data/word")
    .action(async (videosInput, options) => {
        try {
            const pipelineOptions: PipelineOptions = {};
            if (options.apiKey) {
                pipelineOptions.apiKey = options.apiKey as string;
            }
            if (options.output) {
                pipelineOptions.output = options.output as string;
            }

            // 解析多个视频链接
            const videoUrls = parseMultipleVideos(videosInput as string);
            
            if (videoUrls.length === 0) {
                logError("未提供有效的视频链接");
                process.exitCode = 1;
                return;
            }

            success(`共解析到 ${videoUrls.length} 个视频链接`);

            // 依次处理每个视频
            for (let i = 0; i < videoUrls.length; i++) {
                const videoUrl = videoUrls[i]!;
                success(`\n[${i + 1}/${videoUrls.length}] 开始处理: ${videoUrl}`);
                
                try {
                    await runPipeline(videoUrl, pipelineOptions);
                } catch (err) {
                    logError(`[${i + 1}/${videoUrls.length}] 处理失败: ${(err as Error).message}`);
                    // 继续处理下一个视频
                }
            }

            success(`\n批量处理完成: ${videoUrls.length} 个视频`);
        } catch (err) {
            process.exitCode = 1;
        }
    });

// 删除文字稿命令
program
    .command("delete")
    .description("删除指定的文字稿及其索引记录")
    .argument("<video>", "YouTube 链接、哔哩哔哩链接或 BV 号")
    .option("-o, --output <dir>", "文字稿输出目录", "docs/data/word")
    .action(async (videoInput, options) => {
        try {
            const source = parseVideoSource(videoInput as string);
            const jobId = buildJobId(source);

            const deleteOptions = options.output ? { outputDir: options.output as string } : undefined;
            const result = await deleteTranscript(jobId, deleteOptions);

            if (result.deleted) {
                success(`文字稿删除成功: ${jobId}`);
                if (result.markdownDeleted) {
                    success(`  - Markdown 文件已删除`);
                }
                if (result.indexUpdated) {
                    success(`  - 索引记录已移除`);
                }
            } else {
                logError(`未找到文字稿: ${jobId}`);
                process.exitCode = 1;
            }
        } catch (err) {
            logError(`删除失败: ${(err as Error).message}`);
            process.exitCode = 1;
        }
    });

program.parseAsync(process.argv).catch((err) => {
    logError(`命令执行异常: ${(err as Error).message}`);
    process.exit(1);
});

async function safeUnlink(filePath: string): Promise<void> {
    try {
        await fs.unlink(filePath);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
            logError(`无法删除临时文件: ${filePath}`);
        }
    }
}
