import { runPipeline } from "./index.js";

const video = process.env.DEV_VIDEO;

if (!video) {
    throw new Error("请通过 DEV_VIDEO 环境变量提供调试视频链接或 BV 号。");
}

const options: { apiKey?: string; model?: string } = {};
const envApiKey =
    process.env.OPENROUTER_API_KEY ?? process.env.GEMINI_API_KEY ?? process.env.OPENROUTER_API_KEY_V1;
if (envApiKey) {
    options.apiKey = envApiKey;
}

const envModel =
    process.env.OPENROUTER_GEMINI_MODEL ?? process.env.GEMINI_MODEL_ID ?? process.env.OPENROUTER_MODEL_ID;
if (envModel) {
    options.model = envModel;
}

runPipeline(video, options).catch((error) => {
    console.error("调试运行失败", error);
    process.exit(1);
});
