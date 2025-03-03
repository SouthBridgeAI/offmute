import ffmpeg from "fluent-ffmpeg";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Create __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface ChunkInfo {
  path: string;
  startTime: number;
  endTime: number;
  index: number;
}

interface ProcessingResult {
  chunks: ChunkInfo[];
  tagSample: string;
  workingDirectory: string;
}

interface ProcessOptions {
  chunkMinutes?: number; // Default: 10
  overlapMinutes?: number; // Default: 1
  tagMinutes?: number; // Default: 20
  outputDir?: string; // Default: OS temp directory
}

export async function processAudioFile(
  inputFile: string,
  options: ProcessOptions = {}
): Promise<ProcessingResult> {
  // Set default options
  const {
    chunkMinutes = 10,
    overlapMinutes = 1,
    tagMinutes = 20,
    outputDir = path.join(os.tmpdir(), `audio_processing_${Date.now()}`),
  } = options;

  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Get duration of input file
  const duration = await getFileDuration(inputFile);
  const baseFileName = path.basename(inputFile, path.extname(inputFile));

  // Create promises for all operations
  const processingPromises: Promise<any>[] = [];
  const chunks: ChunkInfo[] = [];

  // Generate tag sample promise
  const tagSamplePath = path.join(outputDir, `${baseFileName}_tag_sample.mp3`);
  if (!fs.existsSync(tagSamplePath)) {
    processingPromises.push(
      createMp3Chunk(inputFile, tagSamplePath, 0, tagMinutes * 60)
    );
  }

  // Calculate chunk boundaries
  const chunkDuration = chunkMinutes * 60;
  const overlapDuration = overlapMinutes * 60;
  const totalChunks = Math.ceil(duration / (chunkDuration - overlapDuration));

  // Generate chunk processing promises
  for (let i = 0; i < totalChunks; i++) {
    const startTime = i * (chunkDuration - overlapDuration);
    const endTime = Math.min(startTime + chunkDuration, duration);
    const chunkPath = path.join(outputDir, `${baseFileName}_chunk_${i}.mp3`);

    // Only process if chunk doesn't exist
    if (!fs.existsSync(chunkPath)) {
      processingPromises.push(
        createMp3Chunk(inputFile, chunkPath, startTime, endTime)
      );
    }

    chunks.push({
      path: chunkPath,
      startTime,
      endTime,
      index: i,
    });
  }

  // Wait for all processing to complete
  await Promise.all(processingPromises);

  return {
    chunks,
    tagSample: tagSamplePath,
    workingDirectory: outputDir,
  };
}

function getFileDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) reject(err);
      resolve(metadata.format.duration || 0);
    });
  });
}

function createMp3Chunk(
  inputPath: string,
  outputPath: string,
  startTime: number,
  endTime: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .toFormat("mp3")
      .setStartTime(startTime)
      .setDuration(endTime - startTime)
      .outputOptions([
        "-acodec",
        "libmp3lame",
        "-ar",
        "44100",
        "-ab",
        "192k",
        "-vn", // Disable video
      ])
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .save(outputPath);
  });
}

// Example usage:
// console.log("Chunking ", __dirname + "/../../tests/data/speech.mp3", "\n\n");
// const result = await processAudioFile(
//   __dirname + "/../../tests/data/speech.mp3",
//   {
//     chunkMinutes: 1, // Optional: Change chunk size
//     overlapMinutes: 0.5, // Optional: Change overlap duration
//     tagMinutes: 2, // Optional: Change tag sample duration
//     outputDir: __dirname + "/../../tests/chunk_tests", // Optional: Specify output directory
//   }
// );

// console.log("Processed chunks:", result.chunks);
// console.log("Tag sample:", result.tagSample);
// console.log("Working directory:", result.workingDirectory);
