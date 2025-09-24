import { slugify } from "./slug.js";

export type VideoSource = {
    originalInput: string;
    videoUrl: string;
    provider: "youtube" | "bilibili";
    id: string;
};

const YOUTUBE_URL_REGEX = /^(https?:\/\/)?(www\.|m\.)?(youtube\.com|youtu\.be)\//i;
const BILIBILI_ID_REGEX = /^(BV|bv)[0-9A-Za-z]+$/;
const BILIBILI_URL_REGEX = /^(https?:\/\/)?(www\.|m\.)?bilibili\.com\//i;
const URL_IN_TEXT_REGEX = /(https?:\/\/[^\s]+)/i;

function extractUrlCandidate(value: string): string | null {
    const match = value.match(URL_IN_TEXT_REGEX);
    return match ? match[0] : null;
}

function extractBilibiliIdFromText(value: string): string | null {
    const match = value.match(/BV[0-9A-Za-z]+/i);
    return match ? match[0] : null;
}

export function parseVideoSource(input: string): VideoSource {
    const trimmedInput = input.trim();
    const candidateUrl = extractUrlCandidate(trimmedInput);
    const target = candidateUrl ?? trimmedInput;

    if (YOUTUBE_URL_REGEX.test(target)) {
        const url = normaliseUrl(target, "youtube");
        return {
            originalInput: input,
            videoUrl: url,
            provider: "youtube",
            id: extractYoutubeId(url),
        };
    }

    if (BILIBILI_URL_REGEX.test(target)) {
        const url = normaliseUrl(target, "bilibili");
        return {
            originalInput: input,
            videoUrl: url,
            provider: "bilibili",
            id: extractBilibiliId(url),
        };
    }

    if (BILIBILI_ID_REGEX.test(target)) {
        const id = target;
        return {
            originalInput: input,
            videoUrl: `https://www.bilibili.com/video/${id}`,
            provider: "bilibili",
            id,
        };
    }

    const embeddedBiliId = extractBilibiliIdFromText(trimmedInput);
    if (embeddedBiliId) {
        return {
            originalInput: input,
            videoUrl: `https://www.bilibili.com/video/${embeddedBiliId}`,
            provider: "bilibili",
            id: embeddedBiliId,
        };
    }

    throw new Error(`无法识别的视频链接或编号: ${input}`);
}

function normaliseUrl(url: string, provider: "youtube" | "bilibili"): string {
    if (!/^https?:/i.test(url)) {
        return provider === "youtube" ? `https://${url}` : `https://${url}`;
    }
    return url;
}

function extractYoutubeId(url: string): string {
    try {
        const parsed = new URL(url);
        if (parsed.hostname === "youtu.be") {
            return parsed.pathname.slice(1);
        }
        const id = parsed.searchParams.get("v");
        if (!id) {
            throw new Error("无法解析 YouTube 视频 ID");
        }
        return id;
    } catch (error) {
        throw new Error(`解析 YouTube 链接失败: ${(error as Error).message}`);
    }
}

function extractBilibiliId(url: string): string {
    try {
        const parsed = new URL(url);
        const match = parsed.pathname.match(/BV[0-9A-Za-z]+/i);
        if (!match) {
            throw new Error("无法解析哔哩哔哩视频 ID");
        }
        return match[0];
    } catch (error) {
        throw new Error(`解析哔哩哔哩链接失败: ${(error as Error).message}`);
    }
}

export function buildJobId(source: VideoSource): string {
    return slugify(`${source.provider}-${source.id}`);
}
