// --- Configuration ---
const MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models';
const MIN_DETECTION_CONFIDENCE = 0.5; 
const FACE_MODEL_OPTS = new faceapi.SsdMobilenetv1Options({ minConfidence: MIN_DETECTION_CONFIDENCE });

// --- State ---
let labeledDescriptors = [];
let batchFiles = [];
let matchedFiles = [];
let currentThreshold = 0.5;
let mode = 'any'; 
let isProcessing = false; // Track if currently running
let stopRequested = false; // Flag to trigger stop

// --- Elements ---
const loader = document.getElementById('sys-loader');
const refInput = document.getElementById('refInput');
const refList = document.getElementById('ref-list');
const refStatus = document.getElementById('ref-status');
const batchInput = document.getElementById('batchInput');
const runBtn = document.getElementById('runBtn'); // Serves as Start AND Stop
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
            faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
            faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
        ]);
        loader.style.display = 'none';
        console.log("AI Models Loaded");
        
        // FIX: Sync mode with HTML state on load (prevents button lockout on refresh)
        const checkedRadio = document.querySelector('input[name="scanMode"]:checked');
        if (checkedRadio) {
            updateMode(checkedRadio.value);
            // Visual sync
            modeOptions.forEach(opt => {
                if(opt.querySelector('input').value === checkedRadio.value) {
                    opt.classList.add('active');
                } else {
                    opt.classList.remove('active');
                }
            });
        }
    } catch (e) {
        alert("Failed to load models. Check internet.");
        console.error(e);
    }
}
loadModels();

// --- Mode Switching Logic ---
modeOptions.forEach(opt => {
    opt.addEventListener('click', () => {
        // Visual toggle
        modeOptions.forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        
        // Logic toggle
        const newVal = opt.querySelector('input').value;
        opt.querySelector('input').checked = true; // Ensure radio is checked
        updateMode(newVal);
    });
});

function updateMode(newMode) {
    mode = newMode;
    
    // Toggle UI sections
    if(mode === 'specific') {
        refSection.style.display = 'block';
        stepLabel.textContent = '3';
    } else {
        refSection.style.display = 'none';
        stepLabel.textContent = '2';
    }
    
    checkReady();
}

// --- Slider Logic ---
threshSlider.addEventListener('input', (e) => {
    currentThreshold = parseFloat(e.target.value);
    threshDisplay.textContent = currentThreshold;
});

// --- Reference Image Handling ---
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
    // If we are currently processing, don't change button state via this function
    if(isProcessing) return;

    let ready = false;
    if (batchFiles.length > 0) {
        if (mode === 'any') {
            ready = true; 
        } else {
            // Need reference for 'specific'
            ready = (labeledDescriptors.length > 0);
        }
    }
    
    if (ready) {
        runBtn.classList.add('active');
        runBtn.innerHTML = `<i class="fa-solid fa-microchip"></i> Start Sorting`;
        runBtn.style.background = "var(--primary)";
    } else {
        runBtn.classList.remove('active');
    }
}

// --- Main AI Processing (Start/Stop Logic) ---
runBtn.addEventListener('click', async () => {
    // STOP LOGIC: If currently running, flag to stop
    if (isProcessing) {
        stopRequested = true;
        runBtn.innerHTML = `<i class="fa-solid fa-hand"></i> Stopping...`;
        runBtn.style.opacity = "0.7";
        return; // Don't start a new loop
    }

    // START LOGIC
    isProcessing = true;
    stopRequested = false;
    
    // Change Button to "Stop"
    runBtn.classList.add('active'); // Keep active so it can be clicked
    runBtn.innerHTML = `<i class="fa-solid fa-stop"></i> Stop Processing`;
    runBtn.style.background = "var(--danger)"; // Turn red

    exportBtn.style.display = 'none';
    
    const progressArea = document.getElementById('progress-area');
    const barFill = document.getElementById('bar-fill');
    const progText = document.getElementById('prog-text');
    const statusDetail = document.getElementById('status-detail');
    
    progressArea.style.display = 'block';
    
    let kept = 0;
    let removed = 0;
    matchedFiles = [];

    // Loop through batch
    for (let i = 0; i < batchFiles.length; i++) {
        // CHECK FOR STOP
        if (stopRequested) {
            statusDetail.textContent = "Processing Aborted by User";
            break;
        }

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
    
    // RESET STATE
    isProcessing = false;
    stopRequested = false;
    progressArea.style.display = 'none';
    
    // Restore Button
    runBtn.innerHTML = `<i class="fa-solid fa-rotate-right"></i> Process New Batch`;
    runBtn.style.background = "var(--primary)";
    checkReady(); // Re-evaluate button state
    
    if(matchedFiles.length > 0) {
        exportBtn.style.display = 'flex';
        exportBtn.classList.add('active');
    }
});

async function analyzeImage(file) {
    const imgUrl = URL.createObjectURL(file);
    let isMatch = false;
    let scoreText = "";
    let scoreColor = "#64748b";

    try {
        const img = await faceapi.bufferToImage(file);
        
        let detections = [];
        
        if (mode === 'specific') {
            detections = await faceapi.detectAllFaces(img, FACE_MODEL_OPTS)
                .withFaceLandmarks()
                .withFaceDescriptors();
        } else {
            detections = await faceapi.detectAllFaces(img, FACE_MODEL_OPTS);
        }

        if (mode === 'any') {
            if (detections.length > 0) {
                isMatch = true;
                scoreText = `Faces: ${detections.length}`;
                scoreColor = "var(--success)";
            } else {
                scoreText = "No Humans";
            }
        } 
        else if (mode === 'specific') {
            let bestDist = 1.0;
            
            for (const detection of detections) {
                for (const ref of labeledDescriptors) {
                    const dist = faceapi.euclideanDistance(ref, detection.descriptor);
                    if (dist < bestDist) bestDist = dist;
                }
            }
            
            if (bestDist <= currentThreshold) {
                isMatch = true;
                scoreColor = "var(--success)";
            }
            
            if (detections.length === 0) scoreText = "No Faces";
            else scoreText = `Diff: ${bestDist.toFixed(3)}`;
        }

        img.remove(); // Cleanup DOM element

    } catch (e) {
        console.error("Error processing", file.name);
        scoreText = "Error";
    }

    return {
        url: imgUrl,
        name: file.name,
        match: isMatch,
        meta: scoreText,
        color: scoreColor
    };
}

function addCardToGallery(data) {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.opacity = data.match ? '1' : '0.4';

    const statusClass = data.match ? 'match' : 'nomatch';
    const statusText = data.match ? 'KEPT' : 'SKIP';

    card.innerHTML = `
        <div class="status-flag ${statusClass}">${statusText}</div>
        <img src="${data.url}" loading="lazy" alt="${data.name}">
        <div class="card-meta">
            <div class="filename" title="${data.name}">${data.name}</div>
            <div class="distance-score">
                <i class="fa-solid fa-circle-info" style="color:${data.color}"></i>
                <span style="color:${data.color}">${data.meta}</span>
            </div>
        </div>
    `;
    gallery.prepend(card);
}

// --- Export Logic ---
exportBtn.addEventListener('click', async () => {
    if(matchedFiles.length === 0) return;
    
    const originalText = exportBtn.innerHTML;
    exportBtn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Zipping...`;
    
    const zip = new JSZip();
    const folderName = mode === 'any' ? "Humans_Detected" : "Target_Found";
    const folder = zip.folder(folderName);

    matchedFiles.forEach(file => {
        folder.file(file.name, file);
    });

    try {
        const content = await zip.generateAsync({type:"blob"});
        saveAs(content, "biosort_export.zip");
        exportBtn.innerHTML = originalText;
    } catch (e) {
        alert("Export failed.");
        exportBtn.innerHTML = originalText;
    }
});
