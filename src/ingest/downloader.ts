import { promises as fs } from "node:fs";
import path from "node:path";
import tmp from "tmp";
import { runCommand } from "../utils/process.js";
import type { VideoSource } from "../utils/video.js";
import { info, warn } from "../utils/logger.js";
import { MAX_AUDIO_BYTES_BEFORE_BASE64, OPENROUTER_CHAT_INPUT_LIMIT_BYTES, formatBytes } from "../utils/openrouter_limits.js";

export type DownloadResult = {
    audioPath: string;
    title: string;
    durationSeconds?: number;
    author?: string;
};

tmp.setGracefulCleanup();

function getAudioFormat(provider: VideoSource["provider"]): string {
    return provider === "youtube" ? "m4a" : "mp3";
}

const BOT_CHECK_REGEX = /sign in to confirm you['’]re not a bot/i;

const ANDROID_USER_AGENT =
    "Mozilla/5.0 (Linux; Android 10; Pixel 4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

function buildCommonArgs(audioFormat: string, outputTemplate: string): string[] {
    return [
        "-f",
        "bestaudio/best",
        "-x",
        "--audio-format",
        audioFormat,
        "--write-info-json",
        "--no-progress",
        "--output",
        outputTemplate,
    ];
}

async function ensureDirectory(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
}

export async function downloadAudio(source: VideoSource): Promise<DownloadResult> {
    const tmpDir = tmp.dirSync({ unsafeCleanup: true });
    const audioFormat = getAudioFormat(source.provider);
    const outputTemplate = path.join(tmpDir.name, `download.%(ext)s`);
    const commonArgs = buildCommonArgs(audioFormat, outputTemplate);
    const cookiesPath = process.env.YT_DLP_COOKIES_PATH?.trim();

    const buildArgs = (extras: string[] = []): string[] => {
        const args = [...commonArgs, ...extras];
        if (cookiesPath) {
            args.push("--cookies", cookiesPath);
        }
        args.push(source.videoUrl);
        return args;
    };

    info(`开始下载音频: ${source.videoUrl}`);
    const primaryArgs = buildArgs();
    try {
        await runCommand("yt-dlp", primaryArgs);
    } catch (error) {
        const message = (error as Error).message;
        if (!BOT_CHECK_REGEX.test(message)) {
            throw error;
        }

        info("检测到机器人校验，尝试以 Android 客户端参数重试…");
        const fallbackArgs = buildArgs([
            "--extractor-args",
            "youtube:player_client=android",
            "--user-agent",
            ANDROID_USER_AGENT,
        ]);
        await runCommand("yt-dlp", fallbackArgs);
        info("已通过 Android 客户端参数完成下载。");
    }

    const files = await fs.readdir(tmpDir.name);
    const audioFile = files.find((file) => file.endsWith(`.${audioFormat}`));
    if (!audioFile) {
        throw new Error("未找到下载的音频文件");
    }
    
    const infoFile = files.find((file) => file.endsWith(".info.json"));
    let title = source.videoUrl;
    let durationSeconds: number | undefined;
    let author: string | undefined;

    if (infoFile) {
        const infoJson = JSON.parse(
            await fs.readFile(path.join(tmpDir.name, infoFile), "utf8"),
        );
        title = infoJson.title ?? title;
        durationSeconds = infoJson.duration;
        author = infoJson.uploader ?? infoJson.channel ?? infoJson.artist ?? author;
    }

    const finalDir = path.resolve(".cache/audio");
    await ensureDirectory(finalDir);
    const finalPath = path.join(finalDir, `${Date.now()}-${path.basename(audioFile)}`);
    await fs.copyFile(path.join(tmpDir.name, audioFile), finalPath);

    const optimisedPath = await ensureAudioWithinInputLimit(finalPath);

    info(`音频下载完成: ${optimisedPath}`);

    const result: DownloadResult = {
        audioPath: optimisedPath,
        title,
    };

    if (typeof durationSeconds === "number") {
        result.durationSeconds = durationSeconds;
    }

    if (author) {
        result.author = author;
    }

    return result;
}

const TARGET_AUDIO_BITRATE = 16_000; // bits per second

async function ensureAudioWithinInputLimit(originalPath: string): Promise<string> {
    const stats = await fs.stat(originalPath);

    if (stats.size <= MAX_AUDIO_BYTES_BEFORE_BASE64) {
        return originalPath;
    }

    info(
        `音频文件大小为 ${formatBytes(stats.size)}，接近 OpenRouter ${formatBytes(
            OPENROUTER_CHAT_INPUT_LIMIT_BYTES,
        )} 请求限制，尝试重新编码以降低码率…`,
    );

    const directory = path.dirname(originalPath);
    const basename = path.basename(originalPath, path.extname(originalPath));
    const compressedPath = path.join(directory, `${basename}-compressed.mp3`);

    try {
        await runCommand("ffmpeg", [
            "-y",
            "-i",
            originalPath,
            "-ac",
            "1",
            "-ar",
            "16000",
            "-b:a",
            `${TARGET_AUDIO_BITRATE / 1000}k`,
            compressedPath,
        ]);

        const compressedStats = await fs.stat(compressedPath);

        if (compressedStats.size >= stats.size) {
            warn("重新编码后音频并未缩小体积，继续使用原始文件。");
            await fs.unlink(compressedPath).catch(() => undefined);
            return originalPath;
        }

        await fs.unlink(originalPath).catch(() => undefined);

        if (compressedStats.size > MAX_AUDIO_BYTES_BEFORE_BASE64) {
            warn(
                `重新编码后文件大小仍为 ${formatBytes(
                    compressedStats.size,
                )}，可能仍触发 OpenRouter 的 ${formatBytes(
                    OPENROUTER_CHAT_INPUT_LIMIT_BYTES,
                )} 限制。`,
            );
        } else {
            info(`重新编码成功，音频大小降至 ${formatBytes(compressedStats.size)}。`);
        }

        return compressedPath;
    } catch (error) {
        warn(`重新编码音频失败，将继续使用原始文件。原因: ${(error as Error).message}`);
        await fs.unlink(compressedPath).catch(() => undefined);
        return originalPath;
    }
}
