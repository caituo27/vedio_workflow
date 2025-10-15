#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import { promises as fs } from "node:fs";
import { parseVideoSource, buildJobId } from "../utils/video.js";
import { success, error as logError } from "../utils/logger.js";
import { downloadAudio } from "../ingest/downloader.js";
import { transcribeWithGemini, DEFAULT_OPENROUTER_GEMINI_MODEL } from "../transform/gemini_transcriber.js";
import { deliverMarkdown } from "../deliver/markdown_writer.js";
import {
    markProcessing,
    markCompleted,
    markFailed,
    updateJob,
} from "../deliver/status_manager.js";
import type { JobRecord } from "../deliver/status_manager.js";

export type PipelineOptions = {
    apiKey?: string;
    output?: string;
    model?: string;
};

export async function runPipeline(videoInput: string, options: PipelineOptions): Promise<void> {
    const envApiKey =
        process.env.OPENROUTER_API_KEY ?? process.env.GEMINI_API_KEY ?? process.env.OPENROUTER_API_KEY_V1;
    const apiKey = options.apiKey ?? envApiKey;
    if (!apiKey) {
        throw new Error("缺少 OpenRouter API Key，请通过设置 OPENROUTER_API_KEY 或使用 --api-key 传入。");
    }

    const envModel =
        process.env.OPENROUTER_GEMINI_MODEL ?? process.env.GEMINI_MODEL_ID ?? process.env.OPENROUTER_MODEL_ID;
    const model = options.model ?? envModel ?? DEFAULT_OPENROUTER_GEMINI_MODEL;

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

        const transcriptOptions: { title: string; durationSeconds?: number; model?: string } = {
            title: downloadResult.title,
        };
        if (typeof downloadResult.durationSeconds === "number") {
            transcriptOptions.durationSeconds = downloadResult.durationSeconds;
        }
        transcriptOptions.model = model;

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
    .description("下载视频、调用 OpenRouter (Gemini) 生成中文文字稿，并发布到 GitHub Pages。")
    .argument("<video>", "YouTube 链接、哔哩哔哩链接或 BV 号")
    .option(
        "-k, --api-key <key>",
        "OpenRouter API Key (默认读取 OPENROUTER_API_KEY，兼容 GEMINI_API_KEY 环境变量)",
    )
    .option(
        "-m, --model <id>",
        `OpenRouter 模型 ID (默认 ${DEFAULT_OPENROUTER_GEMINI_MODEL}，支持 OPENROUTER_GEMINI_MODEL 环境变量)`,
    )
    .option("-o, --output <dir>", "文字稿输出目录", "docs/data/word")
    .action(async (videoInput, options) => {
        try {
            const pipelineOptions: PipelineOptions = {};
            if (options.apiKey) {
                pipelineOptions.apiKey = options.apiKey as string;
            }
            if (options.model) {
                pipelineOptions.model = options.model as string;
            }
            if (options.output) {
                pipelineOptions.output = options.output as string;
            }

            await runPipeline(videoInput as string, pipelineOptions);
        } catch (err) {
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
