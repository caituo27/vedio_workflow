import chalk from "chalk";

const levels = {
  info: chalk.cyan,
  warn: chalk.yellow,
  error: chalk.red,
  success: chalk.green,
};

export type LogLevel = keyof typeof levels;

export function log(level: LogLevel, message: string): void {
  const prefix = level.toUpperCase().padEnd(7);
  const color = levels[level] ?? ((text: string) => text);
  console.log(color(`[${prefix}] ${message}`));
}

export function info(message: string): void {
  log("info", message);
}

export function warn(message: string): void {
  log("warn", message);
}

export function error(message: string): void {
  log("error", message);
}

export function success(message: string): void {
  log("success", message);
}
