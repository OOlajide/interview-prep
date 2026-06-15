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

async function getApiKey() {
  if (process.env.K_SERVICE) {
    console.log('Detected Google Cloud environment, fetching secret...');
    try {
      const name = 'projects/151337636767/secrets/GEMINI_API_KEY/versions/latest';
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

    if (!ai) {
      const apiKey = await getApiKey();
      if (!apiKey) throw new Error('GEMINI_API_KEY not found');
      ai = new GoogleGenAI({ apiKey });
    }

    const prompt = `You are an expert interviewer and career coach. Review the following mock interview transcript and generate structured feedback.

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
  "summary": "Overall summary of the candidate's performance",
  "strengths": ["Strength 1", "Strength 2", ...],
  "weaknesses": ["Weakness 1", "Weakness 2", ...],
  "missedOpportunities": ["Detail where the candidate could have elaborated or given a better answer", ...],
  "improvedAnswerExamples": ["Format each example strictly using this structure (use double newlines between sections):\n\n**Question**: [Question from transcript]\n\n**Critique**: [Why the original answer could be improved]\n\n**Suggested Answer**: [A model answer using STAR method if behavioral, or step-by-step clarity if technical]", ...],
  "resumeJobFit": "Analysis of how well the candidate's resume aligns with this job description",
  "recommendedPracticeAreas": ["Area to practice 1", "Area to practice 2", ...]
}
Ensure the JSON is valid, contains no extra markdown wrapper, and conforms strictly to this structure.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      }
    });

    const resultText = response.text;
    res.json(JSON.parse(resultText));
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
