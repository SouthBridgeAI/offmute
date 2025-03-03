import { generateWithGemini } from "./utils/gemini";
import {
  REPORT_HEADINGS_JSONSCHEMA,
  REPORT_HEADINGS_PROMPT,
  REPORT_SECTION_GENERATION_PROMPT,
  ReportHeadings,
  ReportSection,
} from "./prompts";
import path from "path";
import fs from "fs";

interface GenerateReportOptions {
  model: string;
  outputPath: string;
  reportName: string;
  showProgress?: boolean;
}

export interface GenerateReportResult {
  reportPath: string;
  sections: ReportSection[];
  intermediateOutputPath: string;
}

interface ReportGenerationOutput {
  timestamp: number;
  step: string;
  data: any;
  prompt?: string;
  error?: string;
}

function isValidSectionContent(content: string): boolean {
  // Check if content appears to be JSON
  if (content.trim().startsWith("{") || content.trim().startsWith("[")) {
    try {
      JSON.parse(content);
      return false; // If it parses as JSON, it's not valid section content
    } catch {
      // If it doesn't parse as JSON, continue with other checks
    }
  }

  // Check if content is too short or empty
  if (content.trim().length < 10) {
    return false;
  }

  // Check if content appears to be just headings
  const contentLines = content.trim().split("\n");
  if (
    contentLines.every((line) => line.startsWith("#") || line.trim() === "")
  ) {
    return false;
  }

  return true;
}

async function saveReportOutput(
  outputPath: string,
  data: Partial<ReportGenerationOutput>
): Promise<void> {
  const outputFile = path.join(outputPath, "report_generation.json");
  const timestamp = Date.now();

  // Create directory if it doesn't exist
  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true });
  }

  // Read existing data if it exists
  let existingData: ReportGenerationOutput[] = [];
  if (fs.existsSync(outputFile)) {
    try {
      existingData = JSON.parse(fs.readFileSync(outputFile, "utf8"));
    } catch (error) {
      console.warn("Error reading report generation file:", error);
    }
  }

  // Add new data
  existingData.push({
    timestamp,
    ...data,
  } as ReportGenerationOutput);

  // Save updated data
  fs.writeFileSync(outputFile, JSON.stringify(existingData, null, 2));
}

export async function generateReport(
  descriptions: string,
  transcript: string,
  options: GenerateReportOptions
): Promise<GenerateReportResult> {
  const { model, outputPath, reportName, showProgress = false } = options;

  // Create report directory under outputPath
  const reportDir = path.join(outputPath, "report");
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  try {
    if (showProgress) {
      console.log("Generating report structure...");
    }

    // Save initial prompts
    const headingsPrompt = REPORT_HEADINGS_PROMPT(descriptions, transcript);
    await saveReportOutput(reportDir, {
      step: "initial_prompt",
      prompt: headingsPrompt,
      data: {
        descriptions,
        transcript,
      },
    });

    // First, generate the report structure
    const headingsResponse = await generateWithGemini(
      model,
      headingsPrompt,
      [],
      {
        maxRetries: 3,
        temperature: 0.2,
        schema: REPORT_HEADINGS_JSONSCHEMA,
      }
    );

    if (headingsResponse.error) {
      throw new Error(
        `Failed to generate report structure: ${headingsResponse.error}`
      );
    }

    await saveReportOutput(reportDir, {
      step: "generate_structure",
      data: headingsResponse.text,
    });

    const headings: ReportHeadings = JSON.parse(headingsResponse.text);

    if (showProgress) {
      console.log(`Generating ${headings.sections.length} sections...`);
    }

    // Generate content for each section
    const sectionContents: string[] = [];
    for (let i = 0; i < headings.sections.length; i++) {
      const section = headings.sections[i];

      if (showProgress) {
        console.log(
          `Processing section ${i + 1}/${headings.sections.length}: ${
            section.title
          }`
        );
      }

      try {
        const sectionPrompt = REPORT_SECTION_GENERATION_PROMPT(
          headings,
          section,
          transcript,
          descriptions
        );

        // Save section prompt
        await saveReportOutput(reportDir, {
          step: "section_prompt",
          prompt: sectionPrompt,
          data: {
            sectionTitle: section.title,
            sectionIndex: i,
          },
        });

        const sectionResponse = await generateWithGemini(
          model,
          sectionPrompt,
          [],
          {
            maxRetries: 3,
            temperature: 0.3,
          }
        );

        if (
          sectionResponse.error ||
          !isValidSectionContent(sectionResponse.text)
        ) {
          console.warn(
            `Warning: Error or invalid content for section ${section.title}: ${
              sectionResponse.error || "Invalid content format"
            }`
          );

          // Retry once with a more explicit prompt if content was invalid
          if (
            !sectionResponse.error &&
            !isValidSectionContent(sectionResponse.text)
          ) {
            const retryPrompt = `${sectionPrompt}\n\nPlease provide the content for this section in plain text format, not as JSON or outline. Write it as a narrative paragraph.`;

            const retryResponse = await generateWithGemini(
              model,
              retryPrompt,
              [],
              {
                maxRetries: 2,
                temperature: 0.3,
              }
            );

            if (
              !retryResponse.error &&
              isValidSectionContent(retryResponse.text)
            ) {
              sectionContents.push(
                `## ${section.title}\n\n${retryResponse.text}`
              );
            }
          }
        } else {
          sectionContents.push(
            `## ${section.title}\n\n${sectionResponse.text}`
          );
        }

        await saveReportOutput(reportDir, {
          step: "generate_section",
          data: {
            section: section.title,
            content: sectionResponse.text,
            error: sectionResponse.error,
          },
        });
      } catch (error) {
        console.warn(
          `Warning: Failed to generate section ${section.title}:`,
          error
        );
        sectionContents.push(
          `## ${section.title}\n\n*Error generating content*`
        );
      }
    }

    // Combine all sections into final report
    const reportContent = ["# Meeting Report\n", ...sectionContents].join(
      "\n\n"
    );

    // Save the report with custom name
    const reportPath = path.join(outputPath, `${reportName}.md`);
    fs.writeFileSync(reportPath, reportContent, "utf-8");

    if (showProgress) {
      console.log(`Report generation complete. Saved to: ${reportPath}`);
    }

    return {
      reportPath,
      sections: headings.sections,
      intermediateOutputPath: reportDir,
    };
  } catch (error) {
    // Save error state
    await saveReportOutput(reportDir, {
      step: "error",
      error: error instanceof Error ? error.message : String(error),
      data: null,
    });

    throw error;
  }
}

// const result = await generateReport(descriptions, transcript, {
//   model: "gemini-1.5-pro",
//   outputPath: __dirname + "/../tests/report_tests",
//   reportName: "test_meeting",
//   showProgress: true,
// });

// console.log("Report saved to:", result.reportPath);
// console.log("Intermediates saved to:", result.intermediateOutputPath);
