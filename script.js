// --- Configuration ---
// Using public model weights
const MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models';
// Threshold: Lower = stricter match, Higher = looser match. 0.6 is standard.
const MATCH_THRESHOLD = 0.6; 

// --- State ---
let referenceDescriptor = null;
let batchFiles = [];

// --- Elements ---
const loader = document.getElementById('sys-loader');
const refInput = document.getElementById('refInput');
const batchInput = document.getElementById('batchInput');
const runBtn = document.getElementById('runBtn');
const gallery = document.getElementById('gallery');
const refPreview = document.getElementById('refPreview');
const refBox = document.getElementById('refBox');

// --- Initialization ---
async function loadModels() {
    try {
        // Load detection, landmark (alignment), and recognition (embedding) models
        await Promise.all([
            faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
            faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
        ]);
        loader.style.display = 'none';
        console.log("AI Models Loaded");
    } catch (e) {
        alert("Error loading models. Check internet connection.");
        console.error(e);
    }
}

// Start loading
loadModels();

// --- Reference Image Handling ---
refInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if(!file) return;

    // UI Updates
    const imgUrl = URL.createObjectURL(file);
    document.getElementById('refImgElement').src = imgUrl;
    refBox.style.display = 'none';
    refPreview.style.display = 'block';
    
    // Compute Descriptor
    const statusMsg = document.getElementById('ref-status');
    statusMsg.style.display = 'block';
    statusMsg.style.color = '#64748b';
    statusMsg.textContent = "Computing face biometrics...";

    try {
        // Convert file to HTMLImageElement for FaceAPI
        const img = await faceapi.bufferToImage(file);
        
        // Detect single face
        const detection = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();
        
        if (!detection) {
            statusMsg.style.color = 'var(--danger)';
            statusMsg.textContent = "No face detected in reference photo!";
            referenceDescriptor = null;
            checkReady();
            return;
        }

        referenceDescriptor = detection.descriptor;
        statusMsg.style.color = 'var(--success)';
        statusMsg.textContent = "Face biometric signature locked.";
        checkReady();

    } catch (err) {
        console.error(err);
        statusMsg.textContent = "Error processing image.";
    }
});

// --- Batch Input Handling ---
batchInput.addEventListener('change', (e) => {
    batchFiles = Array.from(e.target.files);
    document.getElementById('batch-count').textContent = `${batchFiles.length} images queued`;
    gallery.innerHTML = ''; // Clear previous results
    checkReady();
});

function checkReady() {
    if (referenceDescriptor && batchFiles.length > 0) {
        runBtn.classList.add('active');
    } else {
        runBtn.classList.remove('active');
    }
}

// --- Core Processing ---
runBtn.addEventListener('click', async () => {
    runBtn.classList.remove('active');
    const progressArea = document.getElementById('progress-area');
    const barFill = document.getElementById('bar-fill');
    const progText = document.getElementById('prog-text');
    
    progressArea.style.display = 'block';
    
    let kept = 0;
    let removed = 0;

    // Process sequentially
    for (let i = 0; i < batchFiles.length; i++) {
        const file = batchFiles[i];
        
        // Update Progress UI
        const pct = Math.round(((i + 1) / batchFiles.length) * 100);
        barFill.style.width = `${pct}%`;
        progText.textContent = `${i+1}/${batchFiles.length}`;

        // Process AI Logic
        const result = await processImage(file);
        
        if (result.match) kept++;
        else removed++;

        // Update Stats UI
        document.getElementById('count-kept').textContent = kept;
        document.getElementById('count-removed').textContent = removed;

        // Render Card
        addCardToGallery(result);
    }
    
    // Finish
    setTimeout(() => {
        progressArea.style.display = 'none';
        runBtn.classList.add('active');
        runBtn.innerHTML = `<i class="fa-solid fa-rotate-right"></i> Process New Batch`;
    }, 1500);
});

async function processImage(file) {
    const imgUrl = URL.createObjectURL(file);
    let isMatch = false;
    let distance = 1.0; // Default high distance (no match)

    try {
        const img = await faceapi.bufferToImage(file);
        
        // Detect ALL faces in the batch image
        const detections = await faceapi.detectAllFaces(img)
            .withFaceLandmarks()
            .withFaceDescriptors();

        // Compare every face found
        for (const detection of detections) {
            const dist = faceapi.euclideanDistance(referenceDescriptor, detection.descriptor);
            
            // If match found, stop checking other faces in this photo
            if (dist < MATCH_THRESHOLD) {
                isMatch = true;
                distance = dist;
                break; 
            }
        }
    } catch (e) {
        console.error("Error scanning file", file.name);
    }

    return {
        url: imgUrl,
        name: file.name,
        match: isMatch,
        score: distance
    };
}

function addCardToGallery(data) {
    const card = document.createElement('div');
    card.className = 'card';
    // Dim images that don't match
    card.style.opacity = data.match ? '1' : '0.5';

    const statusClass = data.match ? 'match' : 'nomatch';
    const statusText = data.match ? 'MATCH' : 'IGNORE';
    
    // Format score
    const confidence = data.match 
        ? `<span style="color:var(--success)">Match Confidence: ${Math.round((1 - data.score) * 100)}%</span>` 
        : `Not detected`;

    card.innerHTML = `
        <div class="status-flag ${statusClass}">${statusText}</div>
        <img src="${data.url}" loading="lazy" alt="${data.name}">
        <div class="card-meta">
            <div class="filename" title="${data.name}">${data.name}</div>
            <div class="distance-score">${confidence}</div>
        </div>
    `;
    gallery.prepend(card);
}
