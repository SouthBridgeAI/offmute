import {
  GoogleGenerativeAI,
  GoogleGenerativeAIError,
  Part,
} from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import path from "path";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Create __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface FileInput {
  path: string;
  mimeType?: string;
}

interface GeminiResponse {
  text: string;
  files?: Array<{
    name: string;
    uri: string;
    mimeType: string;
  }>;
  error?: string;
}

interface GenerateOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  temperature?: number;
  schema?: any;
}

const MIME_TYPES = new Map([
  // Video formats
  [".flv", "video/x-flv"],
  [".mov", "video/quicktime"],
  [".mpeg", "video/mpeg"],
  [".mpegps", "video/mpegps"],
  [".mpg", "video/mpg"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
  [".wmv", "video/wmv"],
  [".3gpp", "video/3gpp"],
  // Image formats
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  // Audio formats
  [".aac", "audio/aac"],
  [".flac", "audio/flac"],
  [".mp3", "audio/mp3"],
  [".m4a", "audio/m4a"],
  [".mpa", "audio/mpeg"],
  [".mpga", "audio/mpga"],
  [".opus", "audio/opus"],
  [".pcm", "audio/pcm"],
  [".wav", "audio/wav"],
]);

/**
 * Detects MIME type from file extension
 */
function detectMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES.get(ext);
  if (!mimeType) {
    throw new Error(`Unsupported file type: ${ext}`);
  }
  return mimeType;
}

/**
 * Handles cleanup of uploaded files
 */
async function cleanupFiles(
  fileManager: GoogleAIFileManager,
  uploadedFiles: Array<{ name: string }>
): Promise<void> {
  await Promise.allSettled(
    uploadedFiles.map(async (file) => {
      try {
        await fileManager.deleteFile(file.name);
        // console.log(`Deleted file: ${file.name}`);
      } catch (error) {
        console.warn(`Failed to delete file ${file.name}:`, error);
      }
    })
  );
}

/**
 * Processes a single attempt at content generation
 */
async function processGenerationAttempt(
  model: GoogleGenerativeAI,
  fileManager: GoogleAIFileManager,
  modelName: string,
  prompt: string,
  files: FileInput[],
  temperature: number = 0,
  schema?: any
): Promise<GeminiResponse> {
  const uploadedFiles: Array<{ name: string }> = [];

  try {
    const modelConfig: any = {
      model: modelName,
      generationConfig: {
        maxOutputTokens: 8192,
        temperature,
      },
    };

    if (schema) {
      modelConfig.generationConfig.responseSchema = schema;
      modelConfig.generationConfig.responseMimeType = "application/json";
    }

    const genModel = model.getGenerativeModel(modelConfig);

    // Upload and process all files
    const processedFiles = await Promise.all(
      files.map(async (file) => {
        const mimeType = file.mimeType || detectMimeType(file.path);

        // Upload file
        const uploadResult = await fileManager.uploadFile(file.path, {
          displayName: path.basename(file.path),
          mimeType,
        });

        uploadedFiles.push({ name: uploadResult.file.name });

        // Wait for processing
        let currentFile = await fileManager.getFile(uploadResult.file.name);
        while (currentFile.state === FileState.PROCESSING) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          currentFile = await fileManager.getFile(uploadResult.file.name);
        }

        if (currentFile.state === FileState.FAILED) {
          throw new Error(`File processing failed: ${file.path}`);
        }

        return {
          fileData: {
            mimeType: uploadResult.file.mimeType,
            fileUri: uploadResult.file.uri,
          },
          originalFile: uploadResult.file,
        };
      })
    );

    const modelInput: Array<string | Part> = [
      ...processedFiles.map((file) => ({
        fileData: file.fileData,
      })),
      {
        text: prompt,
      },
    ];

    // Generate content
    const result = await genModel.generateContent(modelInput);

    return {
      text: result.response.text(),
      files: processedFiles.map((file) => ({
        name: file.originalFile.name,
        uri: file.originalFile.uri,
        mimeType: file.originalFile.mimeType,
      })),
    };
  } finally {
    // Always cleanup files before returning or throwing
    await cleanupFiles(fileManager, uploadedFiles);
  }
}

/**
 * Main function to process files and generate content using Google's Gemini model
 */
export async function generateWithGemini(
  modelName: string,
  prompt: string,
  files: FileInput[],
  options: GenerateOptions = {}
): Promise<GeminiResponse> {
  const { maxRetries = 1, retryDelayMs = 2000, temperature = 0 } = options;

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
  const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY || "");

  let lastError: Error | undefined;

  // Retry loop for the entire generation process
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await processGenerationAttempt(
        genAI,
        fileManager,
        modelName,
        prompt,
        files,
        temperature,
        options.schema
      );
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries - 1) {
        console.warn(
          `Generation attempt ${attempt + 1}/${maxRetries} failed: ${
            lastError.message
          }`
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  // If we get here, all retries failed
  if (lastError instanceof GoogleGenerativeAIError) {
    return {
      text: "",
      error: `Gemini API Error: ${lastError.message}`,
    };
  }

  return {
    text: "",
    error: `Unexpected error after ${maxRetries} attempts: ${
      lastError?.message || "Unknown error"
    }`,
  };
}

// Example usage:
// console.log("Testing gemini...");
// const response = await generateWithGemini(
//   "gemini-1.5-flash-8b",
//   "Describe what you see and hear in these files",
//   [
//     { path: __dirname + "/../tests/data/speech.mp3" }, // MIME type will be auto-detected
//     // { path: __dirname + "/../tests/data/testimg.png" }, // MIME type will be auto-detected
//   ],
//   process.env.GEMINI_API_KEY || "",
//   {
//     maxRetries: 3,
//     retryDelayMs: 2000,
//     temperature: 0.7,
//   }
// );

// console.log(response.text);
// if (response.error) {
//   console.error(response.error);
// }
