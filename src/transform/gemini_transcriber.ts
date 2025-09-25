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
    const model = client.getGenerativeModel({ model: "models/gemini-1.5-flash" });

    const prompt = [
        "你将获得一段视频音频文件。",
        "1. 首先识别音频内容，若原音频不是中文，请将内容翻译为中文。",
        "2. 按照语义在合适的位置分段，每个段落不超过400字；每个段落提供 JSON 对象包含 index、text 字段，可选 start/end (mm:ss)。",
        "3. 返回格式为 JSON：{ \"language\": 原音语言, \"segments\": [{ \"index\": 1, \"text\": \"...\", \"start\": \"00:00\", \"end\": \"00:30\" }] }",
        "4. 这份音频中如果包含带货广告信息，请识别并用删除线进行标记。",
        "5. 所有文本使用简体中文。",
    ].join("\n");

    info("调用 Gemini 生成文字稿…");
    const result = await model.generateContent({
        contents: [
            {
                role: "user",
                parts: [
                    {
                        inlineData: {
                            mimeType,
                            data: base64Data,
                        },
                    },
                    {
                        text: prompt,
                    },
                ],
            },
        ],
    });

    const responseText = result.response.text();
    const jsonText = sanitiseJsonPayload(responseText);

    let parsed: TranscriptResult;
    try {
        parsed = JSON.parse(jsonText) as TranscriptResult;
    } catch (error) {
        try {
            const repaired = jsonrepair(jsonText);
            parsed = JSON.parse(repaired) as TranscriptResult;
        } catch (repairError) {
            const reason = (repairError as Error).message || (error as Error).message;
            throw new Error(
                `解析 Gemini 返回结果失败: ${reason}\n原始响应: ${responseText}`,
            );
        }
    }

    const segments = (parsed.segments ?? []).map((segment, index) => {
        const entry: TranscriptSegment = {
            index: segment.index ?? index + 1,
            text: segment.text ?? "",
        };
        if (segment.start) {
            entry.start = segment.start;
        }
        if (segment.end) {
            entry.end = segment.end;
        }
        return entry;
    });

    if (!segments.length) {
        throw new Error(`Gemini 未返回有效的分段数据: ${responseText}`);
    }

    return {
        language: parsed.language ?? "unknown",
        segments,
        rawResponse: responseText,
    };
}
