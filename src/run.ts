#!/usr/bin/env node
import { Command } from "commander";
import path from "path";
import fs from "fs";
import ffmpeg from "fluent-ffmpeg";
import chalk from "chalk";
import os from "os";

import { generateDescription } from "./describe";
import { generateTranscription } from "./transcribe";
import { generateReport } from "./report";
import { isAudioFile, isVideoFile } from "./utils/check-type";
import { checkFFmpeg } from "./utils/ffmpeg-check";
import {
  sanitizeDirectoryName,
  sanitizeFileName,
  sanitizePath,
} from "./utils/sanitize";

const MODEL_TIERS = {
  first: {
    description: "gemini-2.0-pro-exp-02-05",
    transcription: "gemini-2.0-pro-exp-02-05",
    report: "gemini-2.0-pro-exp-02-05",
    label: "First Tier (Pro models)",
  },
  business: {
    description: "gemini-2.0-pro-exp-02-05",
    transcription: "gemini-2.0-flash",
    report: "gemini-2.0-pro-exp-02-05",
    label: "Business Tier (Pro for description, Flash for transcription)",
  },
  economy: {
    description: "gemini-2.0-flash",
    transcription: "gemini-2.0-flash",
    report: "gemini-2.0-flash",
    label: "Economy Tier (Flash models)",
  },
  budget: {
    description: "gemini-2.0-flash",
    transcription: "gemini-2.0-flash-lite-preview-02-05",
    report: "gemini-2.0-flash-lite-preview-02-05",
    label: "Budget Tier (Flash for description, Flash Lite for transcription)",
  },
  experimental: {
    description: "gemini-2.5-pro-preview-03-25",
    transcription: "gemini-2.5-pro-preview-03-25",
    report: "gemini-2.5-pro-preview-03-25",
    label: "Experimental Tier (Gemini 2.5 Pro Preview)",
  },
  experimentalBudget: {
    description: "gemini-2.5-flash-preview-04-17",
    transcription: "gemini-2.5-flash-preview-04-17",
    report: "gemini-2.5-flash-preview-04-17",
    label: "Experimental Budget Tier (Gemini 2.5 Flash Preview)",
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
      // We don't sanitize paths here since we want to keep the original path for file access
      // But we'll sanitize any output/intermediate directories based on these files
      files.push(fullPath);
    }
  }

  return files;
}

async function processFile(
  inputFile: string,
  tier: keyof typeof MODEL_TIERS,
  saveIntermediates: boolean,
  intermediatesDir: string | null,
  screenshotCount: number,
  audioChunkMinutes: number,
  generateReports: boolean,
  reportsDir?: string,
  userInstructions?: string
): Promise<void> {
  const inputBaseName = path.basename(inputFile, path.extname(inputFile));
  const sanitizedBaseName = sanitizeDirectoryName(inputBaseName);

  // Determine where to store intermediates
  let outputDir: string | undefined = undefined;
  if (saveIntermediates) {
    // If user specified a directory, use that
    if (intermediatesDir) {
      outputDir = path.join(intermediatesDir, sanitizedBaseName);
    } else {
      // Otherwise use the input file's directory
      outputDir = path.join(
        path.dirname(inputFile),
        `.offmute_${sanitizedBaseName}`
      );
    }
  } else {
    // If not saving intermediates, use system temp directory with a unique name
    outputDir = path.join(
      os.tmpdir(),
      `offmute_${Date.now()}_${sanitizedBaseName}`
    );
  }

  // Create the directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const startTime = Date.now();
  console.log(`\nProcessing: ${inputFile}`);
  console.log(`Using: ${MODEL_TIERS[tier].label}`);
  if (userInstructions) {
    console.log(`Custom instructions: ${userInstructions}`);
  }
  if (saveIntermediates) {
    console.log(`Saving intermediates to: ${outputDir}`);
  }

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
      userInstructions,
    });

    const transcriptionResult = await generateTranscription(
      inputFile,
      descriptionResult,
      {
        transcriptionModel: MODEL_TIERS[tier].transcription,
        outputPath: path.dirname(inputFile),
        showProgress: true,
        userInstructions,
      }
    );

    // Generate report if requested
    if (generateReports) {
      console.log("Generating meeting report...");

      // Determine report output path
      const reportOutputPath = reportsDir || path.dirname(inputFile);
      const reportName = `${sanitizedBaseName}_report`;

      const reportResult = await generateReport(
        descriptionResult.finalDescription,
        transcriptionResult.chunkTranscriptions.join("\n\n"),
        {
          model: MODEL_TIERS[tier].report,
          outputPath: reportOutputPath,
          reportName: reportName,
          showProgress: true,
          userInstructions,
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

    // Clean up temp directory if we're not saving intermediates
    if (!saveIntermediates) {
      try {
        fs.rmSync(outputDir, { recursive: true, force: true });
      } catch (err) {
        // Silently ignore errors during cleanup
      }
    }
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
      "Processing tier (first, business, economy, budget, experimental)",
      "business"
    )
    .option(
      "-s, --save-intermediates",
      "Save intermediate processing files",
      false
    )
    .option(
      "-id, --intermediates-dir <path>",
      "Custom directory for intermediate output (defaults to input file location)"
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
    .option(
      "-i, --instructions <text>",
      "Custom context or instructions to include in AI prompts"
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

  // Create intermediates directory if specified
  if (options.intermediatesDir) {
    fs.mkdirSync(options.intermediatesDir, { recursive: true });
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
        options.saveIntermediates,
        options.intermediatesDir || null,
        parseInt(options.screenshotCount),
        parseInt(options.audioChunkMinutes),
        options.report,
        options.reportsDir,
        options.instructions
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
