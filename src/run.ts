#!/usr/bin/env node
import { Command } from "commander";
import path from "path";
import fs from "fs";
import ffmpeg from "fluent-ffmpeg";
import chalk from "chalk";

import { generateDescription } from "./describe";
import { generateTranscription } from "./transcribe";
import { generateReport } from "./report";
import { isAudioFile, isVideoFile } from "./utils/check-type";
import { checkFFmpeg } from "./utils/ffmpeg-check";

const MODEL_TIERS = {
  first: {
    description: "gemini-1.5-pro",
    transcription: "gemini-1.5-pro",
    report: "gemini-1.5-pro",
    label: "First Tier (Pro models)",
  },
  business: {
    description: "gemini-1.5-pro",
    transcription: "gemini-1.5-flash",
    report: "gemini-1.5-pro",
    label: "Business Tier (Pro for description, Flash for transcription)",
  },
  economy: {
    description: "gemini-1.5-flash",
    transcription: "gemini-1.5-flash",
    report: "gemini-1.5-flash",
    label: "Economy Tier (Flash models)",
  },
  budget: {
    description: "gemini-1.5-flash",
    transcription: "gemini-1.5-flash-8b",
    report: "gemini-1.5-flash-8b",
    label: "Budget Tier (Flash for description, 8B for transcription)",
  },
} as const;

function getVideoDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) reject(err);
      resolve(metadata.format.duration || 0);
    });
  });
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${remainingSeconds}s`);

  return parts.join(" ");
}

async function findFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...(await findFiles(fullPath)));
    } else if (isVideoFile(fullPath) || isAudioFile(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

async function processFile(
  inputFile: string,
  tier: keyof typeof MODEL_TIERS,
  saveIntermediates: boolean,
  screenshotCount: number,
  audioChunkMinutes: number,
  generateReports: boolean,
  reportsDir?: string
): Promise<void> {
  const inputBaseName = path.basename(inputFile, path.extname(inputFile));
  const outputDir = saveIntermediates
    ? path.join(path.dirname(inputFile), `${inputBaseName}_intermediates`)
    : undefined;

  const startTime = Date.now();
  console.log(`\nProcessing: ${inputFile}`);
  console.log(`Using: ${MODEL_TIERS[tier].label}`);

  try {
    const videoDuration = await getVideoDuration(inputFile);

    const descriptionResult = await generateDescription(inputFile, {
      screenshotModel: MODEL_TIERS[tier].description,
      screenshotCount,
      audioModel: MODEL_TIERS[tier].description,
      transcriptionChunkMinutes: audioChunkMinutes,
      mergeModel: MODEL_TIERS[tier].description,
      outputPath: outputDir,
      showProgress: true,
    });

    const transcriptionResult = await generateTranscription(
      inputFile,
      descriptionResult,
      {
        transcriptionModel: MODEL_TIERS[tier].transcription,
        outputPath: path.dirname(inputFile),
        showProgress: true,
      }
    );

    // Generate report if requested
    if (generateReports) {
      console.log("Generating meeting report...");

      // Determine report output path
      const reportOutputPath = reportsDir || path.dirname(inputFile);

      const reportResult = await generateReport(
        descriptionResult.finalDescription,
        transcriptionResult.chunkTranscriptions.join("\n\n"),
        {
          model: MODEL_TIERS[tier].report,
          outputPath: reportOutputPath,
          reportName: `${inputBaseName}_report`,
          showProgress: true,
        }
      );

      console.log(`Report saved to: ${reportResult.reportPath}`);
    }

    const totalSeconds = (Date.now() - startTime) / 1000;
    const timePerMinute = totalSeconds / (videoDuration / 60);

    console.log(
      `Complete in ${formatDuration(totalSeconds)} (${timePerMinute.toFixed(
        1
      )}s per minute)`
    );
    console.log(`Transcription: ${transcriptionResult.transcriptionPath}`);
  } catch (error) {
    console.error(
      chalk.red(`Error processing ${inputFile}:`),
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  }
}

async function run() {
  // First check for FFmpeg
  const ffmpegAvailable = await checkFFmpeg();
  if (!ffmpegAvailable) {
    process.exit(1);
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error(chalk.red.bold("\n❌ Missing API Key"));
    console.error(
      chalk.yellow(
        "\nPlease set your GEMINI_API_KEY in the environment to use offmute."
      )
    );
    process.exit(1);
  }

  const program = new Command();

  program
    .argument("<input>", "Input video file or directory path")
    .option(
      "-t, --tier <tier>",
      "Processing tier (first, business, economy, budget)",
      "business"
    )
    .option(
      "-a, --all",
      "Save all intermediate outputs in separate folders",
      false
    )
    .option(
      "-sc, --screenshot-count <number>",
      "Number of screenshots to extract",
      "4"
    )
    .option(
      "-ac, --audio-chunk-minutes <number>",
      "Length of audio chunks in minutes",
      "10"
    )
    .option("-r, --report", "Generate a structured meeting report", false)
    .option(
      "-rd, --reports-dir <path>",
      "Custom directory for report output (defaults to input file location)"
    )
    .version("1.0.0");

  program.parse();

  console.log(
    chalk.cyan(
      "⭐ Welcome to offmute - built by Hrishi (https://twitter.com/hrishioa) and named by Ben (https://twitter.com/bencmejla) ⭐"
    )
  );

  const options = program.opts();
  const input = program.args[0];

  if (!input || !MODEL_TIERS[options.tier as keyof typeof MODEL_TIERS]) {
    console.error(chalk.red("Error: Invalid input path or tier selection"));
    console.log(chalk.yellow("\nAvailable tiers:"));
    Object.entries(MODEL_TIERS).forEach(([key, value]) => {
      console.log(chalk.cyan(`- ${key}: ${value.label}`));
    });
    process.exit(1);
  }

  // Create reports directory if specified
  if (options.reportsDir) {
    fs.mkdirSync(options.reportsDir, { recursive: true });
  }

  const stats = fs.statSync(input);
  const files = stats.isDirectory() ? await findFiles(input) : [input];

  if (files.length === 0) {
    console.error(chalk.red("No video files found"));
    process.exit(1);
  }

  console.log(
    chalk.green(
      `Found ${files.length} video file${
        files.length > 1 ? "s" : ""
      } to process`
    )
  );

  const startTime = Date.now();
  const results = {
    success: 0,
    failed: 0,
    failedFiles: [] as string[],
  };

  for (const file of files) {
    try {
      await processFile(
        file,
        options.tier as keyof typeof MODEL_TIERS,
        options.all,
        parseInt(options.screenshotCount),
        parseInt(options.audioChunkMinutes),
        options.report,
        options.reportsDir
      );
      results.success++;
    } catch (error) {
      results.failed++;
      results.failedFiles.push(file);
    }
  }

  const totalTime = (Date.now() - startTime) / 1000;

  console.log(chalk.cyan("\nProcessing Summary:"));
  console.log(chalk.white(`Total time: ${formatDuration(totalTime)}`));
  console.log(
    chalk.green(`Successfully processed: ${results.success}/${files.length}`)
  );

  if (results.failed > 0) {
    console.log(chalk.red("\nFailed files:"));
    results.failedFiles.forEach((file) =>
      console.log(chalk.yellow(`- ${file}`))
    );
    process.exit(1);
  } else if (results.success > 0) {
    console.log(
      chalk.cyan(
        "\n🌟 If that worked, consider starring https://github.com/southbridgeai/offmute !"
      )
    );
    console.log(chalk.cyan("    https://github.com/southbridgeai/offmute"));
  }
}

process.on("unhandledRejection", (error) => {
  console.error(chalk.red("Fatal Error:"), error);
  process.exit(1);
});

run();
