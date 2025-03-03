import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { generateDescription, generateTranscription, generateReport } from './index';
import { GenerateReportResult } from './report';

// Create __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 500 }, // 500MB max file size
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['video/mp4', 'video/webm', 'audio/mpeg', 'audio/wav', 'audio/webm'];
    const allowedExtensions = ['.mp4', '.webm', '.mp3', '.wav'];
    
    // Check if it's a recognized mimetype
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    
    // Check if it has an allowed extension
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
      return;
    }
    
    // If we got here, the file type is not allowed
    cb(new Error('Invalid file type. Only video and audio files are allowed.') as any);
  }
});

// Middleware
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Routes
app.get('/', (req, res) => {
  res.json({ message: 'Offmute API is running' });
});

// Process video/audio file with streaming response
app.post('/api/process', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const tier = req.body.tier || 'business';
    const screenshotCount = parseInt(req.body.screenshotCount) || 4;
    const audioChunkMinutes = parseInt(req.body.audioChunkMinutes) || 10;
    const generateReportFlag = req.body.generateReport === 'true';
    const streamResponse = req.body.streamResponse === 'true';

    // Select models based on tier - using the correct model names from current Gemini API
    let screenshotModel = 'gemini-2.0-flash';
    let audioModel = 'gemini-2.0-flash';
    let mergeModel = 'gemini-2.0-flash';
    let transcriptionModel = 'gemini-2.0-flash';
    let reportModel = 'gemini-2.0-flash';

    switch (tier) {
      case 'first':
        screenshotModel = 'gemini-2.0-pro';
        audioModel = 'gemini-2.0-pro';
        mergeModel = 'gemini-2.0-pro';
        transcriptionModel = 'gemini-2.0-pro';
        reportModel = 'gemini-2.0-pro';
        break;
      case 'business':
        screenshotModel = 'gemini-2.0-pro';
        audioModel = 'gemini-2.0-pro';
        mergeModel = 'gemini-2.0-pro';
        transcriptionModel = 'gemini-2.0-flash';
        reportModel = 'gemini-2.0-pro';
        break;
      case 'economy':
        // Already set to flash models
        break;
      case 'budget':
        transcriptionModel = 'gemini-2.0-flash-lite';
        reportModel = 'gemini-2.0-flash-lite';
        break;
    }

    // Generate output directory
    const outputDir = path.join(__dirname, '../uploads', path.basename(filePath, path.extname(filePath)));
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Start processing
    const jobId = Date.now().toString();
    
    if (streamResponse) {
      // Setup for streaming response
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      // Send initial status
      res.write(`data: ${JSON.stringify({
        message: 'Processing started',
        jobId,
        status: 'processing',
        inputFile: req.file.originalname,
      })}\n\n`);
      
      try {
        // Step 1: Generate description
        const description = await generateDescription(filePath, {
          screenshotModel,
          audioModel,
          mergeModel,
          screenshotCount,
          transcriptionChunkMinutes: audioChunkMinutes,
          descriptionChunkMinutes: audioChunkMinutes * 2,
          outputPath: outputDir,
          showProgress: true,
        });

        // Save intermediate description result
        const intermediateResult = {
          jobId,
          status: 'description_complete',
          inputFile: req.file ? req.file.originalname : path.basename(filePath),
          description: description.finalDescription,
          outputs: {
            descriptionFile: path.relative(path.join(__dirname, '..'), path.join(outputDir, `${path.basename(filePath, path.extname(filePath))}_description.md`)),
          },
          downloadLinks: {
            description: `/api/results/${jobId}/description`,
          },
          transcription: {
            status: 'in_progress'
          }
        };

        fs.writeFileSync(
          path.join(outputDir, 'result.json'),
          JSON.stringify(intermediateResult, null, 2)
        );

        // Send description update
        res.write(`data: ${JSON.stringify(intermediateResult)}\n\n`);

        // Step 2: Generate transcription
        const transcription = await generateTranscription(filePath, description, {
          transcriptionModel,
          outputPath: outputDir,
          showProgress: true,
        });

        // Update with transcription result
        const transcriptionResult = {
          jobId,
          status: 'transcription_complete',
          inputFile: req.file ? req.file.originalname : path.basename(filePath),
          description: description.finalDescription,
          transcription: transcription.chunkTranscriptions.join('\n\n'),
          outputs: {
            descriptionFile: path.relative(path.join(__dirname, '..'), path.join(outputDir, `${path.basename(filePath, path.extname(filePath))}_description.md`)),
            transcriptionFile: path.relative(path.join(__dirname, '..'), transcription.transcriptionPath),
          },
          downloadLinks: {
            description: `/api/results/${jobId}/description`,
            transcription: `/api/results/${jobId}/transcription`,
          },
          report: generateReportFlag ? { status: 'in_progress' } : { status: 'not_requested' }
        };

        fs.writeFileSync(
          path.join(outputDir, 'result.json'),
          JSON.stringify(transcriptionResult, null, 2)
        );

        // Send transcription update
        res.write(`data: ${JSON.stringify(transcriptionResult)}\n\n`);

        // Step 3: Generate report if requested
        let report: GenerateReportResult | undefined = undefined;
        if (generateReportFlag) {
          report = await generateReport(
            description.finalDescription,
            transcription.chunkTranscriptions.join('\n\n'),
            {
              model: reportModel,
              outputPath: outputDir,
              reportName: 'meeting_summary',
              showProgress: true,
            }
          );
        }

        // Create final result summary
        const resultSummary = {
          jobId,
          status: 'completed',
          inputFile: req.file ? req.file.originalname : path.basename(filePath),
          description: description.finalDescription,
          transcription: transcription.chunkTranscriptions.join('\n\n'),
          report: report ? fs.readFileSync(report.reportPath, 'utf-8') : null,
          outputs: {
            descriptionFile: path.relative(path.join(__dirname, '..'), path.join(outputDir, `${path.basename(filePath, path.extname(filePath))}_description.md`)),
            transcriptionFile: path.relative(path.join(__dirname, '..'), transcription.transcriptionPath),
            reportFile: report ? path.relative(path.join(__dirname, '..'), report.reportPath) : null,
          },
          downloadLinks: {
            description: `/api/results/${jobId}/description`,
            transcription: `/api/results/${jobId}/transcription`,
            report: report ? `/api/results/${jobId}/report` : null,
          }
        };

        // Save result summary
        fs.writeFileSync(
          path.join(outputDir, 'result.json'),
          JSON.stringify(resultSummary, null, 2)
        );

        // Send final update and end the stream
        res.write(`data: ${JSON.stringify(resultSummary)}\n\n`);
        res.end();

      } catch (error) {
        console.error('Processing error:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        // Save error info
        fs.writeFileSync(
          path.join(outputDir, 'error.json'),
          JSON.stringify({
            jobId,
            status: 'failed',
            error: errorMessage,
            timestamp: new Date().toISOString()
          }, null, 2)
        );

        // Send error to client and end stream
        res.write(`data: ${JSON.stringify({
          status: 'failed',
          error: errorMessage
        })}\n\n`);
        res.end();
      }
    } else {
      // Non-streaming response (traditional async job)
      res.status(202).json({
        message: 'Processing started',
        jobId,
        status: 'processing',
        inputFile: req.file.originalname,
      });

      // Process in background
      (async () => {
        try {
          // Step 1: Generate description
          const description = await generateDescription(filePath, {
            screenshotModel,
            audioModel,
            mergeModel,
            screenshotCount,
            transcriptionChunkMinutes: audioChunkMinutes,
            descriptionChunkMinutes: audioChunkMinutes * 2,
            outputPath: outputDir,
            showProgress: true,
          });

          // Save intermediate description result
          const intermediateResult = {
            jobId,
            status: 'description_complete',
            inputFile: req.file ? req.file.originalname : path.basename(filePath),
            outputs: {
              descriptionFile: path.relative(path.join(__dirname, '..'), path.join(outputDir, `${path.basename(filePath, path.extname(filePath))}_description.md`)),
            },
            downloadLinks: {
              description: `/api/results/${jobId}/description`,
            },
            transcription: {
              status: 'in_progress'
            }
          };

          fs.writeFileSync(
            path.join(outputDir, 'result.json'),
            JSON.stringify(intermediateResult, null, 2)
          );

          // Step 2: Generate transcription
          const transcription = await generateTranscription(filePath, description, {
            transcriptionModel,
            outputPath: outputDir,
            showProgress: true,
          });

          // Update with transcription result
          const transcriptionResult = {
            jobId,
            status: 'transcription_complete',
            inputFile: req.file ? req.file.originalname : path.basename(filePath),
            outputs: {
              descriptionFile: path.relative(path.join(__dirname, '..'), path.join(outputDir, `${path.basename(filePath, path.extname(filePath))}_description.md`)),
              transcriptionFile: path.relative(path.join(__dirname, '..'), transcription.transcriptionPath),
            },
            downloadLinks: {
              description: `/api/results/${jobId}/description`,
              transcription: `/api/results/${jobId}/transcription`,
            },
            report: generateReportFlag ? { status: 'in_progress' } : { status: 'not_requested' }
          };

          fs.writeFileSync(
            path.join(outputDir, 'result.json'),
            JSON.stringify(transcriptionResult, null, 2)
          );

          // Step 3: Generate report if requested
          let report: GenerateReportResult | undefined = undefined;
          if (generateReportFlag) {
            report = await generateReport(
              description.finalDescription,
              transcription.chunkTranscriptions.join('\n\n'),
              {
                model: reportModel,
                outputPath: outputDir,
                reportName: 'meeting_summary',
                showProgress: true,
              }
            );
          }

          // Create final result summary
          const resultSummary = {
            jobId,
            status: 'completed',
            inputFile: req.file ? req.file.originalname : path.basename(filePath),
            outputs: {
              descriptionFile: path.relative(path.join(__dirname, '..'), path.join(outputDir, `${path.basename(filePath, path.extname(filePath))}_description.md`)),
              transcriptionFile: path.relative(path.join(__dirname, '..'), transcription.transcriptionPath),
              reportFile: report ? path.relative(path.join(__dirname, '..'), report.reportPath) : null,
            },
            downloadLinks: {
              description: `/api/results/${jobId}/description`,
              transcription: `/api/results/${jobId}/transcription`,
              report: report ? `/api/results/${jobId}/report` : null,
            }
          };

          // Save result summary
          fs.writeFileSync(
            path.join(outputDir, 'result.json'),
            JSON.stringify(resultSummary, null, 2)
          );
        } catch (error) {
          console.error('Processing error:', error);
          // Save error info
          const errorMessage = error instanceof Error ? error.message : String(error);
          fs.writeFileSync(
            path.join(outputDir, 'error.json'),
            JSON.stringify({
              jobId,
              status: 'failed',
              error: errorMessage,
              timestamp: new Date().toISOString()
            }, null, 2)
          );
        }
      })();
    }
  } catch (error) {
    console.error('Error processing upload:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: errorMessage });
  }
});

// Check job status
app.get('/api/jobs/:jobId', (req, res) => {
  const { jobId } = req.params;
  
  // Look for job results or errors
  const uploadsDir = path.join(__dirname, '../uploads');
  const dirs = fs.readdirSync(uploadsDir);
  
  for (const dir of dirs) {
    const dirPath = path.join(uploadsDir, dir);
    const stat = fs.statSync(dirPath);
    
    if (stat.isDirectory()) {
      // Check for result.json
      const resultPath = path.join(dirPath, 'result.json');
      if (fs.existsSync(resultPath)) {
        const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
        if (result.jobId === jobId) {
          return res.json(result);
        }
      }
      
      // Check for error.json
      const errorPath = path.join(dirPath, 'error.json');
      if (fs.existsSync(errorPath)) {
        const error = JSON.parse(fs.readFileSync(errorPath, 'utf8'));
        if (error.jobId === jobId) {
          return res.status(500).json(error);
        }
      }
    }
  }
  
  // Job not found
  res.status(404).json({ error: 'Job not found' });
});

// Get specific result files
app.get('/api/results/:jobId/:type', (req, res) => {
  const { jobId, type } = req.params;
  
  // Look for job results
  const uploadsDir = path.join(__dirname, '../uploads');
  const dirs = fs.readdirSync(uploadsDir);
  
  for (const dir of dirs) {
    const dirPath = path.join(uploadsDir, dir);
    const stat = fs.statSync(dirPath);
    
    if (stat.isDirectory()) {
      // Check for result.json
      const resultPath = path.join(dirPath, 'result.json');
      if (fs.existsSync(resultPath)) {
        const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
        if (result.jobId === jobId) {
          let filePath;
          let fileName;
          
          switch (type) {
            case 'description':
              filePath = path.join(__dirname, '..', result.outputs.descriptionFile);
              fileName = 'description.md';
              break;
            case 'transcription':
              filePath = path.join(__dirname, '..', result.outputs.transcriptionFile);
              fileName = 'transcription.md';
              break;
            case 'report':
              if (!result.outputs.reportFile) {
                return res.status(404).json({ error: 'Report not generated for this job' });
              }
              filePath = path.join(__dirname, '..', result.outputs.reportFile);
              fileName = 'report.md';
              break;
            default:
              return res.status(400).json({ error: 'Invalid result type' });
          }
          
          if (fs.existsSync(filePath)) {
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
            res.setHeader('Content-Type', 'text/markdown');
            return res.sendFile(filePath);
          } else {
            return res.status(404).json({ error: 'Result file not found' });
          }
        }
      }
    }
  }
  
  // Job not found
  res.status(404).json({ error: 'Job not found' });
});

// Start the server
app.listen(port, () => {
  console.log(`Offmute API running on port ${port}`);
});

export default app;