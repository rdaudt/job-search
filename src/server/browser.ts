import { spawn } from "node:child_process";

export async function openSearchUrls(urls: string[]): Promise<void> {
  for (const url of urls) {
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
  }
}
