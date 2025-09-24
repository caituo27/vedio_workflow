import { spawn } from "node:child_process";

export type CommandOptions = {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
};

export type CommandResult = {
    stdout: string;
    stderr: string;
};

export async function runCommand(
    command: string,
    args: string[],
    options: CommandOptions = {},
): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env,
            stdio: ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";

        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });

        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
        });

        child.on("error", (error) => {
            reject(error);
        });

        child.on("close", (code) => {
            if (code === 0) {
                resolve({ stdout, stderr });
            } else {
                const error = new Error(
                    `命令执行失败: ${command} ${args.join(" ")} (退出码 ${code})\n${stderr}`,
                );
                reject(error);
            }
        });
    });
}
