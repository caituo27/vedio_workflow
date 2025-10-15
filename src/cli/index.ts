#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import { promises as fs } from "node:fs";
import { parseVideoSource, buildJobId } from "../utils/video.js";
import { success, error as logError, info } from "../utils/logger.js";
import { downloadAudio } from "../ingest/downloader.js";
import {
    transcribeWithGemini,
    transcribeWithGoogleGemini,
    DEFAULT_OPENROUTER_GEMINI_MODEL,
    DEFAULT_GOOGLE_GEMINI_MODEL,
} from "../transform/gemini_transcriber.js";
import type { TranscriptResult } from "../transform/gemini_transcriber.js";
import { MAX_AUDIO_BYTES_BEFORE_BASE64, formatBytes } from "../utils/openrouter_limits.js";
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
    const openrouterApiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY ?? undefined;
    const geminiApiKey = process.env.GEMINI_API_KEY ?? undefined;

    if (!openrouterApiKey && !geminiApiKey) {
        throw new Error("缺少 OPENROUTER_API_KEY 或 GEMINI_API_KEY，请至少提供其中一个。");
    }

    const model = options.model ?? process.env.GEMINI_MODEL_ID ?? undefined;

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

        const transcriptOptions: {
            title: string;
            durationSeconds?: number;
            model?: string;
        } = {
            title: downloadResult.title,
        };
        if (typeof downloadResult.durationSeconds === "number") {
            transcriptOptions.durationSeconds = downloadResult.durationSeconds;
        }
        if (model) {
            transcriptOptions.model = model;
        }

        const audioStats = await fs.stat(downloadResult.audioPath);
        const audioBytes = audioStats.size;
        const canUseOpenRouter = Boolean(openrouterApiKey) && audioBytes <= MAX_AUDIO_BYTES_BEFORE_BASE64;

        let transcript: TranscriptResult;
        if (canUseOpenRouter && openrouterApiKey) {
            transcript = await transcribeWithGemini(openrouterApiKey, downloadResult.audioPath, transcriptOptions);
        } else {
            if (openrouterApiKey && audioBytes > MAX_AUDIO_BYTES_BEFORE_BASE64) {
                info(
                    `音频文件大小为 ${formatBytes(audioBytes)}，超过 OpenRouter ${formatBytes(
                        MAX_AUDIO_BYTES_BEFORE_BASE64,
                    )} 限制，改用 Google Gemini。`,
                );
            } else if (!openrouterApiKey) {
                info("未检测到 OPENROUTER_API_KEY，使用 Google Gemini。");
            }

            if (!geminiApiKey) {
                throw new Error("缺少 GEMINI_API_KEY，无法调用 Google Gemini 转写。");
            }

            transcript = await transcribeWithGoogleGemini(geminiApiKey, downloadResult.audioPath, transcriptOptions);
        }

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
        "OpenRouter API Key (默认读取 OPENROUTER_API_KEY；若缺失或音频超限，将尝试使用 GEMINI_API_KEY)",
    )
    .option(
        "-m, --model <id>",
        `指定模型 ID（OpenRouter 默认 ${DEFAULT_OPENROUTER_GEMINI_MODEL}，Gemini 默认 ${DEFAULT_GOOGLE_GEMINI_MODEL}）`,
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
