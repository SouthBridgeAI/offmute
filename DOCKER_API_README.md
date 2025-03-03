# Offmute Docker API 🎙️

<div align="center">

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

**Docker-based API for intelligent meeting transcription and analysis using Google's Gemini models**

</div>

## 🚀 Features

- 🎯 **Transcription & Diarization**: Convert meeting recordings to text with speaker identification
- 🎭 **Smart Speaker Identification**: Identifies speakers by name and role when possible
- 📊 **Meeting Reports**: Generates structured reports with key points and action items
- 🎬 **Video Analysis**: Extracts and analyzes visual content from video meetings
- 🔄 **Progressive Results**: Access description and transcription as they become available
- 📁 **Flexible Output**: Markdown-formatted outputs ready for sharing

## 🏃 Quick Start

```bash
# Clone the repository (if you haven't already)
git clone https://github.com/southbridgeai/offmute.git
cd offmute

# Set your Gemini API key as an environment variable
export GEMINI_API_KEY=your_key_here

# Build and start the Docker container (uses the GEMINI_API_KEY from your environment)
docker-compose up -d

# Or you can pass the API key directly to docker-compose
GEMINI_API_KEY=your_key_here docker-compose up -d
```

## 📋 API Usage Guide

### 1. Upload and Process a Meeting Recording

#### Option A: Standard Asynchronous Processing

```bash
curl -F "file=@meeting.mp4;type=video/mp4" \
     -F "generateReport=true" \
     http://localhost:3000/api/process
```

**Response:**
```json
{
  "message": "Processing started",
  "jobId": "1234567890",
  "status": "processing",
  "inputFile": "meeting.mp4"
}
```

#### Option B: Streaming Response

```bash
curl -F "file=@meeting.mp4;type=video/mp4" \
     -F "generateReport=true" \
     -F "streamResponse=true" \
     http://localhost:3000/api/process
```

This will keep the connection open and stream Server-Sent Events (SSE) with live updates as processing progresses:

1. Initial processing started
2. Description completion with full description text
3. Transcription completion with full transcription text
4. Report completion with full report content (if requested)

**Request Parameters:**
- `file`: The video or audio file to process (required)
- `tier`: Processing tier - first, business, economy, budget (optional, default: "business")
- `screenshotCount`: Number of screenshots to extract (optional, default: 4)
- `audioChunkMinutes`: Audio chunk length in minutes (optional, default: 10)
- `generateReport`: Whether to generate a report (optional, default: false)
- `streamResponse`: Whether to use streaming response (optional, default: false)

### 2. Check Job Status

```bash
curl http://localhost:3000/api/jobs/1234567890
```

The status will progress through these stages:
- `processing`: Initial processing
- `description_complete`: Description is ready, transcription in progress
- `transcription_complete`: Transcription is ready, report generation in progress (if requested)
- `completed`: All processing complete

**Response Example (Description Complete):**
```json
{
  "jobId": "1234567890",
  "status": "description_complete",
  "inputFile": "meeting.mp4",
  "outputs": {
    "descriptionFile": "uploads/1234567890-meeting/meeting_description.md"
  },
  "downloadLinks": {
    "description": "/api/results/1234567890/description"
  },
  "transcription": {
    "status": "in_progress"
  }
}
```

**Response Example (Transcription Complete):**
```json
{
  "jobId": "1234567890",
  "status": "transcription_complete",
  "inputFile": "meeting.mp4",
  "outputs": {
    "descriptionFile": "uploads/1234567890-meeting/meeting_description.md",
    "transcriptionFile": "uploads/1234567890-meeting/meeting_transcription.md"
  },
  "downloadLinks": {
    "description": "/api/results/1234567890/description",
    "transcription": "/api/results/1234567890/transcription"
  },
  "report": {
    "status": "in_progress"
  }
}
```

**Response Example (Completed):**
```json
{
  "jobId": "1234567890",
  "status": "completed",
  "inputFile": "meeting.mp4",
  "outputs": {
    "descriptionFile": "uploads/1234567890-meeting/meeting_description.md",
    "transcriptionFile": "uploads/1234567890-meeting/meeting_transcription.md",
    "reportFile": "uploads/1234567890-meeting/meeting_summary.md"
  },
  "downloadLinks": {
    "description": "/api/results/1234567890/description",
    "transcription": "/api/results/1234567890/transcription",
    "report": "/api/results/1234567890/report"
  }
}
```

### 3. Download Results

```bash
# Download the description
curl -O http://localhost:3000/api/results/1234567890/description

# Download the transcription
curl -O http://localhost:3000/api/results/1234567890/transcription

# Download the report (if generated)
curl -O http://localhost:3000/api/results/1234567890/report
```

## 🛡️ Processing Tiers

Choose the processing tier that fits your needs:

- **First Tier** (`first`): Gemini 2.0 Pro models for all operations
  - Highest quality results
  - More detailed analysis
  - Best speaker identification

- **Business Tier** (`business`): Pro models for description/report, Flash for transcription
  - High quality descriptions and reports
  - Good transcription quality
  - Great balance of quality and speed

- **Economy Tier** (`economy`): Flash models for all operations
  - Good all-around quality
  - Faster processing
  - More cost-effective

- **Budget Tier** (`budget`): Flash for description, Flash Lite for transcription/report
  - Basic functionality
  - Fastest processing
  - Most cost-effective

## 🛠️ Requirements

- Docker and Docker Compose
- Google Gemini API key
- Sufficient disk space for processing media files

## 🔍 Troubleshooting

### Common Issues

1. **File Upload Errors**
   - Ensure file is a supported format (MP4, WebM, MP3, WAV)
   - Specify the content type explicitly: `-F "file=@meeting.mp4;type=video/mp4"`

2. **Model Not Found Errors**
   - Verify your Gemini API key is valid and has access to the required models
   - Try using a different tier (e.g., "economy" instead of "first")

3. **Processing Failures**
   - Check the error message in the job status
   - For large files, try increasing the container's resources in docker-compose.yml

## 📊 Example Output

### Description
A detailed summary of the meeting including:
- Number and identity of participants
- Meeting context and setting
- Visual elements (presentations, demos)
- Overall meeting flow

### Transcription
A time-stamped transcript with speaker identification:
```
[00:00:15] John (CEO): Welcome everyone to our quarterly planning meeting.

[00:00:45] Sarah (Product Manager): I'd like to start by discussing our roadmap for Q3...

[00:03:22] Michael (Engineering): We need to address the technical debt before adding new features...
```

### Report
A structured summary including:
- Key points and decisions
- Action items with assignees
- Follow-up tasks
- Questions raised
- Participant profiles

## 📝 License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

Created by [Hrishi Olickel](https://twitter.com/hrishioa) • Support offmute by starring our [GitHub repository](https://github.com/southbridgeai/offmute)