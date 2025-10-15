import { promises as fs } from "node:fs";
import path from "node:path";
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

function stripCodeFences(payload: string): string {
    return payload
        .trim()
        .replace(/^```(?:json)?/i, "")
        .replace(/```$/i, "")
        .trim();
}

function findJsonLikeSegments(payload: string): string[] {
    const segments: string[] = [];
    const stack: string[] = [];
    let inString = false;
    let escaped = false;
    let startIndex = -1;

    for (let index = 0; index < payload.length; index += 1) {
        const char = payload[index];

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === "\\") {
                escaped = true;
            } else if (char === "\"") {
                inString = false;
            }
            continue;
        }

        if (char === "\"") {
            inString = true;
            continue;
        }

        if (char === "{" || char === "[") {
            if (stack.length === 0) {
                startIndex = index;
            }
            stack.push(char);
            continue;
        }

        if (char === "}" || char === "]") {
            if (!stack.length) {
                startIndex = -1;
                continue;
            }

            const expected = stack[stack.length - 1];
            if ((char === "}" && expected !== "{") || (char === "]" && expected !== "[")) {
                stack.length = 0;
                startIndex = -1;
                continue;
            }

            stack.pop();
            if (!stack.length && startIndex !== -1) {
                segments.push(payload.slice(startIndex, index + 1));
                startIndex = -1;
            }
        }
    }

    return segments;
}

function escapeLooseStringCharacters(payload: string): string {
    let inString = false;
    let escaped = false;
    let result = "";

    for (let index = 0; index < payload.length; index += 1) {
        const char = payload[index];

        if (inString) {
            if (escaped) {
                result += char;
                escaped = false;
                continue;
            }

            if (char === "\\") {
                result += char;
                escaped = true;
                continue;
            }

            if (char === "\"") {
                inString = false;
                result += char;
                continue;
            }

            if (char === "\r") {
                if (payload[index + 1] === "\n") {
                    result += "\\n";
                    index += 1;
                } else {
                    result += "\\r";
                }
                continue;
            }

            if (char === "\n") {
                result += "\\n";
                continue;
            }

            if (char === "\u2028" || char === "\u2029") {
                result += "\\n";
                continue;
            }

            result += char;
            continue;
        }

        result += char;

        if (char === "\"") {
            let backslashCount = 0;
            for (let lookbehind = index - 1; lookbehind >= 0 && payload[lookbehind] === "\\"; lookbehind -= 1) {
                backslashCount += 1;
            }

            if (backslashCount % 2 === 0) {
                inString = true;
            }
        }
    }

    return result;
}

function sanitiseJsonPayload(payload: string): string[] {
    const trimmed = payload.trim();
    const withoutFence = stripCodeFences(trimmed);
    const candidates = new Set<string>();

    const addCandidate = (candidate: string) => {
        const value = candidate.trim();
        if (value) {
            candidates.add(value);
        }
    };

    addCandidate(trimmed);
    addCandidate(withoutFence);

    const fencedBlocks = [...withoutFence.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
    for (const match of fencedBlocks) {
        const block = match[1];
        if (typeof block === "string") {
            addCandidate(block);
        }
    }

    for (const source of [trimmed, withoutFence]) {
        for (const segment of findJsonLikeSegments(source)) {
            addCandidate(segment);
        }
    }

    return [...candidates];
}

function* buildCandidateVariants(candidate: string): Generator<string> {
    const seen = new Set<string>();
    const normalised = candidate.trim();

    if (!seen.has(normalised)) {
        seen.add(normalised);
        yield normalised;
    }

    const escaped = escapeLooseStringCharacters(normalised);
    if (escaped !== normalised && !seen.has(escaped)) {
        seen.add(escaped);
        yield escaped;
    }
}

function mapMimeTypeToAudioFormat(mimeType: string): string | undefined {
    switch (mimeType) {
        case "audio/mpeg":
            return "mp3";
        case "audio/mp4":
            return "mp4";
        case "audio/wav":
            return "wav";
        case "audio/flac":
            return "flac";
        default:
            return undefined;
    }
}

type OpenRouterContentBlock =
    | { type: "text"; text: string }
    | { type: "input_audio"; audio: { data: string; format?: string } };

type OpenRouterResponse = {
    choices?: Array<{
        message?: {
            content?: Array<{ type?: string; text?: string }> | string;
        };
    }>;
};

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

    const audioFormat = mapMimeTypeToAudioFormat(mimeType);

    const prompt = [
        "你将获得一段视频音频文件。",
        "1. 首先识别音频内容，若原音频不是中文，请将内容翻译为中文。",
        "2. 按照语义在合适的位置分段，每个段落不超过400字；每个段落提供 JSON 对象包含 index、text 字段，可选 start/end (mm:ss)。",
        "3. 返回格式为 JSON：{ \"language\": 原音语言, \"segments\": [{ \"index\": 1, \"text\": \"...\", \"start\": \"00:00\", \"end\": \"00:30\" }] }",
        "4. 这份音频中如果包含带货广告信息，请识别并用删除线进行标记。",
        "5. 如果有语气词（比如“嗯”、“啊”）请删除。",
    ].join("\n");

    const content: OpenRouterContentBlock[] = [
        { type: "text", text: prompt },
        {
            type: "input_audio",
            audio: {
                data: base64Data,
                ...(audioFormat ? { format: audioFormat } : {}),
            },
        },
    ];

    info("调用 OpenRouter (Gemini) 生成文字稿…");
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: "google/gemini-2.0-flash-lite-preview-02-05",
            messages: [
                {
                    role: "user",
                    content,
                },
            ],
            response_format: { type: "json_object" },
        }),
    });

    if (!response.ok) {
        const errorPayload = await response.text();
        throw new Error(`OpenRouter 请求失败: ${response.status} ${response.statusText}\n${errorPayload}`);
    }

    const payload = (await response.json()) as OpenRouterResponse;
    const firstChoice = payload.choices?.[0];
    const messageContent = firstChoice?.message?.content;

    let responseText = "";
    if (Array.isArray(messageContent)) {
        responseText = messageContent
            .map((block) => block.text ?? "")
            .join("\n")
            .trim();
    } else if (typeof messageContent === "string") {
        responseText = messageContent.trim();
    }

    if (!responseText) {
        throw new Error("OpenRouter 返回结果为空，无法解析文字稿");
    }

    const candidates = sanitiseJsonPayload(responseText);

    let parsed: GeminiTranscriptPayload | undefined;
    let lastErrorMessage = "";

    const attemptParse = (candidate: string): boolean => {
        for (const variant of buildCandidateVariants(candidate)) {
            try {
                parsed = JSON.parse(variant) as GeminiTranscriptPayload;
                return true;
            } catch (primaryError) {
                lastErrorMessage = (primaryError as Error).message;
            }

            try {
                const repaired = jsonrepair(variant);
                parsed = JSON.parse(repaired) as GeminiTranscriptPayload;
                return true;
            } catch (repairError) {
                lastErrorMessage = (repairError as Error).message;
            }
        }

        return false;
    };

    for (const candidate of candidates) {
        if (candidate.startsWith("{") || candidate.startsWith("[")) {
            if (attemptParse(candidate)) {
                break;
            }
        }
    }

    if (!parsed) {
        try {
            const repaired = jsonrepair(responseText);
            parsed = JSON.parse(repaired) as GeminiTranscriptPayload;
        } catch (finalError) {
            lastErrorMessage = (finalError as Error).message;
        }
    }

    if (!parsed) {
        throw new Error(
            `解析 OpenRouter (Gemini) 返回结果失败: ${lastErrorMessage || "无法解析响应"}\n原始响应: ${responseText}`,
        );
    }

    const segments = coerceSegments(parsed);

    if (!segments.length) {
        throw new Error(`OpenRouter (Gemini) 未返回有效的分段数据: ${responseText}`);
    }

    return {
        language: parsed.language ?? "unknown",
        segments,
        rawResponse: responseText,
    };
}
