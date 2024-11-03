// src/utils/ffmpeg-check.ts
import ffmpeg from "fluent-ffmpeg";
import chalk from "chalk";

export async function checkFFmpeg(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    ffmpeg.getAvailableCodecs((err) => {
      if (err) {
        const message = [
          chalk.red.bold("\n❌ FFmpeg is not installed or not properly configured!"),
          chalk.yellow("\nTo use offmute, you need to install FFmpeg:"),
          "\nInstallation instructions:",
          chalk.cyan("\nOn macOS (using Homebrew):"),
          "  brew install ffmpeg",
          chalk.cyan("\nOn Ubuntu/Debian:"),
          "  sudo apt update && sudo apt install ffmpeg",
          chalk.cyan("\nOn Windows:"),
          "  1. Download from: https://www.ffmpeg.org/download.html",
          "  2. Add ffmpeg to your system PATH",
          chalk.cyan("\nUsing Scoop on Windows:"),
          "  scoop install ffmpeg",
          chalk.cyan("\nUsing Chocolatey on Windows:"),
          "  choco install ffmpeg",
          "\nError details:",
          chalk.red(err.message || String(err)),
          "\n",
        ].join("\n");

        console.error(message);
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
}