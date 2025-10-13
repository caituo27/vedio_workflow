import { promises as fs } from "node:fs";
import path from "node:path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { jsonrepair } from "jsonrepair";
import { info } from "../utils/logger.js";

export type TranscriptSegment = {
    index: number;
    text: string;
    start?: string;
    end?: string;
};

export type TranscriptResult = {
    language: string;
    segments: TranscriptSegment[];
    rawResponse: string;
};

type GeminiTranscriptPayload = Partial<TranscriptResult> & {
    paragraphs?: Array<string | Partial<TranscriptSegment>>;
    transcript?: string;
    text?: string;
    content?: string;
};

function chunkTextContent(text: string, maxLength = 400): string[] {
    const cleaned = text.trim();
    if (!cleaned) {
        return [];
    }

    const chunks: string[] = [];
    const paragraphs = cleaned
        .split(/\n+/)
        .map((paragraph) => paragraph.trim())
        .filter((paragraph) => paragraph.length > 0);

    for (const paragraph of paragraphs) {
        let remaining = paragraph;

        while (remaining.length > maxLength) {
            const slice = remaining.slice(0, maxLength).trim();
            if (slice) {
                chunks.push(slice);
            }
            remaining = remaining.slice(maxLength).trim();
        }

        if (remaining) {
            chunks.push(remaining);
        }
    }

    if (!chunks.length) {
        chunks.push(cleaned);
    }

    return chunks;
}

function coerceSegments(payload: GeminiTranscriptPayload): TranscriptSegment[] {
    const collected: Partial<TranscriptSegment>[] = [];

    if (Array.isArray(payload.segments) && payload.segments.length > 0) {
        collected.push(...payload.segments);
    }

    if (!collected.length && Array.isArray(payload.paragraphs)) {
        for (const paragraph of payload.paragraphs) {
            if (typeof paragraph === "string") {
                for (const chunk of chunkTextContent(paragraph)) {
                    collected.push({ text: chunk });
                }
                continue;
            }

            if (paragraph && typeof paragraph === "object") {
                const { text, start, end } = paragraph;
                if (typeof text === "string") {
                    const chunks = chunkTextContent(text);
                    chunks.forEach((chunk, index) => {
                        const entry: Partial<TranscriptSegment> = { text: chunk };
                        if (index === 0 && start) {
                            entry.start = start;
                        }
                        if (index === 0 && end) {
                            entry.end = end;
                        }
                        collected.push(entry);
                    });
                }
            }
        }
    }

    if (!collected.length) {
        const fallbackText = [payload.transcript, payload.text, payload.content]
            .find((value): value is string => typeof value === "string" && value.trim().length > 0);

        if (fallbackText) {
            for (const chunk of chunkTextContent(fallbackText)) {
                collected.push({ text: chunk });
            }
        }
    }

    return collected
        .filter((segment) => typeof segment.text === "string" && segment.text.trim().length > 0)
        .map((segment, index) => {
            const normalised: TranscriptSegment = {
                index: segment.index ?? index + 1,
                text: segment.text!.trim(),
            };

            if (segment.start) {
                normalised.start = segment.start;
            }
            if (segment.end) {
                normalised.end = segment.end;
            }

            return normalised;
        });
}

function detectMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case ".mp3":
            return "audio/mpeg";
        case ".m4a":
        case ".aac":
            return "audio/mp4";
        case ".wav":
            return "audio/wav";
        case ".flac":
            return "audio/flac";
        default:
            return "application/octet-stream";
    }
}

function sanitiseJsonPayload(payload: string): string {
    const trimmed = payload.trim();
    if (trimmed.startsWith("```")) {
        return trimmed.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    }
    return trimmed;
}

export async function transcribeWithGemini(
    apiKey: string,
    audioPath: string,
    options: {
        title: string;
        durationSeconds?: number;
    },
): Promise<TranscriptResult> {
    const fileBuffer = await fs.readFile(audioPath);
    const base64Data = fileBuffer.toString("base64");
    const mimeType = detectMimeType(audioPath);

    const client = new GoogleGenerativeAI(apiKey);
    const model = client.getGenerativeModel({ model: "models/gemini-2.0-flash-lite" });

    const prompt = [
        "你将获得一段视频音频文件。",
        "1. 首先识别音频内容，若原音频不是中文，请将内容翻译为中文。",
        "2. 按照语义在合适的位置分段，每个段落不超过400字；每个段落提供 JSON 对象包含 index、text 字段，可选 start/end (mm:ss)。",
        "3. 返回格式为 JSON：{ \"language\": 原音语言, \"segments\": [{ \"index\": 1, \"text\": \"...\", \"start\": \"00:00\", \"end\": \"00:30\" }] }",
        "4. 这份音频中如果包含带货广告信息，请识别并用删除线进行标记。",
        "5. 如果有语气词（比如“嗯”、“啊”）请删除。",
    ].join("\n");

    info("调用 Gemini 生成文字稿…");
    const result = await model.generateContent({
        contents: [
            {
                role: "user",
                parts: [
                    {
                        text: prompt,
                    },
                    {
                        inlineData: {
                            mimeType,
                            data: base64Data,
                        },
                    },
                ],
            },
        ],
        generationConfig: {
            responseMimeType: "application/json",
        },
    });

    const responseText = result.response.text();
    const jsonText = sanitiseJsonPayload(responseText);

    let parsed: GeminiTranscriptPayload;
    try {
        parsed = JSON.parse(jsonText) as GeminiTranscriptPayload;
    } catch (error) {
        try {
            const repaired = jsonrepair(jsonText);
            parsed = JSON.parse(repaired) as GeminiTranscriptPayload;
        } catch (repairError) {
            const reason = (repairError as Error).message || (error as Error).message;
            throw new Error(
                `解析 Gemini 返回结果失败: ${reason}\n原始响应: ${responseText}`,
            );
        }
    }

    const segments = coerceSegments(parsed);

    if (!segments.length) {
        throw new Error(`Gemini 未返回有效的分段数据: ${responseText}`);
    }

    return {
        language: parsed.language ?? "unknown",
        segments,
        rawResponse: responseText,
    };
}
