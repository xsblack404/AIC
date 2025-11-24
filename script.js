// --- Configuration ---
// Using public model weights
const MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models';
// Confidence threshold to consider something a face (0.5 = 50% sure)
const MIN_DETECTION_CONFIDENCE = 0.5; 
const FACE_MODEL_OPTS = new faceapi.SsdMobilenetv1Options({ minConfidence: MIN_DETECTION_CONFIDENCE });
const TIMEOUT_MS = 10000; // 10 seconds max per image before skipping

// --- State ---
let labeledDescriptors = [];
let batchFiles = [];
let matchedFiles = [];
let currentThreshold = 0.5;
let mode = 'any'; 
let isProcessing = false;
let stopRequested = false;

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
        console.log("Loading Neural Networks...");
        await Promise.all([
            faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
            faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
        ]);
        
        loader.style.display = 'none';
        console.log("Models Loaded Successfully");

        // Sync UI with initial state
        const checkedRadio = document.querySelector('input[name="scanMode"]:checked');
        if (checkedRadio) {
            mode = checkedRadio.value;
            syncModeUI(mode);
        }
        
        // Re-check readiness in case files were selected before models loaded
        checkReady();

    } catch (e) {
        alert("Error loading AI models. Please refresh the page.");
        console.error(e);
    }
}
loadModels();

// --- Mode Logic ---
modeOptions.forEach(opt => {
    opt.addEventListener('click', () => {
        const radio = opt.querySelector('input');
        radio.checked = true;
        mode = radio.value;
        syncModeUI(mode);
    });
});

function syncModeUI(currentMode) {
    // Update visual buttons
    modeOptions.forEach(o => {
        const val = o.querySelector('input').value;
        if(val === currentMode) o.classList.add('active');
        else o.classList.remove('active');
    });

    // Toggle sections
    if(currentMode === 'specific') {
        refSection.style.display = 'block';
        stepLabel.textContent = '3';
    } else {
        refSection.style.display = 'none';
        stepLabel.textContent = '2';
    }
    
    checkReady();
}

// --- Threshold Slider ---
threshSlider.addEventListener('input', (e) => {
    currentThreshold = parseFloat(e.target.value);
    threshDisplay.textContent = currentThreshold;
});

// --- Reference Upload (Specific Mode) ---
refInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if(files.length === 0) return;

    refStatus.style.display = 'block';
    refStatus.textContent = "Processing biometrics...";
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
        } catch (err) {
            console.warn("Skipped a reference file (not a face or error).");
        }
    }

    if (labeledDescriptors.length > 0) {
        refStatus.textContent = `${labeledDescriptors.length} Biometric IDs Locked.`;
        refStatus.style.color = "var(--success)";
    } else {
        refStatus.textContent = "No valid faces found.";
        refStatus.style.color = "var(--danger)";
    }
    checkReady();
});

// --- Batch Input ---
batchInput.addEventListener('change', (e) => {
    batchFiles = Array.from(e.target.files);
    document.getElementById('batch-count').textContent = `${batchFiles.length} files queued`;
    gallery.innerHTML = '';
    exportBtn.style.display = 'none';
    matchedFiles = [];
    checkReady();
});

function checkReady() {
    // Do not change button state if currently running
    if(isProcessing) return;

    let ready = false;
    
    if (batchFiles.length > 0) {
        if (mode === 'any') {
            ready = true;
        } else {
            // Specific mode requires at least one reference face
            ready = (labeledDescriptors.length > 0);
        }
    }
    
    if (ready) {
        runBtn.classList.add('active');
        runBtn.style.background = "var(--primary)";
        runBtn.innerHTML = `<i class="fa-solid fa-microchip"></i> Start Sorting`;
    } else {
        runBtn.classList.remove('active');
        runBtn.style.background = "var(--primary)";
    }
}

// --- Helper: Timeout Wrapper ---
const timeoutPromise = (ms, promise) => {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error("Analysis Timeout"));
        }, ms);
        
        promise
            .then(value => {
                clearTimeout(timer);
                resolve(value);
            })
            .catch(reason => {
                clearTimeout(timer);
                reject(reason);
            });
    });
};

// --- Main Process Loop ---
runBtn.addEventListener('click', async () => {
    // HANDLE STOP REQUEST
    if (isProcessing) {
        stopRequested = true;
        runBtn.innerHTML = `<i class="fa-solid fa-hand"></i> Stopping...`;
        runBtn.style.opacity = "0.7";
        return;
    }

    // START PROCESSING
    isProcessing = true;
    stopRequested = false;
    
    // UI Updates
    runBtn.innerHTML = `<i class="fa-solid fa-stop"></i> Stop Processing`;
    runBtn.style.background = "var(--danger)";
    exportBtn.style.display = 'none';
    
    const progressArea = document.getElementById('progress-area');
    const barFill = document.getElementById('bar-fill');
    const progText = document.getElementById('prog-text');
    const statusDetail = document.getElementById('status-detail');
    
    progressArea.style.display = 'block';
    
    let kept = 0;
    let removed = 0;
    matchedFiles = [];

    // BATCH LOOP
    for (let i = 0; i < batchFiles.length; i++) {
        // Stop Check
        if (stopRequested) {
            statusDetail.textContent = "Processing Cancelled.";
            break;
        }

        const file = batchFiles[i];
        
        // Progress Bar
        const pct = Math.round(((i + 1) / batchFiles.length) * 100);
        barFill.style.width = `${pct}%`;
        progText.textContent = `${i+1}/${batchFiles.length}`;
        statusDetail.textContent = `Analyzing: ${file.name}`;

        // ANALYZE with Safety Wrappers
        try {
            // We wrap the analysis in a specific try/catch so one bad file doesn't crash the loop
            const result = await timeoutPromise(TIMEOUT_MS, analyzeImage(file));
            
            if (result.match) {
                kept++;
                matchedFiles.push(file);
            } else {
                removed++;
            }
            
            addCardToGallery(result);

        } catch (err) {
            console.error(`Failed to process ${file.name}:`, err);
            // Add a "Error" card so user knows it failed
            addCardToGallery({
                url: URL.createObjectURL(file), // might fail if file corrupt, but worth a try
                name: file.name,
                match: false,
                meta: "Error/Timeout",
                color: "var(--danger)"
            });
            removed++;
        }

        // Update Stats
        document.getElementById('count-kept').textContent = kept;
        document.getElementById('count-removed').textContent = removed;

        // VITAL: Pause to let UI render and Garbage Collector run
        await new Promise(r => setTimeout(r, 50));
    }
    
    // FINISHED
    isProcessing = false;
    stopRequested = false;
    
    setTimeout(() => {
        progressArea.style.display = 'none';
        checkReady(); // Reset button to start state
        
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
    let scoreColor = "#64748b";
    let img = null;

    try {
        // 1. Load Image
        img = await faceapi.bufferToImage(file);
        
        // 2. Run AI
        let detections = [];
        
        if (mode === 'specific') {
            detections = await faceapi.detectAllFaces(img, FACE_MODEL_OPTS)
                .withFaceLandmarks()
                .withFaceDescriptors();
        } else {
            // Faster detection for 'any'
            detections = await faceapi.detectAllFaces(img, FACE_MODEL_OPTS);
        }

        // 3. Logic
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
            
            // Compare every face detected against every reference face
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

    } catch (error) {
        throw error; // Rethrow to be caught by the main loop
    } finally {
        // ALWAYS clean up memory, even if error occurred
        if(img) img.remove();
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
