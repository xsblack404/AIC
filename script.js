// --- Configuration ---
const MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models';
// Only process faces the AI is reasonably sure is a face (prevents trash being detected as face)
const MIN_DETECTION_CONFIDENCE = 0.5; 
const FACE_MODEL_OPTS = new faceapi.SsdMobilenetv1Options({ minConfidence: MIN_DETECTION_CONFIDENCE });

// --- State ---
let labeledDescriptors = [];
let batchFiles = [];
let matchedFiles = [];
let currentThreshold = 0.5;
let mode = 'any'; // 'any' or 'specific'

// --- Elements ---
const loader = document.getElementById('sys-loader');
const refInput = document.getElementById('refInput');
const refList = document.getElementById('ref-list');
const refStatus = document.getElementById('ref-status');
const batchInput = document.getElementById('batchInput');
const runBtn = document.getElementById('runBtn');
const exportBtn = document.getElementById('exportBtn');
const gallery = document.getElementById('gallery');
const threshSlider = document.getElementById('thresholdRange');
const threshDisplay = document.getElementById('thresh-val');
const refSection = document.getElementById('referenceSection');
const stepLabel = document.getElementById('stepLabel');
const modeOptions = document.querySelectorAll('.mode-option');

// --- Initialization ---
async function loadModels() {
    try {
        await Promise.all([
            faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL), // Detection
            faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL), // Alignment
            faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL) // Biometrics
        ]);
        loader.style.display = 'none';
        console.log("AI Models Loaded");
    } catch (e) {
        alert("Failed to load models. Check internet.");
        console.error(e);
    }
}
loadModels();

// --- Mode Switching Logic ---
modeOptions.forEach(opt => {
    opt.addEventListener('click', () => {
        // Toggle visual active state
        modeOptions.forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        
        // Update logic state
        mode = opt.querySelector('input').value;
        
        // Toggle UI sections
        if(mode === 'specific') {
            refSection.style.display = 'block';
            stepLabel.textContent = '3';
        } else {
            refSection.style.display = 'none';
            stepLabel.textContent = '2';
        }
        
        // Check if run button should be active
        checkReady();
    });
});

// --- Slider Logic ---
threshSlider.addEventListener('input', (e) => {
    currentThreshold = parseFloat(e.target.value);
    threshDisplay.textContent = currentThreshold;
});

// --- Reference Image Handling (Specific Mode Only) ---
refInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if(files.length === 0) return;

    refStatus.style.display = 'block';
    refStatus.textContent = "Extracting biometrics...";
    refStatus.style.color = "#64748b";

    for (const file of files) {
        try {
            const img = await faceapi.bufferToImage(file);
            const detection = await faceapi.detectSingleFace(img, FACE_MODEL_OPTS)
                .withFaceLandmarks()
                .withFaceDescriptor();

            if (detection) {
                labeledDescriptors.push(detection.descriptor);
                const thumb = document.createElement('img');
                thumb.src = URL.createObjectURL(file);
                thumb.className = 'ref-thumb';
                refList.appendChild(thumb);
            }
        } catch (err) { console.error(err); }
    }

    if (labeledDescriptors.length > 0) {
        refStatus.textContent = `${labeledDescriptors.length} descriptors loaded.`;
        refStatus.style.color = "var(--success)";
        checkReady();
    } else {
        refStatus.textContent = "No faces found in reference.";
        refStatus.style.color = "var(--danger)";
    }
});

// --- Batch Handling ---
batchInput.addEventListener('change', (e) => {
    batchFiles = Array.from(e.target.files);
    document.getElementById('batch-count').textContent = `${batchFiles.length} files queued`;
    gallery.innerHTML = '';
    exportBtn.style.display = 'none';
    matchedFiles = [];
    checkReady();
});

function checkReady() {
    let ready = false;
    if (batchFiles.length > 0) {
        if (mode === 'any') {
            ready = true; // No reference needed for 'any'
        } else {
            // Need reference for 'specific'
            ready = (labeledDescriptors.length > 0);
        }
    }
    
    if (ready) runBtn.classList.add('active');
    else runBtn.classList.remove('active');
}

// --- Main AI Processing ---
runBtn.addEventListener('click', async () => {
    runBtn.classList.remove('active');
    exportBtn.style.display = 'none';
    
    const progressArea = document.getElementById('progress-area');
    const barFill = document.getElementById('bar-fill');
    const progText = document.getElementById('prog-text');
    const statusDetail = document.getElementById('status-detail');
    
    progressArea.style.display = 'block';
    
    let kept = 0;
    let removed = 0;
    matchedFiles = [];

    for (let i = 0; i < batchFiles.length; i++) {
        const file = batchFiles[i];
        
        // Progress UI
        const pct = Math.round(((i + 1) / batchFiles.length) * 100);
        barFill.style.width = `${pct}%`;
        progText.textContent = `${i+1}/${batchFiles.length}`;
        statusDetail.textContent = `Analyzing: ${file.name}`;

        // Analyze
        const result = await analyzeImage(file);
        
        if (result.match) {
            kept++;
            matchedFiles.push(file);
        } else {
            removed++;
        }

        document.getElementById('count-kept').textContent = kept;
        document.getElementById('count-removed').textContent = removed;

        addCardToGallery(result);

        // UI Thread breathing room
        await new Promise(r => setTimeout(r, 20)); 
    }
    
    setTimeout(() => {
        progressArea.style.display = 'none';
        runBtn.classList.add('active');
        runBtn.innerHTML = `<i class="fa-solid fa-rotate-right"></i> Process New Batch`;
        
        if(matchedFiles.length > 0) {
            exportBtn.style.display = 'flex';
            exportBtn.classList.add('active');
        }
    }, 1000);
});

async function analyzeImage(file) {
    const imgUrl = URL.createObjectURL(file);
    let isMatch = false;
    let scoreText = "";
    let scoreColor
