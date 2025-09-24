import path from "node:path";
import { promises as fs } from "node:fs";

export async function ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
}

export async function readJsonFile<T>(path: string): Promise<T | null> {
    try {
        const content = await fs.readFile(path, "utf8");
        return JSON.parse(content) as T;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return null;
        }
        throw error;
    }
}

export async function writeJsonFile<T>(filePath: string, data: T): Promise<void> {
    await ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}
