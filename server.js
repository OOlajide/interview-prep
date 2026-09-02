import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');
const multer = require('multer');

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Parse JSON bodies

// Serve static frontend build
app.use(express.static('dist'));

const secretClient = new SecretManagerServiceClient();
let ai;

let projectId;
async function getProjectId() {
  if (!projectId) {
    projectId = process.env.GOOGLE_CLOUD_PROJECT || await secretClient.getProjectId();
  }
  return projectId;
}

async function getZanApiKey() {
  if (process.env.K_SERVICE) {
    console.log('Detected Google Cloud environment, fetching ZAN secret...');
    try {
      const projId = await getProjectId();
      const name = `projects/${projId}/secrets/ZAN_API_KEY/versions/latest`;
      const [version] = await secretClient.accessSecretVersion({ name });
      return version.payload.data.toString().trim();
    } catch (error) {
      console.error('CRITICAL: Error fetching ZAN_API_KEY from Secret Manager:', error);
      if (process.env.ZAN_API_KEY) {
        return process.env.ZAN_API_KEY.trim();
      }
      throw new Error(`Failed to access ZAN_API_KEY in Secret Manager: ${error.message}`);
    }
  }
  return process.env.ZAN_API_KEY ? process.env.ZAN_API_KEY.trim() : undefined;
}

async function getApiKey() {
  if (process.env.K_SERVICE) {
    console.log('Detected Google Cloud environment, fetching secret...');
    try {
      const projId = await getProjectId();
      const name = `projects/${projId}/secrets/GEMINI_API_KEY/versions/latest`;
      const [version] = await secretClient.accessSecretVersion({ name });
      return version.payload.data.toString();
    } catch (error) {
      console.error('CRITICAL: Error fetching secret from Secret Manager:', error);
      throw error;
    }
  }
  return process.env.GEMINI_API_KEY;
}

// Health check endpoint for Cloud Run
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Configure Multer for PDF resume upload (in-memory)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed!'), false);
    }
  }
});

// Route to parse resume PDF
app.post('/api/parse-resume-pdf', (req, res) => {
  upload.single('resume')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Backend validation of file extension
    const fileExtension = path.extname(req.file.originalname).toLowerCase();
    if (fileExtension !== '.pdf') {
      return res.status(400).json({ error: 'Uploaded file must have a .pdf extension' });
    }

    try {
      const parser = new pdf.PDFParse({ data: req.file.buffer });
      const result = await parser.getText();
      if (!result.text || !result.text.trim()) {
        return res.status(400).json({ error: 'PDF contains no extractable text' });
      }
      res.json({ resumeText: result.text });
    } catch (parseErr) {
      console.error("PDF parse error:", parseErr);
      res.status(500).json({ error: 'Failed to parse PDF resume' });
    }
  });
});

// Route to generate structured feedback after the interview
app.post('/api/interview-feedback', async (req, res) => {
  try {
    const { resumeText, jobDescriptionText, transcript, interviewType, targetRoleOrCompany } = req.body;
    
    if (!transcript || !transcript.trim()) {
      return res.status(400).json({ error: 'Transcript is required to generate feedback.' });
    }

    const prompt = `You are an expert interviewer and career coach. Review the following mock interview transcript and generate structured, honest feedback.

CRITICAL EVALUATION AND SCORING RULES:
1. STRICT TRANSCRIPT GROUNDING: Evaluate performance SOLELY on the candidate's actual spoken statements in the Interview Transcript. NEVER invent, assume, or hallucinate answers that the candidate did not speak.
2. RESUME BOUNDARY: The Candidate Resume is provided strictly for background context and for completing the "resumeJobFit" field. It must NEVER substitute for spoken interview performance, nor inflate the "overallScore", "strengths", or "weaknesses".
3. EMPTY OR ABANDONED INTERVIEWS:
   - If the transcript contains NO candidate responses, or only silent/trivial filler (e.g. "hi", "ok"), the "overallScore" MUST be 0.
   - In this case, "summary" MUST explicitly state: "The mock interview was ended prematurely before the candidate answered any interview questions. Verbal interview performance could not be evaluated."
   - "strengths" should only note background qualifications if relevant, but explicitly state that no interview performance was demonstrated.
   - "weaknesses" MUST highlight that the candidate did not participate in or complete the interview.
   - "improvedAnswerExamples" MUST be an empty array [] because no candidate answers were attempted.
4. SCORING RUBRIC (Based strictly on verbal responses):
   - 85-100: Outstanding, articulate answers using STAR method with clear metrics, technical depth, and strong structure across multiple questions.
   - 70-84: Solid answers with good relevance, but minor gaps in structure or depth.
   - 50-69: Vague or brief answers lacking concrete examples or details.
   - 1-49: Severely incomplete interview (e.g., only 1 brief answer given before ending).
   - 0: No candidate answers recorded.

Interview Details:
- Type: ${interviewType || 'General'}
- Target Role/Company: ${targetRoleOrCompany || 'Not specified'}

Job Description:
${jobDescriptionText || 'Not specified'}

Candidate Resume:
${resumeText || 'Not specified'}

Interview Transcript:
${transcript}

Generate a comprehensive feedback report in JSON format matching this exact schema:
{
  "overallScore": number (out of 100),
  "summary": "Overall summary of the candidate's actual interview performance",
  "strengths": ["Strength 1", "Strength 2", ...],
  "weaknesses": ["Weakness 1", "Weakness 2", ...],
  "improvedAnswerExamples": [
    {
      "question": "Question from transcript",
      "critique": "Why the candidate's actual spoken answer could be improved",
      "suggestedAnswer": "A model answer using STAR method if behavioral, or step-by-step clarity if technical (only the model answer, do not repeat question/critique prefixes)"
    }
  ],
  "resumeJobFit": "Analysis of how well the candidate's resume aligns with this job description",
  "recommendedPracticeAreas": ["Area to practice 1", "Area to practice 2", ...]
}
Ensure the JSON is valid, contains no extra markdown wrapper, and conforms strictly to this structure.`;

    const zanApiKey = await getZanApiKey();
    if (!zanApiKey) {
      throw new Error('ZAN_API_KEY not found');
    }

    const payload = {
      model: "gemini-2.5-flash-lite",
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0,
      response_format: { type: "json_object" }
    };

    const apiResponse = await fetch("https://ai.zan.top/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${zanApiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      throw new Error(`Zan API error (gemini-2.5-flash-lite): ${apiResponse.status} - ${errorText}`);
    }

    const data = await apiResponse.json();
    const resultText = data.choices[0].message.content;

    // Robust cleanup of markdown wrapper if model returns any
    let cleanJson = resultText.trim();
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```(?:json)?\n?/i, '');
      cleanJson = cleanJson.replace(/\n?```$/, '');
      cleanJson = cleanJson.trim();
    }

    res.json(JSON.parse(cleanJson));
  } catch (error) {
    console.error("Error generating feedback:", error);
    res.status(500).json({ error: error.message || 'Failed to generate feedback' });
  }
});

// Route to handle front-end requests for tokens
app.get('/api/token', async (req, res) => {
  try {
    if (!ai) {
      const apiKey = await getApiKey();
      if (!apiKey) throw new Error('GEMINI_API_KEY not found');
      ai = new GoogleGenAI({ apiKey });
    }

    const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: expireTime,
        httpOptions: { apiVersion: 'v1alpha' }
      }
    });
    res.json({ token: token.name });
  } catch (error) {
    console.error("Error creating token:", error);
    res.status(500).json({ error: error.message });
  }
});

// For Cloud Run, use a middleware fallback for SPA support (avoids Express 5 regex issues)
app.use((req, res) => {
  const indexPath = path.join(__dirname, 'dist', 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      console.error('Error sending index.html:', err);
      res.status(404).send('Not Found');
    }
  });
});

const PORT = process.env.PORT || 8080;
// Cloud Run requires listening on 0.0.0.0
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server starting on port ${PORT}...`);
  console.log(`Environment: ${process.env.K_SERVICE ? 'Cloud Run' : 'Local'}`);
});
