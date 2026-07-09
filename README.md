# Interview Prep
### Live AI Mock Interviews Tailored to Your Resume and Job Description

Interview Prep is a real-time, voice-based AI mock interview application powered by the Gemini Live API. It allows candidates to upload their resume as a PDF, paste their target job description, select their interview format, and practice a dynamic mock interview. After the interview, it delivers structured feedback highlighting overall scores, strengths, weaknesses, missed opportunities, and suggested improvements.

---

## 🚀 Key Features
- **Real-Time Interactive AI Interviewer**: Low-latency spoken conversation mimicking a live human interviewer.
- **Customized/Tailored Experience**: Generates questions based on the candidate's actual resume (extracted from PDF) and target job description.
- **Support for Key Formats**: Practice Behavioral, Technical, Product/Case, or Mixed interview screens.
- **Optional Webcam Support**: Enable webcam to simulate an in-person meeting experience.
- **Comprehensive Feedback Dashboard**: Receives overall scores, bulleted lists of strengths/weaknesses, concrete improvement examples (e.g., STAR structure), and alignment insights.

---

## 🛠 Tech Stack
- **Backend**: Node.js, Express, `pdf-parse`, `multer`
- **Frontend**: Vanilla JS, Vite, HTML5 (Web Audio / Media API)
- **AI Integration**: Gemini Live API (`gemini-3.1-flash-live-preview`), GMI Cloud API (`deepseek-ai/DeepSeek-V4-Flash` for feedback extraction)

---

## 📋 Prerequisites
- **Node.js**: Version 18.0.0 or higher.
- **Gemini API Key**: Obtain a key from [Google AI Studio](https://aistudio.google.com/).
- **GMI Cloud API Key**: Obtain a key from [GMI Cloud Console](https://console.gmicloud.ai/).

---

## 🧪 Setup and Local Testing Instructions

### Step 1: Clone the Repository
```bash
git clone https://github.com/OOlajide/interview-prep.git
cd interview-prep
```

### Step 2: Environment Configuration
1. Create a `.env` file in the root directory:
   ```bash
   cp .env.example .env
   ```
2. Open the `.env` file and input your Gemini and GMI Cloud API Keys:
   ```env
   GEMINI_API_KEY=your_actual_api_key_here
   GMI_CLOUD_API_KEY=your_actual_gmi_cloud_api_key_here
   ```

### Step 3: Installation
Install required dependencies:
```bash
npm install
```

### Step 4: Build and Start
1. Build the production asset bundle:
   ```bash
   npm run build
   ```
2. Run the application:
   ```bash
   npm start
   ```

### Step 5: Start Interview Prep
1. Navigate to `http://localhost:8080`.
2. Grant microphone and (optional) camera permissions when prompted.
3. Upload your resume PDF and paste the job description text.
4. Select the interview settings and press **Start Mock Interview**.
5. Practice responding out loud. When finished, click **End Interview** to view your feedback report!