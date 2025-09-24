import { runPipeline } from "./index.js";

const video = process.env.DEV_VIDEO;

if (!video) {
    throw new Error("请通过 DEV_VIDEO 环境变量提供调试视频链接或 BV 号。");
}

const options: { apiKey?: string } = {};
if (process.env.GEMINI_API_KEY) {
    options.apiKey = process.env.GEMINI_API_KEY;
}

runPipeline(video, options).catch((error) => {
    console.error("调试运行失败", error);
    process.exit(1);
});
