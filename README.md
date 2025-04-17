# npx offmute 🎙️

<div align="center">

[![NPM version](https://img.shields.io/npm/v/offmute.svg)](https://www.npmjs.com/package/offmute)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

**Intelligent meeting transcription and analysis using Google's Gemini models**

[Features](#-features) • [Quick Start](#-quick-start) • [Installation](#-installation) • [Usage](#-usage) • [Advanced](#-advanced-usage) • [How It Works](#-how-it-works)

</div>

## 🚀 Features

- 🎯 **Transcription & Diarization**: Convert audio/video content to text while identifying different speakers
- 🎭 **Smart Speaker Identification**: Attempts to identify speakers by name and role when possible
- 📊 **Meeting Reports**: Generates structured reports with key points, action items, and participant profiles
- 🎬 **Video Analysis**: Extracts and analyzes visual information from video meetings, understand when demos are being displayed
- ⚡ **Multiple Processing Tiers**: From budget-friendly to premium processing options
- 🔄 **Robust Processing**: Handles long meetings with automatic chunking and proper cleanup
- 📁 **Flexible Output**: Markdown-formatted transcripts and reports with optional intermediate outputs
- 🔍 **Real-time Progress**: View transcription and report generation progress in real-time
- 🎯 **Custom Instructions**: Add your own context or instructions to guide the AI processing
- 🧹 **Clean Filesystem**: Temporary files are managed cleanly without cluttering your directories

## 🏃 Quick Start

```bash
# Set your Gemini API key
export GEMINI_API_KEY=your_key_here

# Run on a meeting recording
npx offmute path/to/your/meeting.mp4
```

## 📦 Installation

### As a CLI Tool

```bash
npx offmute <Meeting_Location> <options>
```

### As a Package

```bash
npm install offmute
```

## Get Help

```
npx offmute --help
```

`bunx` or `bun` works faster if you have it!

## 💻 Usage

### Command Line Interface

```bash
npx offmute <input-file> [options]
```

Options:

- `-t, --tier <tier>`: Processing tier (first, business, economy, budget, experimental) [default: "business"]
- `-s, --save-intermediates`: Save intermediate processing files
- `-id, --intermediates-dir <path>`: Custom directory for intermediate output
- `-sc, --screenshot-count <number>`: Number of screenshots to extract [default: 4]
- `-ac, --audio-chunk-minutes <number>`: Length of audio chunks in minutes [default: 10]
- `-r, --report`: Generate a structured meeting report
- `-rd, --reports-dir <path>`: Custom directory for report output
- `-i, --instructions <text>`: Custom context or instructions to include in AI prompts

### Processing Tiers

- **First Tier** (`first`): Uses Gemini 2.0 Pro models for all operations
- **Business Tier** (`business`): Gemini 2.0 Pro for description and report, Gemini 2.0 Flash for transcription
- **Economy Tier** (`economy`): Gemini 2.0 Flash models for all operations
- **Budget Tier** (`budget`): Gemini 2.0 Flash for description, Gemini 2.0 Flash Lite for transcription and report
- **Experimental Tier** (`experimental`): Uses the cutting-edge Gemini 2.5 Pro Preview model for all operations, with support for 65k token outputs
- **Experimental Budget Tier** (`experimentalBudget`): Uses the cutting-edge Gemini 2.5 Flash Preview model for all operations, with support for 65k token outputs

### As a Module

```typescript
import {
  generateDescription,
  generateTranscription,
  generateReport,
} from "offmute";

// Generate description and transcription
const description = await generateDescription(inputFile, {
  screenshotModel: "gemini-2.0-pro-exp-02-05",
  audioModel: "gemini-2.0-pro-exp-02-05",
  mergeModel: "gemini-2.0-pro-exp-02-05",
  showProgress: true,
  userInstructions: "Focus on technical content and action items",
});

const transcription = await generateTranscription(inputFile, description, {
  transcriptionModel: "gemini-2.0-pro-exp-02-05",
  showProgress: true,
  userInstructions: "Add emotions and tone information for each speaker",
});

// Generate a structured report
const report = await generateReport(
  description.finalDescription,
  transcription.chunkTranscriptions.join("\n\n"),
  {
    model: "gemini-2.0-pro-exp-02-05",
    reportName: "meeting_summary",
    showProgress: true,
    userInstructions: "Highlight all action items with bullet points",
  }
);
```

## 🔧 Advanced Usage

### Intermediate Files and Directories

By default, offmute uses a system temporary directory to store intermediate files and cleans them up when processing completes. If you want to save these files:

```bash
# Save intermediates in a hidden .offmute_[filename] directory
npx offmute meeting.mp4 --save-intermediates

# Save intermediates in a custom directory
npx offmute meeting.mp4 --save-intermediates --intermediates-dir ./processing_files
```

When saved, intermediate files are organized in a clean structure:

```
.offmute_meeting/
├── screenshots/          # Video screenshots
├── audio/                # Processed audio chunks
├── transcription/        # Per-chunk transcriptions
└── report/               # Report generation data
```

### Custom Instructions

You can provide custom instructions to the AI models to focus on specific aspects:

```bash
# Focus on technical details and action items
npx offmute technical_meeting.mp4 -i "Focus on technical terminology and highlight all action items"

# Improve speaker emotion detection
npx offmute interview.mp4 -i "Pay special attention to emotional tone and hesitations"
```

### Real-time Progress Tracking

Offmute now creates output files early in the process and updates them incrementally, allowing you to:

1. See transcription progress in real-time
2. Monitor report generation section by section
3. Check partial results even for long-running processes

### Experimental Mode

Try the cutting-edge Gemini 2.5 Pro Preview model for improved performance across all operations:

```bash
# Use experimental mode with Gemini 2.5 Pro Preview
npx offmute important_meeting.mp4 --tier experimental

# Combine with custom instructions for best results
npx offmute strategic_call.mp4 --tier experimental -i "Focus on financial projections and strategic initiatives"
```

The experimental tier leverages Gemini 2.5's expanded 65k token output capability, allowing for more detailed and comprehensive results, especially for longer meetings or when generating complex reports.

### Custom Chunk Sizes

Adjust processing for different content types:

```bash
# Longer chunks for presentations
offmute presentation.mp4 -ac 20

# More screenshots for visual-heavy content
offmute workshop.mp4 -sc 8
```

## ⚙️ How It Works

offmute uses a multi-stage pipeline:

1. **Content Analysis**

   - Extracts screenshots from videos at key moments
   - Chunks audio into processable segments
   - Generates initial descriptions of visual and audio content

2. **Transcription & Diarization**

   - Processes audio chunks with context awareness
   - Identifies and labels speakers
   - Maintains conversation flow across chunks
   - Shows real-time progress in the output file

3. **Report Generation (Spreadfill)**
   - Uses a unique "Spreadfill" technique:
     1. Generates report structure with section headings
     2. Fills each section independently using full context
     3. Ensures coherent narrative while maintaining detailed coverage
   - Updates report file in real-time as sections are completed

### Metadata Management

Offmute now includes accurate file metadata in outputs:

- File creation and modification dates
- Processing timestamp
- File size and path information
- Custom instructions (when provided)

This provides reliable context without AI guessing incorrect meeting dates/times.

### Spreadfill Technique

The Spreadfill approach helps maintain consistency while allowing detailed analysis:

```typescript
// 1. Generate structure
const structure = await generateHeadings(description, transcript);

// 2. Fill sections independently
const sections = await Promise.all(
  structure.sections.map((section) => generateSection(section, fullContext))
);

// 3. Combine into coherent report
const report = combineResults(sections);
```

## 🛠️ Requirements

- Node.js 14 or later
- ffmpeg installed on your system
- Google Gemini API key

## Contributing

You can start in `TODOs.md` to help with things I'm thinking about, or you can steel yourself and check out `PROBLEMS.md`.

Created by [Hrishi Olickel](https://twitter.com/hrishioa) • Support offmute by starring our [GitHub repository](https://github.com/southbridgeai/offmute)
