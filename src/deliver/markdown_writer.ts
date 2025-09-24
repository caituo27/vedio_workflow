import { promises as fs } from "node:fs";
import path from "node:path";
import type { TranscriptResult } from "../transform/gemini_transcriber.js";
import { ensureDir } from "../utils/fs.js";
import { info } from "../utils/logger.js";

export type DeliverOptions = {
    jobId: string;
    videoUrl: string;
    title: string;
    outputDir?: string;
    author?: string;
};

function formatSegment(segment: { text: string }): string {
    return segment.text.trim();
}

function formatTimestamp(date: Date): string {
    const pad = (value: number) => value.toString().padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function buildMarkdown(options: DeliverOptions, transcript: TranscriptResult): string {
    const createdAt = formatTimestamp(new Date());
    const lines = [
        `# ${options.title || "未命名视频"}`,
        "",
        `- 视频链接: [点击查看](${options.videoUrl})`,
        options.author ? `- 视频作者: ${options.author}` : undefined,
        `- 原始语言: ${transcript.language}`,
        `- 生成时间: ${createdAt}`,
        "",
        ...transcript.segments.map(formatSegment),
        "",
        "---",
        "",
        "> 本页面由自动化工作流生成，音频经过 Gemini 识别并翻译为中文。",
        "",
    ];

    return lines.filter((line) => line !== undefined).join("\n");
}

async function writeMarkdownFile(filePath: string, content: string): Promise<void> {
    await ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, content, "utf8");
}

export async function deliverMarkdown(
    transcript: TranscriptResult,
    options: DeliverOptions,
): Promise<{ markdownPath: string }> {
    const finalDir = options.outputDir ?? path.resolve("docs/data/word");
    const markdownPath = path.join(finalDir, `${options.jobId}.md`);
    const markdown = buildMarkdown(options, transcript);

    info(`写入 Markdown 文字稿: ${markdownPath}`);
    await writeMarkdownFile(markdownPath, markdown);

    return { markdownPath };
}
