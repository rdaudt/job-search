import { spawn } from "node:child_process";

type SearchLaunchPacing = {
  searchLaunchDelayMs: number;
  searchLaunchJitterMs: number;
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

function randomDelayMs(baseDelayMs: number, jitterMs: number): number {
  if (jitterMs <= 0) {
    return baseDelayMs;
  }

  return baseDelayMs + Math.floor(Math.random() * (jitterMs + 1));
}

export async function openSearchUrls(urls: string[], pacing: SearchLaunchPacing): Promise<void> {
  for (const [index, url] of urls.entries()) {
    const command =
      process.platform === "win32"
        ? { executable: "rundll32", args: ["url.dll,FileProtocolHandler", url] }
        : process.platform === "darwin"
          ? { executable: "open", args: [url] }
          : { executable: "xdg-open", args: [url] };

    const child = spawn(command.executable, command.args, {
      detached: true,
      stdio: "ignore"
    });

    child.unref();

    if (index < urls.length - 1) {
      await wait(randomDelayMs(pacing.searchLaunchDelayMs, pacing.searchLaunchJitterMs));
    }
  }
}
