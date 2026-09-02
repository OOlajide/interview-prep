import { GoogleGenAI, Modality } from '@google/genai';
import { systemInstructions } from './system-instructions.js';

let stream;
let videoElement;
let canvas, ctx;
let audioContext;
let audioWorkletNode;
let session;
let isSessionActive = false;
let nextPlayTime = 0;
let frameInterval;
let lastSpeaker = null;
let currentMsgContent = null;
let resumeText = '';
let resumeFileName = '';
let transcriptHistory = [];

// DOM Elements - Config Section
const resumeFileInput = document.getElementById('resumeFile');
const uploadZone = document.getElementById('uploadZone');
const uploadPrompt = document.getElementById('uploadPrompt');
const fileDetails = document.getElementById('fileDetails');
const fileNameSpan = document.getElementById('fileName');
const removeFileBtn = document.getElementById('removeFileBtn');

const jobDescriptionInput = document.getElementById('jobDescription');
const targetRoleInput = document.getElementById('targetRole');
const interviewTypeSelect = document.getElementById('interviewType');
const cameraToggle = document.getElementById('cameraToggle');

const startBtn = document.getElementById('startBtn');
const errorBanner = document.getElementById('errorBanner');

// DOM Elements - Stage Sections
const stageIdle = document.getElementById('stateIdle');
const stageSession = document.getElementById('stateSession');
const stageLoadingFeedback = document.getElementById('stateLoadingFeedback');
const stageFeedback = document.getElementById('stateFeedback');

// DOM Elements - Active Session Info
const statusText = document.getElementById('statusText');
const statusDot = document.getElementById('statusDot');
const videoContainer = document.getElementById('videoContainer');
const cameraPlaceholder = document.getElementById('cameraPlaceholder');
const cameraEl = document.getElementById('camera');
const avatarGlow = document.getElementById('avatarGlow');
const stopBtn = document.getElementById('stopBtn');

// DOM Elements - Feedback Details
const scoreCircle = document.getElementById('scoreCircle');
const feedbackRating = document.getElementById('feedbackRating');
const feedbackSummary = document.getElementById('feedbackSummary');
const feedbackStrengths = document.getElementById('feedbackStrengths');
const feedbackWeaknesses = document.getElementById('feedbackWeaknesses');
const feedbackOpportunities = document.getElementById('feedbackOpportunities');
const feedbackAlignment = document.getElementById('feedbackAlignment');
const feedbackExamples = document.getElementById('feedbackExamples');
const feedbackPractice = document.getElementById('feedbackPractice');
const resetSessionBtn = document.getElementById('resetSessionBtn');

// DOM Elements - Guide Modal
const guideBtn = document.getElementById('guideBtn');
const guideModal = document.getElementById('guideModal');
const closeGuideBtn = document.getElementById('closeGuideBtn');

// Guide Modal Triggers
guideBtn.onclick = () => {
  guideModal.style.display = 'flex';
};

closeGuideBtn.onclick = () => {
  guideModal.style.display = 'none';
};

// Error Banner controls
function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.style.display = 'flex';
  errorBanner.scrollIntoView({ behavior: 'smooth' });
}

function hideError() {
  errorBanner.style.display = 'none';
}

// Stage transition switcher
function switchState(stateName) {
  stageIdle.classList.remove('active');
  stageSession.classList.remove('active');
  stageLoadingFeedback.classList.remove('active');
  stageFeedback.classList.remove('active');

  if (stateName === 'idle') stageIdle.classList.add('active');
  if (stateName === 'session') stageSession.classList.add('active');
  if (stateName === 'loading-feedback') stageLoadingFeedback.classList.add('active');
  if (stateName === 'feedback') stageFeedback.classList.add('active');
}

// Check if Start Mock Interview should be enabled
function checkInputsValidity() {
  const hasResume = !!resumeText;
  const hasJobDesc = !!jobDescriptionInput.value.trim();
  startBtn.disabled = !(hasResume && hasJobDesc);
}

// File selection trigger
uploadZone.onclick = () => {
  resumeFileInput.click();
};

uploadZone.ondragover = (e) => {
  e.preventDefault();
  uploadZone.classList.add('active');
};

uploadZone.ondragleave = () => {
  uploadZone.classList.remove('active');
};

uploadZone.ondrop = (e) => {
  e.preventDefault();
  uploadZone.classList.remove('active');
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    handleResumeFile(files[0]);
  }
};

resumeFileInput.onchange = (e) => {
  if (e.target.files.length > 0) {
    handleResumeFile(e.target.files[0]);
  }
};

async function handleResumeFile(file) {
  hideError();
  
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    showError('Only PDF resume files are accepted.');
    return;
  }

  try {
    uploadPrompt.textContent = 'Extracting resume text...';
    startBtn.disabled = true;
    
    const formData = new FormData();
    formData.append('resume', file);

    const res = await fetch('/api/parse-resume-pdf', {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.error || 'Failed to extract text from PDF');
    }

    const data = await res.json();
    resumeText = data.resumeText;
    resumeFileName = file.name;
    
    // Update UI
    uploadPrompt.textContent = 'Resume uploaded successfully!';
    uploadZone.classList.add('active');
    fileNameSpan.textContent = file.name;
    fileDetails.classList.add('visible');
    
    checkInputsValidity();
  } catch (err) {
    console.error(err);
    showError(err.message || 'Failed to parse resume PDF.');
    resetResumeState();
  }
}

function resetResumeState() {
  resumeText = '';
  resumeFileName = '';
  resumeFileInput.value = '';
  uploadPrompt.textContent = 'Drag & drop resume PDF or click to browse';
  uploadZone.classList.remove('active');
  fileDetails.classList.remove('visible');
  checkInputsValidity();
}

removeFileBtn.onclick = (e) => {
  e.stopPropagation();
  resetResumeState();
};

jobDescriptionInput.oninput = checkInputsValidity;

function updateStatus(state, text) {
  statusText.textContent = text;
  statusDot.className = 'status-dot'; // reset
  if (state === 'active') statusDot.classList.add('active');
  if (state === 'error') statusDot.classList.add('error');
  if (state === 'connecting') statusDot.classList.add('connecting');
}

async function initMedia(facingMode = 'user', useCamera = false) {
  videoElement = document.getElementById('camera');
  videoElement.style.transform = facingMode === 'user' ? 'scaleX(-1)' : 'scaleX(1)';

  const constraints = {
    audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true }
  };
  
  if (useCamera) {
    constraints.video = { 
      width: 640, 
      height: 480,
      facingMode: facingMode
    };
  }

  stream = await navigator.mediaDevices.getUserMedia(constraints);
  
  if (useCamera && stream.getVideoTracks().length > 0) {
    videoElement.srcObject = stream;
    videoElement.classList.add('active');
    videoElement.style.display = 'block';
    cameraPlaceholder.style.display = 'none';
    
    canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    ctx = canvas.getContext('2d');
  } else {
    videoElement.srcObject = null;
    videoElement.classList.remove('active');
    videoElement.style.display = 'none';
    cameraPlaceholder.style.display = 'flex';
    ctx = null;
  }
}

function base64Encode(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function playAudio(base64Data) {
  if (!audioContext) return;
  const binaryString = atob(base64Data);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const int16Array = new Int16Array(bytes.buffer);
  const audioBuffer = audioContext.createBuffer(1, int16Array.length, 24000);
  const channelData = audioBuffer.getChannelData(0);
  for (let i = 0; i < int16Array.length; i++) {
    channelData[i] = int16Array[i] / 32768.0;
  }
  
  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioContext.destination);
  
  if (nextPlayTime < audioContext.currentTime) {
    nextPlayTime = audioContext.currentTime;
  }
  source.start(nextPlayTime);
  nextPlayTime += audioBuffer.duration;
  
  // Animate avatar glowing effect during playback
  const durationMs = audioBuffer.duration * 1000;
  avatarGlow.classList.add('pulsing');
  setTimeout(() => {
    if (audioContext && audioContext.currentTime >= nextPlayTime) {
      avatarGlow.classList.remove('pulsing');
    }
  }, durationMs);

  return source;
}

function appendTranscript(text, isInterviewer) {
  if (!text) return;
  
  const speaker = isInterviewer ? 'interviewer' : 'candidate';
  const processedText = text.trim();
  
  // Append to history record for feedback API
  if (transcriptHistory.length === 0 || transcriptHistory[transcriptHistory.length - 1].sender !== speaker) {
    transcriptHistory.push({ sender: speaker, text: processedText });
    lastSpeaker = speaker;
  } else {
    transcriptHistory[transcriptHistory.length - 1].text += ' ' + processedText;
  }
}

async function startSession() {
  try {
    hideError();
    if (!resumeText) {
      showError('Please upload your resume as a PDF before starting.');
      return;
    }
    if (!jobDescriptionInput.value.trim()) {
      showError('Please paste the job description before starting.');
      return;
    }

    startBtn.disabled = true;
    switchState('session');
    updateStatus('connecting', 'Requesting Media...');
    
    const useCamera = cameraToggle.checked;
    try {
      await initMedia('user', useCamera);
    } catch (mediaErr) {
      console.error(mediaErr);
      if (mediaErr.name === 'NotAllowedError') {
        throw new Error('Microphone permission denied. Microphone access is required to run mock interviews.');
      } else {
        throw new Error('Could not access microphone/camera: ' + mediaErr.message);
      }
    }
    
    updateStatus('connecting', 'Authenticating...');
    const tokenRes = await fetch('/api/token');
    if (!tokenRes.ok) {
      const errJson = await tokenRes.json();
      throw new Error(errJson.error || 'Failed to authenticate Live Session');
    }
    const { token } = await tokenRes.json();
    
    updateStatus('connecting', 'Connecting Interviewer...');
    
    const ai = new GoogleGenAI({ 
      apiKey: token,
      httpOptions: { apiVersion: 'v1alpha' }
    });
    
    const interviewType = interviewTypeSelect.value;
    const targetRole = targetRoleInput.value.trim();
    const jobDesc = jobDescriptionInput.value.trim();
    
    // Construct final instructions including role context, resume and job description
    const finalInstructions = systemInstructions + `
\n\n=== INTERVIEW CONTEXT ===
- Interview Type: ${interviewType}
- Target Role/Company: ${targetRole || 'Not specified'}

=== CANDIDATE RESUME ===
${resumeText}

=== JOB DESCRIPTION ===
${jobDesc}
`;
    
    session = await ai.live.connect({
      model: 'gemini-3.1-flash-live-preview',
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: { parts: [{ text: finalInstructions }] },
        inputAudioTranscription: {},
        outputAudioTranscription: {}
      },
      callbacks: {
        onopen: () => {
          updateStatus('active', 'Interviewer Online');
          isSessionActive = true;
          stopBtn.disabled = false;
        },
        onmessage: (response) => {
          const content = response.serverContent;
          if (content?.modelTurn?.parts) {
            for (const part of content.modelTurn.parts) {
              if (part.inlineData) {
                playAudio(part.inlineData.data);
              }
            }
          }
          if (content?.inputTranscription) {
            appendTranscript(content.inputTranscription.text, false);
          }
          if (content?.outputTranscription) {
            appendTranscript(content.outputTranscription.text, true);
          }
          if (content?.interrupted) {
            nextPlayTime = audioContext.currentTime;
          }
        },
        onerror: (error) => {
          console.error("Live API Error:", error);
          showError("Gemini Session error occurred. Please try restarting.");
          updateStatus('error', 'Connection Error');
        },
        onclose: (event) => {
          console.log("Session closed", event);
          if (isSessionActive) {
            if (event.code !== 1000) {
              showError(`Session ended unexpectedly (code ${event.code}${event.reason ? ': ' + event.reason : ''}). Please try restarting.`);
            }
            updateStatus('ready', 'Session Ended');
            stopSession();
          }
        }
      }
    });

    // Prompt the interviewer to deliver the opening greeting and first question
    session.sendClientContent({
      turns: [{ role: 'user', parts: [{ text: 'Hello, I am ready to begin the interview.' }] }],
      turnComplete: true
    });

    audioContext = new AudioContext({ sampleRate: 16000 });
    await audioContext.audioWorklet.addModule('/audio-processor.js');
    const source = audioContext.createMediaStreamSource(stream);
    audioWorkletNode = new AudioWorkletNode(audioContext, 'pcm-processor');
    source.connect(audioWorkletNode);
    audioWorkletNode.connect(audioContext.destination);

    audioWorkletNode.port.onmessage = (event) => {
      if (isSessionActive) {
        const pcmData = event.data;
        const base64Data = base64Encode(pcmData.buffer);
        session.sendRealtimeInput({
          audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
        });
      }
    };
    
    // Send video frames at ~1 FPS only if camera is enabled
    if (useCamera && ctx) {
      frameInterval = setInterval(() => {
        if (isSessionActive && ctx) {
          ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.5);
          const base64Data = dataUrl.split(',')[1];
          session.sendRealtimeInput({
            video: { data: base64Data, mimeType: 'image/jpeg' }
          });
        }
      }, 1000); 
    }
    
  } catch (err) {
    console.error(err);
    showError(err.message || 'Interviewer connection setup failed.');
    stopSession();
    switchState('idle');
  }
}

function stopSession() {
  isSessionActive = false;
  startBtn.disabled = false;
  
  updateStatus('ready', 'Ready');
  
  clearInterval(frameInterval);
  if (session) {
    try {
      session.close();
    } catch (e) {
      console.error(e);
    }
    session = null;
  }
  
  if (audioWorkletNode) {
    audioWorkletNode.disconnect();
    audioWorkletNode = null;
  }

  if (audioContext) {
    try {
      audioContext.close();
    } catch (e) {
      console.error(e);
    }
    audioContext = null;
  }

  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }

  avatarGlow.classList.remove('pulsing');
  if (cameraEl) {
    cameraEl.srcObject = null;
    cameraEl.classList.remove('active');
    cameraEl.style.display = 'none';
  }
  
  lastSpeaker = null;
  currentMsgContent = null;
  nextPlayTime = 0;
  
  checkInputsValidity();
}

async function endSessionAndGetFeedback() {
  const hasHistory = transcriptHistory.length > 0;
  
  stopSession();

  if (!hasHistory) {
    switchState('idle');
    return;
  }

  switchState('loading-feedback');

  try {
    const formattedTranscript = transcriptHistory
      .map(item => `${item.sender === 'interviewer' ? 'Interviewer' : 'Candidate'}: ${item.text}`)
      .join('\n\n');

    const body = {
      resumeText,
      jobDescriptionText: jobDescriptionInput.value.trim(),
      transcript: formattedTranscript,
      interviewType: interviewTypeSelect.value,
      targetRoleOrCompany: targetRoleInput.value.trim()
    };

    const res = await fetch('/api/interview-feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to generate feedback report');
    }

    const feedback = await res.json();
    displayFeedback(feedback);
  } catch (err) {
    console.error(err);
    showError(err.message || 'An error occurred while compiling feedback.');
    switchState('idle');
  }
}

function displayFeedback(feedback) {
  switchState('feedback');

  const score = feedback.overallScore || 0;
  scoreCircle.textContent = `${score}`;
  
  scoreCircle.className = 'score-circle';
  if (score >= 80) {
    scoreCircle.classList.add('high');
    feedbackRating.textContent = 'Excellent Fit';
  } else if (score >= 60) {
    scoreCircle.classList.add('medium');
    feedbackRating.textContent = 'Good Standing';
  } else {
    scoreCircle.classList.add('low');
    feedbackRating.textContent = 'Practice Recommended';
  }

  feedbackSummary.textContent = feedback.summary || 'No summary provided.';

  // Strengths
  feedbackStrengths.innerHTML = '';
  (feedback.strengths || []).forEach(str => {
    const li = document.createElement('li');
    li.textContent = str;
    feedbackStrengths.appendChild(li);
  });

  // Weaknesses
  feedbackWeaknesses.innerHTML = '';
  (feedback.weaknesses || []).forEach(wk => {
    const li = document.createElement('li');
    li.textContent = wk;
    feedbackWeaknesses.appendChild(li);
  });

  // Missed Opportunities
  feedbackOpportunities.innerHTML = '';
  (feedback.missedOpportunities || []).forEach(op => {
    const li = document.createElement('li');
    li.textContent = op;
    feedbackOpportunities.appendChild(li);
  });

  // Alignment
  feedbackAlignment.textContent = feedback.resumeJobFit || 'No resume-job alignment analysis provided.';

  // Examples
  feedbackExamples.innerHTML = '';
  (feedback.improvedAnswerExamples || []).forEach(ex => {
    if (!ex) return;
    
    // Safely cast or format ex to a string. 
    // Sometimes the LLM returns an object structure for improvedAnswerExamples instead of a raw string.
    let rawText = '';
    if (typeof ex === 'string') {
      rawText = ex;
    } else if (typeof ex === 'object') {
      // If it's an object, format its properties (e.g. question, critique, suggestedAnswer)
      const parts = [];
      if (ex.question) parts.push(`**Question**: ${ex.question}`);
      if (ex.critique) parts.push(`**Critique**: ${ex.critique}`);
      if (ex.suggestedAnswer || ex.suggested_answer) {
        parts.push(`**Suggested Answer**: ${ex.suggestedAnswer || ex.suggested_answer}`);
      }
      
      // Fallback if the object didn't have standard fields
      rawText = parts.length > 0 ? parts.join('\n\n') : JSON.stringify(ex);
    } else {
      rawText = String(ex);
    }

    const div = document.createElement('div');
    div.className = 'improved-example';
    let htmlContent = rawText
      .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
      .replace(/\n/g, '<br>')
      .replace(/<br>\s*-\s*/g, '<br>• ')
      .replace(/^-\s*/g, '• ');
    div.innerHTML = htmlContent;
    feedbackExamples.appendChild(div);
  });

  // Practice Areas
  feedbackPractice.innerHTML = '';
  (feedback.recommendedPracticeAreas || []).forEach(area => {
    const span = document.createElement('span');
    span.className = 'practice-tag';
    span.textContent = area;
    feedbackPractice.appendChild(span);
  });
}

startBtn.onclick = startSession;
stopBtn.onclick = endSessionAndGetFeedback;

resetSessionBtn.onclick = () => {
  transcriptHistory = [];
  lastSpeaker = null;
  currentMsgContent = null;
  switchState('idle');
};
