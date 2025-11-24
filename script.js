// --- Advanced Configuration ---
const MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models';
const MIN_DETECTION_CONFIDENCE = 0.5;
const FACE_MODEL_OPTS = new faceapi.SsdMobilenetv1Options({ minConfidence: MIN_DETECTION_CONFIDENCE });

// --- State ---
let labeledDescriptors = [];
let batchFiles = [];
let matchedFiles = []; // Track positive matches for ZIP
let currentThreshold = 0.5;

// --- Elements ---
const loader = document.getElementById('sys-loader');
const refInput = document.getElementById('refInput');
const refList = document.getElementById('ref-list');
const refStatus = document.getElementById('ref-status');
const batchInput = document.getElementById('batchInput');
const runBtn = document.getElementById('runBtn');
const exportBtn = document.getElementById('exportBtn'); // NEW
const gallery = document.getElementById('gallery');
const threshSlider = document.getElementById('thresholdRange');
const threshDisplay = document.getElementById('thresh-val');
const memoryStat = document.getElementById('memory-stat');

// --- Initialization ---
async function loadModels() {
    try {
        await Promise.all([
            faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
            faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
        ]);
        loader.style.display = 'none';
        console.log("Enterprise AI Engine Initialized");
    } catch (e) {
        alert("Failed to load AI models. Please check your internet connection.");
        console.error(e);
    }
}
loadModels();

// --- Slider Logic ---
threshSlider.addEventListener('input', (e) => {
    currentThreshold = parseFloat(e.target.value);
    threshDisplay.textContent = currentThreshold;
});

// --- Professional Reference Handling (Multi-Shot) ---
refInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if(files.length === 0) return;

    refStatus.style.display = 'block';
    refStatus.textContent = "Analyzing training data...";
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
            console.error(err);
        }
    }

    if (labeledDescriptors.length > 0) {
        refStatus.textContent = `${labeledDescriptors.length} Biometric Vectors Locked. Ready.`;
        refStatus.style.color = "var(--success)";
        checkReady();
    } else {
        refStatus.textContent = "Training Failed. Upload clear photos.";
        refStatus.style.color = "var(--danger)";
    }
});

// --- Batch Handling ---
batchInput.addEventListener('change', (e) => {
    batchFiles = Array.from(e.target.files);
    document.getElementById('batch-count').textContent = `${batchFiles.length} files queued`;
    gallery.innerHTML = '';
    exportBtn.style.display = 'none'; // Hide export on new batch
    matchedFiles = [];
    checkReady();
});

function checkReady() {
    if (labeledDescriptors.length > 0 && batchFiles.length > 0) {
        runBtn.classList.add('active');
    } else {
        runBtn.classList.remove('active');
    }
}

// --- Robust Processing Engine ---
runBtn.addEventListener('click', async () => {
    runBtn.classList.remove('active');
    exportBtn.style.display = 'none'; // Hide during process
    
    const progressArea = document.getElementById('progress-area');
    const barFill = document.getElementById('bar-fill');
    const progText = document.getElementById('prog-text');
    
    progressArea.style.display = 'block';
    
    let kept = 0;
    let removed = 0;
    matchedFiles = []; // Reset previous matches

    for (let i = 0; i < batchFiles.length; i++) {
        const file = batchFiles[i];
        
        // UI Update
        const pct = Math.round(((i + 1) / batchFiles.length) * 100);
        barFill.style.width = `${pct}%`;
        progText.textContent = `${i+1}/${batchFiles.length}`;

        const result = await analyzeSecure(file);
        
        if (result.match) {
            kept++;
            matchedFiles.push(file); // Store matched file for ZIP
        } else {
            removed++;
        }

        // Update Stats
        document.getElementById('count-kept').textContent = kept;
        document.getElementById('count-removed').textContent = removed;
        
        if(window.tf) {
             memoryStat.textContent = `Active Tensors: ${tf.memory().numTensors}`;
        }

        addCardToGallery(result);

        // Memory protection pause
        await new Promise(r => setTimeout(r, 50)); 
    }
    
    setTimeout(() => {
        progressArea.style.display = 'none';
        runBtn.classList.add('active');
        runBtn.innerHTML = `<i class="fa-solid fa-rotate-right"></i> Process New Batch`;
        
        // Show Export Button if we found matches
        if(matchedFiles.length > 0) {
            exportBtn.style.display = 'flex';
            exportBtn.classList.add('active');
        }
    }, 1500);
});

async function analyzeSecure(file) {
    const imgUrl = URL.createObjectURL(file);
    let bestDistance = 1.0; 
    let isMatch = false;

    try {
        const img = await faceapi.bufferToImage(file);
        const detections = await faceapi.detectAllFaces(img, FACE_MODEL_OPTS)
            .withFaceLandmarks()
            .withFaceDescriptors();

        for (const detection of detections) {
            for (const refDescriptor of labeledDescriptors) {
                const dist = faceapi.euclideanDistance(refDescriptor, detection.descriptor);
                if (dist < bestDistance) {
                    bestDistance = dist;
                }
            }
        }

        if (bestDistance <= currentThreshold) {
            isMatch = true;
        }

        img.remove();

    } catch (e) {
        console.error("Analysis Error:", file.name);
    }

    return {
        url: imgUrl,
        name: file.name,
        match: isMatch,
        score: bestDistance
    };
}

function addCardToGallery(data) {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.opacity = data.match ? '1' : '0.4';

    const statusClass = data.match ? 'match' : 'nomatch';
    const statusText = data.match ? 'MATCH' : 'SKIP';
    
    let confidence = 0;
    if(data.score < 1.0) {
        confidence = Math.round((1 - data.score) * 100);
    }

    const scoreColor = data.match ? 'var(--success)' : '#64748b';

    card.innerHTML = `
        <div class="status-flag ${statusClass}">${statusText}</div>
        <img src="${data.url}" loading="lazy" alt="${data.name}">
        <div class="card-meta">
            <div class="filename" title="${data.name}">${data.name}</div>
            <div class="distance-score">
                <i class="fa-solid fa-chart-bar" style="color:${scoreColor}"></i>
                <span style="color:${scoreColor}">Match Score: ${confidence}%</span>
            </div>
            <div style="font-size:0.65rem; color:#cbd5e1; margin-top:2px;">Dist: ${data.score.toFixed(3)}</div>
        </div>
    `;
    gallery.prepend(card);
}

// --- ZIP Export Logic ---
exportBtn.addEventListener('click', async () => {
    if(matchedFiles.length === 0) return;

    // Change button state
    const originalText = exportBtn.innerHTML;
    exportBtn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Compressing...`;
    exportBtn.classList.remove('active');

    const zip = new JSZip();
    const folder = zip.folder("Matched_Photos");

    // Add files to zip
    matchedFiles.forEach(file => {
        folder.file(file.name, file);
    });

    try {
        const content = await zip.generateAsync({type:"blob"});
        saveAs(content, "biosort_matched_photos.zip");
        
        // Reset button
        exportBtn.innerHTML = `<i class="fa-solid fa-check"></i> Downloaded!`;
        setTimeout(() => {
            exportBtn.innerHTML = originalText;
            exportBtn.classList.add('active');
        }, 3000);
    } catch (e) {
        alert("Error generating zip file.");
        console.error(e);
        exportBtn.innerHTML = originalText;
        exportBtn.classList.add('active');
    }
});
