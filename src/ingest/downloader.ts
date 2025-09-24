import { promises as fs } from "node:fs";
import path from "node:path";
import tmp from "tmp";
import { runCommand } from "../utils/process.js";
import type { VideoSource } from "../utils/video.js";
import { info } from "../utils/logger.js";

export type DownloadResult = {
    audioPath: string;
    title: string;
    durationSeconds?: number;
};

tmp.setGracefulCleanup();

function getAudioFormat(provider: VideoSource["provider"]): string {
    return provider === "youtube" ? "m4a" : "mp3";
}

async function ensureDirectory(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
}

export async function downloadAudio(source: VideoSource): Promise<DownloadResult> {
    const tmpDir = tmp.dirSync({ unsafeCleanup: true });
    const audioFormat = getAudioFormat(source.provider);
    const outputTemplate = path.join(tmpDir.name, `download.%(ext)s`);

    info(`开始下载音频: ${source.videoUrl}`);
    await runCommand("yt-dlp", [
        "-f",
        "bestaudio/best",
        "-x",
        "--audio-format",
        audioFormat,
        "--write-info-json",
        "--no-progress",
        "--output",
        outputTemplate,
        source.videoUrl,
    ]);

    const files = await fs.readdir(tmpDir.name);
    const audioFile = files.find((file) => file.endsWith(`.${audioFormat}`));
    if (!audioFile) {
        throw new Error("未找到下载的音频文件");
    }

    const infoFile = files.find((file) => file.endsWith(".info.json"));
    let title = source.videoUrl;
    let durationSeconds: number | undefined;

    if (infoFile) {
        const infoJson = JSON.parse(
            await fs.readFile(path.join(tmpDir.name, infoFile), "utf8"),
        );
        title = infoJson.title ?? title;
        durationSeconds = infoJson.duration;
    }

    const finalDir = path.resolve(".cache/audio");
    await ensureDirectory(finalDir);
    const finalPath = path.join(finalDir, `${Date.now()}-${path.basename(audioFile)}`);
    await fs.copyFile(path.join(tmpDir.name, audioFile), finalPath);

    info(`音频下载完成: ${finalPath}`);

    const result: DownloadResult = {
        audioPath: finalPath,
        title,
    };

    if (typeof durationSeconds === "number") {
        result.durationSeconds = durationSeconds;
    }

    return result;
}
