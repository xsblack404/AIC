// --- Configuration ---
const TIMEOUT_MS = 10000; // 10 seconds max per image

// --- State ---
let model = null;
let batchFiles = [];
let matchedFiles = [];
let isProcessing = false;
let stopRequested = false;

// --- Elements ---
const loader = document.getElementById('sys-loader');
const batchInput = document.getElementById('batchInput');
const runBtn = document.getElementById('runBtn');
const exportBtn = document.getElementById('exportBtn');
const gallery = document.getElementById('gallery');
const targetSelect = document.getElementById('targetSelect');
const threshSlider = document.getElementById('thresholdRange');
const threshDisplay = document.getElementById('thresh-val');

// --- Initialization ---
async function loadAI() {
    try {
        // Load COCO-SSD (Object Detection Model)
        // 'lite_mobilenet_v2' is faster, 'mobilenet_v2' is more accurate.
        // We use the default which balances both.
        model = await cocoSsd.load();
        
        loader.style.display = 'none';
        console.log("COCO-SSD Model Loaded");
    } catch (e) {
        alert("Failed to load AI Model. Check internet connection.");
        console.error(e);
    }
}
loadAI();

// --- Event Listeners ---
threshSlider.addEventListener('input', (e) => {
    threshDisplay.textContent = e.target.value;
});

batchInput.addEventListener('change', (e) => {
    batchFiles = Array.from(e.target.files);
    document.getElementById('batch-count').textContent = `${batchFiles.length} files queued`;
    gallery.innerHTML = '';
    exportBtn.style.display = 'none';
    matchedFiles = [];
    checkReady();
});

function checkReady() {
    if (isProcessing) return;
    
    if (batchFiles.length > 0 && model) {
        runBtn.classList.add('active');
        runBtn.innerHTML = `<i class="fa-solid fa-play"></i> Start Detection`;
        runBtn.style.background = "var(--primary)";
    } else {
        runBtn.classList.remove('active');
    }
}

// --- Timeout Helper ---
const timeoutPromise = (ms, promise) => {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error("Timeout"));
        }, ms);
        promise
            .then(value => { clearTimeout(timer); resolve(value); })
            .catch(reason => { clearTimeout(timer); reject(reason); });
    });
};

// --- Main Processing Logic ---
runBtn.addEventListener('click', async () => {
    // Stop Request
    if (isProcessing) {
        stopRequested = true;
        runBtn.innerHTML = `<i class="fa-solid fa-hand"></i> Stopping...`;
        runBtn.style.opacity = "0.7";
        return;
    }

    // Start
    isProcessing = true;
    stopRequested = false;
    runBtn.classList.add('active');
    runBtn.innerHTML = `<i class="fa-solid fa-stop"></i> Stop`;
    runBtn.style.background = "var(--danger)";
    exportBtn.style.display = 'none';

    const progressArea = document.getElementById('progress-area');
    const barFill = document.getElementById('bar-fill');
    const progText = document.getElementById('prog-text');
    const statusDetail = document.getElementById('status-detail');
    const targetClass = targetSelect.value;
    const minConfidence = parseFloat(threshSlider.value);

    progressArea.style.display = 'block';
    
    let kept = 0;
    let removed = 0;
    matchedFiles = [];

    // Loop
    for (let i = 0; i < batchFiles.length; i++) {
        if (stopRequested) {
            statusDetail.textContent = "Processing Aborted.";
            break;
        }

        const file = batchFiles[i];
        
        // Progress UI
        const pct = Math.round(((i + 1) / batchFiles.length) * 100);
        barFill.style.width = `${pct}%`;
        progText.textContent = `${i+1}/${batchFiles.length}`;
        statusDetail.textContent = `Scanning: ${file.name}`;

        try {
            // Process Image
            const result = await timeoutPromise(TIMEOUT_MS, detectSubject(file, targetClass, minConfidence));
            
            if (result.found) {
                kept++;
                matchedFiles.push(file);
            } else {
                removed++;
            }

            renderCard(result);

        } catch (error) {
            console.error(error);
            removed++;
            renderCard({
                url: URL.createObjectURL(file),
                name: file.name,
                found: false,
                meta: "Error",
                color: "var(--danger)"
            });
        }

        document.getElementById('count-kept').textContent = kept;
        document.getElementById('count-removed').textContent = removed;

        // Breathe
        await new Promise(r => setTimeout(r, 20));
    }

    // Finished
    isProcessing = false;
    stopRequested = false;
    
    setTimeout(() => {
        progressArea.style.display = 'none';
        checkReady();
        if (matchedFiles.length > 0) {
            exportBtn.style.display = 'flex';
            exportBtn.classList.add('active');
        }
    }, 1000);
});

// --- Detection Engine (COCO-SSD) ---
async function detectSubject(file, targetClass, minConfidence) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        
        img.src = url;
        img.onload = async () => {
            try {
                // Run COCO-SSD
                const predictions = await model.detect(img);
                
                // Logic: Find target class with high enough score
                const match = predictions.find(p => p.class === targetClass && p.score >= minConfidence);
                
                let metaText = "No Match";
                let metaColor = "#64748b";
                let found = false;

                if (match) {
                    found = true;
                    metaText = `${targetClass.toUpperCase()} (${Math.round(match.score * 100)}%)`;
                    metaColor = "var(--success)";
                } else if (predictions.length > 0) {
                    // Show what was found instead
                    metaText = `Found: ${predictions[0].class}`;
                }

                resolve({
                    url: url,
                    name: file.name,
                    found: found,
                    meta: metaText,
                    color: metaColor
                });

            } catch (e) {
                reject(e);
            }
        };
        img.onerror = () => reject(new Error("Image Load Error"));
    });
}

// --- UI Rendering ---
function renderCard(data) {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.opacity = data.found ? '1' : '0.5';

    const statusClass = data.found ? 'match' : 'nomatch';
    const statusText = data.found ? 'KEEP' : 'DROP';

    card.innerHTML = `
        <div class="status-flag ${statusClass}">${statusText}</div>
        <img src="${data.url}" loading="lazy">
        <div class="card-meta">
            <div class="filename" title="${data.name}">${data.name}</div>
            <div class="match-info">
                <i class="fa-solid fa-tag" style="color:${data.color}"></i>
                <span style="color:${data.color}">${data.meta}</span>
            </div>
        </div>
    `;
    gallery.prepend(card);
}

// --- Export Logic ---
exportBtn.addEventListener('click', async () => {
    const originalText = exportBtn.innerHTML;
    exportBtn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Compressing...`;
    
    const zip = new JSZip();
    const folder = zip.folder("Sorted_Images");

    matchedFiles.forEach(file => {
        folder.file(file.name, file);
    });

    try {
        const content = await zip.generateAsync({type:"blob"});
        saveAs(content, "sorted_images.zip");
        exportBtn.innerHTML = originalText;
    } catch (e) {
        alert("Zip creation failed");
        exportBtn.innerHTML = originalText;
    }
});
