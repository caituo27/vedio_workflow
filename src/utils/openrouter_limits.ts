export const OPENROUTER_CHAT_INPUT_LIMIT_BYTES = 8 * 1024 * 1024; // 8 MB per request
export const BASE64_EXPANSION_RATIO = 4 / 3;
export const MAX_AUDIO_BYTES_BEFORE_BASE64 = Math.floor(
    OPENROUTER_CHAT_INPUT_LIMIT_BYTES / BASE64_EXPANSION_RATIO,
);

export function formatBytes(size: number): string {
    const units = ["B", "KB", "MB", "GB"];
    let index = 0;
    let value = size;

    while (value >= 1024 && index < units.length - 1) {
        value /= 1024;
        index += 1;
    }

    const precision = value >= 10 || index === 0 ? 0 : 1;
    return `${value.toFixed(precision)} ${units[index]}`;
}
