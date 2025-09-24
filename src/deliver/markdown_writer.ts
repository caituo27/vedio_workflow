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
};

function formatSegment(segment: { index: number; start?: string; end?: string; text: string }): string {
    const timing = [segment.start, segment.end].filter(Boolean).join(" - ");
    const header = timing ? `### 第${segment.index}段 (${timing})` : `### 第${segment.index}段`;
    return [`${header}`, "", segment.text.trim()].join("\n");
}

function buildMarkdown(options: DeliverOptions, transcript: TranscriptResult): string {
    const createdAt = new Date().toISOString();
    const lines = [
        `# ${options.title || "未命名视频"}`,
        "",
        `- 视频链接: [点击查看](${options.videoUrl})`,
        `- 原始语言: ${transcript.language}`,
        `- 生成时间: ${createdAt}`,
        "",
        "## 文字稿",
        "",
        ...transcript.segments.map(formatSegment),
        "",
        "---",
        "",
        "> 本页面由自动化工作流生成，音频经过 Gemini 识别并翻译为中文。",
        "",
    ];

    return lines.join("\n");
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
