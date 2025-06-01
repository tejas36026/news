(function() {
  // Variables to store media elements and state
  let combinedVideoBlob = null;
  let isProcessing = false;
  let mediaRecorderForShare;
  let shareAbortController = new AbortController();

  function resetShareState() {
    combinedVideoBlob = null; // Critical: ensure new media is generated
    abortMediaProcessing(); // Stop any ongoing processing and clear resources

    const shareModal = document.getElementById('share-modal');
    const sharePreviewVideo = document.getElementById('share-video-preview');
    const sharePreviewContainer = document.getElementById('share-preview');
    const shareStatus = document.getElementById('share-status');
    const shareProgressContainer = document.getElementById('share-progress-container');

    // Reset UI elements
    if (sharePreviewVideo) {
        sharePreviewVideo.src = '';
        sharePreviewVideo.removeAttribute('src'); // Ensure source is fully cleared
        sharePreviewVideo.load(); // Request reload empty state
    }
    if (sharePreviewContainer) sharePreviewContainer.classList.remove('active');

    if (shareStatus) {
        shareStatus.textContent = '';
        shareStatus.className = 'share-status'; // Reset classes
    }
    if (shareProgressContainer) {
        shareProgressContainer.classList.remove('active');
        const shareProgressItems = document.getElementById('share-progress-items');
        if (shareProgressItems) shareProgressItems.innerHTML = '';
    }

     // Reset the duration input if it exists
    const durationInput = document.getElementById('video-duration');
    if (durationInput) durationInput.value = "60"; // Reset to default


    isProcessing = false; // Reset processing flag
    console.log("Share state reset.");
  }

  // Function to abort media processing if modal is closed or reset
  function abortMediaProcessing() {
    shareAbortController.abort(); // Signal any ongoing fetch/async ops to stop
    shareAbortController = new AbortController(); // Create a new controller for future ops

    if (mediaRecorderForShare && mediaRecorderForShare.state === 'recording') {
        try {
            console.log("Aborting media processing: Stopping MediaRecorder.");
            mediaRecorderForShare.stop(); // This should trigger onstop eventually
        } catch (e) {
            console.warn("Error stopping mediaRecorderForShare during abort:", e);
        }
    }
     mediaRecorderForShare = null; // Clear reference


    // Clean up tracks if canvasStream was created and stored (needs access or modification)
    // This depends on how `prepareCombinedMedia` manages its resources.
    // Ideally, `prepareCombinedMedia` should use the abort signal.


    // Release AudioContext if it was created and stored globally/accessibly
    // if (typeof shareAudioCtx !== 'undefined' && shareAudioCtx && shareAudioCtx.state !== 'closed') {
    //    shareAudioCtx.close().catch(e => console.warn("Error closing share AudioContext:", e));
    //    shareAudioCtx = null;
    // }

    isProcessing = false;
    combinedVideoBlob = null; // Clear any partially created blob

    // Clear preview explicitly
    const sharePreviewVideo = document.getElementById('share-video-preview');
    const sharePreviewContainer = document.getElementById('share-preview');
    if(sharePreviewVideo) {
        sharePreviewVideo.pause();
        sharePreviewVideo.removeAttribute('src');
        sharePreviewVideo.load();
    }
    if(sharePreviewContainer) sharePreviewContainer.classList.remove('active');

    const shareStatus = document.getElementById('share-status');
    if(shareStatus && shareStatus.textContent.includes('Preparing') || shareStatus.textContent.includes('Processing')) {
        shareStatus.textContent = 'Media preparation cancelled.';
        shareStatus.className = 'share-status info';
    }
    console.log("Media processing aborted.");
}

  // Create simplified UI
  function createShareUI() {
    // Check if already created
    if (document.getElementById('share-btn') && document.getElementById('share-modal')) {
        console.log("Share UI already exists.");
        return;
    }

    // Create share button
    const shareBtn = document.createElement('button');
    shareBtn.id = 'share-btn';
    shareBtn.className = 'share-button control-button'; // Add common class if needed
    shareBtn.setAttribute('aria-label', 'Share content');
    shareBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-share-2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/></svg>'; // Lucide share icon

    // Add the share button to the top-right controls
    const topRightControls = document.querySelector('.top-right-controls');
    if (!topRightControls) {
        console.error("Top right controls container not found. Cannot add share button.");
        return; // Stop if container is missing
    }
    topRightControls.appendChild(shareBtn);
    // Ensure Lucide icons are rendered if added dynamically
    if (typeof lucide !== 'undefined') {
       lucide.createIcons({
           nodes: [shareBtn],      
           attrs: {'stroke-width': 2}, // Example customization
           nameAttr: 'data-lucide'
       });
    }


    // Create share modal
    const shareModal = document.createElement('div');
    shareModal.id = 'share-modal';
    shareModal.className = 'share-modal'; // Initially hidden via CSS
    shareModal.setAttribute('role', 'dialog');
    shareModal.setAttribute('aria-modal', 'true');
    shareModal.setAttribute('aria-labelledby', 'share-modal-title');
    shareModal.innerHTML = `
      <div class="share-modal-content">
        <button class="share-modal-close" id="share-modal-close" aria-label="Close share modal">
          ×
        </button>
        <h3 id="share-modal-title">Share Media</h3>

        <!-- Duration Control - Initially hidden, shown if needed -->
        <div class="duration-control" style="display:none; margin: 15px 0; padding: 10px; background: #f8f8f8; border-radius: 5px;">
          <label for="video-duration">Video Duration (seconds):</label>
          <input type="number" id="video-duration" min="5" max="300" value="60" style="width: 100%; margin-top: 5px; padding: 5px;">
          <div class="platform-duration-info" style="margin-top: 5px; font-size: 12px; color: #666;">
            <p><small>Set desired video length (some platforms have limits).</small></p>
          </div>
        </div>

        <!-- Preview Area -->
         <div class="share-preview" id="share-preview" style="margin-bottom: 15px;">
          <h4>Preview</h4>
          <video id="share-video-preview" controls style="width: 100%; max-height: 250px; background-color: #eee;"></video>
          <p style="font-size: 11px; text-align: center; margin-top: 4px;">Preview will appear after processing.</p>
        </div>


        <!-- Status Messages -->
        <div class="share-status" id="share-status" style="margin: 10px 0; padding: 10px; border-radius: 5px; min-height: 20px;"></div>

        <!-- Download Button -->
        <div class="download-section" style="margin-bottom: 15px;">
          <button class="download-btn" id="download-combined" style="display: flex; align-items: center; justify-content: center; width: 100%; padding: 10px; margin: 5px 0; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; gap: 8px;" disabled>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            Download Video (.webm)
          </button>
        </div>

        <!-- Platform Sharing -->
        <div class="share-platforms">
          <h4>Share Directly (if supported)</h4>
          <div class="share-platforms-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px;">
            <!-- Platforms will be handled by shareToSocialMedia logic -->
             <button class="share-platform-btn all-platforms-btn" data-platform="all" style="display: flex; align-items: center; justify-content: center; width: 100%; padding: 10px; margin: 5px 0; background: #6c757d; color: white; border: none; border-radius: 5px; cursor: pointer; gap: 8px; grid-column: 1 / -1;" disabled>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z"/></svg>
              Share (via System)
            </button>
            <!-- Individual buttons can be added here if needed, but system share is preferred -->
          </div>
          <p style="font-size: 11px; text-align: center; margin-top: 8px;">Uses your device's share menu. Video file will be included if possible.</p>
        </div>


        <!-- Progress for multi-platform (if implemented) -->
        <div class="share-progress-container" id="share-progress-container" style="margin: 15px 0; display: none;">
          <h4>Sharing Progress</h4>
          <div class="share-progress-items" id="share-progress-items" style="border: 1px solid #e1e1e1; border-radius: 5px; padding: 10px;"></div>
        </div>

      </div>
    `;

    // Add share modal to the document body
    document.body.appendChild(shareModal);

    // Basic styles (consider moving to CSS file)
    const shareStyles = document.createElement('style');
    shareStyles.id = "share-modal-styles";
    shareStyles.textContent = `
      .share-button { /* Style for the button in controls */
        /* background: #4a90e2; */ /* Use control button styles */
        /* color: white; */
        border: none;
        border-radius: 5px;
        padding: 8px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px; /* Match other control buttons */
        height: 40px;
        background-color: rgba(0,0,0,0.5);
        color: white;
      }
       .share-button:hover {
         background-color: rgba(0,0,0,0.7);
       }

      .share-modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7); /* Darker overlay */
        display: none; /* Hidden by default */
        justify-content: center;
        align-items: center;
        z-index: 1050; /* Ensure it's above other elements */
        backdrop-filter: blur(5px); /* Optional blur effect */
      }

      .share-modal.active {
        display: flex; /* Show when active */
      }

      .share-modal-content {
        background: #ffffff; /* White background */
        color: #333; /* Dark text */
        border-radius: 8px;
        width: 90%;
        max-width: 500px;
        padding: 25px;
        position: relative;
        max-height: 90vh;
        overflow-y: auto;
        box-shadow: 0 5px 15px rgba(0,0,0,0.2);
      }

      .share-modal-close {
        position: absolute;
        top: 10px;
        right: 15px;
        background: none;
        border: none;
        font-size: 28px; /* Larger close button */
        font-weight: bold;
        color: #aaa;
        cursor: pointer;
        line-height: 1;
      }
       .share-modal-close:hover {
         color: #333;
       }

       .share-modal-content h3, .share-modal-content h4 {
         margin-top: 0;
         margin-bottom: 15px;
         color: #333;
       }
       .share-modal-content h4 { margin-bottom: 10px; font-size: 1.1em; }

      /* Status message styles */
      .share-status { margin: 15px 0; padding: 10px; border-radius: 5px; font-size: 0.9em; }
      .share-status.error { background: #ffe6e6; color: #d32f2f; border: 1px solid #ffcccc; }
      .share-status.success { background: #e6ffed; color: #28a745; border: 1px solid #cce8d6; }
      .share-status.progress { background: #e6f4ff; color: #0366d6; border: 1px solid #cce0f5; }
      .share-status.info { background: #f0f0f0; color: #555; border: 1px solid #ddd; }
      .share-status p { margin: 5px 0;}
      .share-status ol, .share-status ul { padding-left: 20px; margin: 10px 0;}
      .share-status li { margin-bottom: 8px;}
      .share-status strong { font-weight: 600;}

      /* Button styles */
       .download-btn, .share-platform-btn { transition: background-color 0.2s ease; }
       .download-btn:hover:not(:disabled), .share-platform-btn:hover:not(:disabled) { background-color: #ddd; } /* Default hover */
       #download-combined:hover:not(:disabled) { background-color: #0056b3; } /* Specific hover for download */
       .all-platforms-btn:hover:not(:disabled) { background-color: #5a6268; }

       /* Disabled state */
        .download-btn:disabled, .share-platform-btn:disabled {
            background-color: #e9ecef;
            color: #6c757d;
            cursor: not-allowed;
            opacity: 0.7;
        }

        .share-platform-link { color: #007bff; text-decoration: none; }
        .share-platform-link:hover { text-decoration: underline; }

      /* Progress items */
      .share-progress-items { border: 1px solid #e1e1e1; border-radius: 5px; padding: 10px; max-height: 150px; overflow-y: auto;}
      .progress-item { display: flex; align-items: center; margin-bottom: 5px; padding: 5px 0; border-bottom: 1px solid #eee; font-size: 0.9em;}
      .progress-item:last-child { border-bottom: none; margin-bottom: 0; }
      .progress-item .platform-name { flex: 1; }
      .progress-item .status-icon { width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; margin-right: 10px;}
      /* Add SVG icons for statuses here if desired */


      @media (max-width: 480px) {
        .share-modal-content { padding: 20px; }
        .share-platforms-grid { grid-template-columns: 1fr; } /* Stack buttons */
      }
    `;

    // Add styles only once
    if (!document.getElementById('share-modal-styles')) {
        document.head.appendChild(shareStyles);
    }
  }

  // Function to set up event listeners for share UI
  function setupShareEvents() {
    const shareBtn = document.getElementById('share-btn');
    const shareModal = document.getElementById('share-modal');
    const shareModalClose = document.getElementById('share-modal-close');
    const platformButtons = document.querySelectorAll('.share-platform-btn'); // Includes "all" button
    const downloadCombinedBtn = document.getElementById('download-combined');

    if (shareBtn) {
        shareBtn.addEventListener('click', () => {
            resetShareState(); // Reset state every time modal is opened
            if (shareModal) {
                 shareModal.classList.add('active');
                 // Trigger initial media preparation when modal opens
                 prepareAndEnableActions();
            }
        });
    } else { console.error("Share button not found."); }

    if (shareModalClose) {
        shareModalClose.addEventListener('click', () => {
            if (shareModal) shareModal.classList.remove('active');
            abortMediaProcessing(); // Cancel processing when modal is closed
        });
    } else { console.error("Share modal close button not found."); }

    // Event listener for the download button
    if (downloadCombinedBtn) {
        downloadCombinedBtn.addEventListener('click', () => {
            if (combinedVideoBlob && !isProcessing) {
                downloadVideo(combinedVideoBlob, `imaginea_video_${Date.now()}.webm`);
                const shareStatus = document.getElementById('share-status');
                 if (shareStatus) {
                    shareStatus.textContent = 'Video download started (.webm).';
                    shareStatus.className = 'share-status success';
                 }
            } else if (isProcessing) {
                 alert("Please wait, the video is still being prepared.");
            } else {
                alert("Video is not ready for download. Please wait or try again.");
                 // Optionally trigger preparation again if blob is null
                 // prepareAndEnableActions();
            }
        });
    } else { console.error("Download button not found."); }

    // Event listener for platform/system share buttons
    platformButtons.forEach(btn => {
        btn.addEventListener('click', async () => {
            const platform = btn.getAttribute('data-platform'); // e.g., "all"
            if (combinedVideoBlob && !isProcessing) {
                await shareToSocialMedia(platform); // Use the prepared blob
            } else if (isProcessing) {
                alert("Please wait, the video is still being prepared for sharing.");
            } else {
                 alert("Video is not ready for sharing. Please wait or try again.");
                  // Optionally trigger preparation again
                 // prepareAndEnableActions();
            }
        });
    });

     // Add listener for clicking outside the modal to close it
     if (shareModal) {
         shareModal.addEventListener('click', (event) => {
             if (event.target === shareModal) { // Check if click is on the backdrop
                 shareModal.classList.remove('active');
                 abortMediaProcessing();
             }
         });
     }
  }

  // Function to initiate media preparation and enable buttons on completion
  async function prepareAndEnableActions() {
       const shareStatus = document.getElementById('share-status');
       const downloadBtn = document.getElementById('download-combined');
       const shareButtons = document.querySelectorAll('.share-platform-btn');
       const durationInput = document.getElementById('video-duration');
       const durationControl = document.querySelector('.duration-control'); // Show duration input

       // Disable buttons initially
       if(downloadBtn) downloadBtn.disabled = true;
       shareButtons.forEach(btn => btn.disabled = true);
       if(durationControl) durationControl.style.display = 'block'; // Make duration visible

       try {
           let requestedDuration = 60; // Default
           if (durationInput) {
              const parsedDuration = parseInt(durationInput.value, 10);
              if (!isNaN(parsedDuration) && parsedDuration > 0) {
                  requestedDuration = parsedDuration;
              } else {
                  durationInput.value = "60"; // Reset invalid input
              }
           }

           shareStatus.textContent = 'Preparing video... Please wait.';
           shareStatus.className = 'share-status progress';

           // Call the preparation function (returns the blob)
           const videoBlob = await prepareCombinedMedia(requestedDuration);

           if (videoBlob && videoBlob.size > 0) {
               // Success! Enable buttons
               if(downloadBtn) downloadBtn.disabled = false;
               shareButtons.forEach(btn => btn.disabled = false);

                shareStatus.textContent = 'Video ready for download or sharing!';
                shareStatus.className = 'share-status success';
                // Preview is handled inside prepareCombinedMedia
           } else {
               // Handle cases where preparation finished but blob is invalid
                if (!shareStatus.textContent.includes('Error')) { // Avoid overwriting specific errors
                     shareStatus.textContent = 'Failed to prepare video. Blob is empty or invalid.';
                     shareStatus.className = 'share-status error';
                }
           }

       } catch (error) {
           console.error("Error during initial media preparation:", error);
            if (!shareStatus.textContent.includes('Error')) { // Avoid overwriting specific errors
                shareStatus.textContent = `Error preparing video: ${error.message}`;
                shareStatus.className = 'share-status error';
            }
           // Keep buttons disabled on error
           if(downloadBtn) downloadBtn.disabled = true;
           shareButtons.forEach(btn => btn.disabled = true);
       }
  }


  // Simplified direct download without conversion
  function downloadVideo(videoBlob, filename) {
      const shareStatus = document.getElementById('share-status');
      try {
          if (!videoBlob || videoBlob.size === 0) {
              throw new Error("Video data is empty, cannot download.");
          }
          const url = URL.createObjectURL(videoBlob);
          const a = document.createElement('a');
          a.style.display = 'none';
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          // Delay revocation to ensure download starts, especially in Firefox
          setTimeout(() => {
              if (document.body.contains(a)) { // Check if element still exists
                  document.body.removeChild(a);
              }
              window.URL.revokeObjectURL(url);
          }, 150); // Slightly longer timeout

      } catch (e) {
          console.error("Download error:", e);
          if(shareStatus) {
              shareStatus.textContent = 'Error during download: ' + e.message;
              shareStatus.className = 'share-status error';
          }
      }
  }


  // Main function to combine video and audio - optimized
  async function prepareCombinedMedia(maxDurationSeconds = 60) {
    const shareStatus = document.getElementById('share-status');
    const sharePreviewContainer = document.getElementById('share-preview');
    const previewVideoEl = document.getElementById('share-video-preview');

    // Clear previous blob and preview
    combinedVideoBlob = null;
    if (previewVideoEl) {
        previewVideoEl.pause();
        previewVideoEl.removeAttribute('src');
        previewVideoEl.load();
    }
    if (sharePreviewContainer) sharePreviewContainer.classList.remove('active');


    // Check if already processing
    if (isProcessing) {
        shareStatus.textContent = 'Media preparation is already in progress...';
        shareStatus.className = 'share-status progress';
        return Promise.reject(new Error('Processing already active'));
    }
    isProcessing = true;
    shareStatus.textContent = 'Processing media (canvas capture)... Please wait.';
    shareStatus.className = 'share-status progress';

    // Access main video/audio elements - requires them to be globally accessible or passed
    const videoElement = document.getElementById('video-1');
    const newsAudioElement = document.getElementById('news-audio');
    // Determine the correct TTS audio source (complex logic from main script needed here)
    // This is a simplified placeholder - requires access to `currentIndex`, `newsItems`, `currentTtsAudio`
    let activeTtsSource = null;
    try {
        // This block needs adaptation based on the main script's state management
        const currentItem = (typeof newsItems !== 'undefined' && typeof currentIndex !== 'undefined' && newsItems[currentIndex]) ? newsItems[currentIndex] : null;
        const ttsAudioElementById = document.getElementById('tts-audio'); // Main TTS element

        if (typeof currentTtsAudio !== 'undefined' && currentTtsAudio && currentTtsAudio.src && !currentTtsAudio.error) {
             activeTtsSource = currentTtsAudio; // Prioritize the dynamically created one
             console.log("Using currentTtsAudio for merging.");
        } else if (currentItem && currentItem.tts_audio_path) {
            // If dynamic one not available/valid, try path from news item
             console.log("Using tts_audio_path for merging:", currentItem.tts_audio_path);
             activeTtsSource = new Audio(currentItem.tts_audio_path);
             // Note: Creating a new Audio here might cause issues if it needs to be played/managed by the main player
        } else if (ttsAudioElementById && ttsAudioElementById.src && !ttsAudioElementById.error) {
            // Fallback to the static #tts-audio element
             activeTtsSource = ttsAudioElementById;
             console.log("Using #tts-audio element for merging.");
        } else {
             console.log("No valid TTS source found for merging.");
        }
    } catch (e) {
        console.error("Error determining TTS source:", e);
    }


    if (!videoElement) {
        isProcessing = false;
        throw new Error('Main video element (#video-1) not found.');
    }

    // Get video dimensions safely
    let videoW = videoElement.videoWidth;
    let videoH = videoElement.videoHeight;
     if (!videoW || !videoH) {
        // Attempt to get from style or default if metadata not loaded
        videoW = videoElement.clientWidth || 640;
        videoH = videoElement.clientHeight || 360;
        console.warn(`Video dimensions not available from metadata, using ${videoW}x${videoH}`);
    }


    // Promise wrapper for async recording process
    return new Promise(async (resolve, reject) => {
        let audioCtx = null; // Declare here for scope access in finally/catch
        let canvasStream = null;
        let timeoutId = null; // To clear the recording timeout

        // Abort signal listener
        const abortHandler = () => {
             console.log("Abort signal received in prepareCombinedMedia.");
             if (timeoutId) clearTimeout(timeoutId);
             if (mediaRecorderForShare && mediaRecorderForShare.state === 'recording') {
                 mediaRecorderForShare.stop();
             } else {
                 // If recorder hasn't started or already stopped, clean up other resources
                 if (audioCtx && audioCtx.state !== 'closed') audioCtx.close().catch(e=>console.warn(e));
                 if (canvasStream) canvasStream.getTracks().forEach(track => track.stop());
                 isProcessing = false;
                 reject(new DOMException('Aborted', 'AbortError'));
             }
        };
        shareAbortController.signal.addEventListener('abort', abortHandler);


        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const scale = 0.8; // Slightly higher quality capture
            canvas.width = videoW * scale;
            canvas.height = videoH * scale;

            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const destination = audioCtx.createMediaStreamDestination();
            let audioSourcesConnected = 0;

            // Connect audio sources carefully, checking for validity
            const connectAudioSource = (element, name) => {
                 if (element && element.src && !element.error && typeof element.play === 'function') { // Check if it's a valid media element
                    try {
                        // Ensure the element is loaded enough to create source node
                         if (element.readyState >= 1) { // HAVE_METADATA or more
                             const sourceNode = audioCtx.createMediaElementSource(element);
                             sourceNode.connect(destination);
                             audioSourcesConnected++;
                             console.log(`Connected ${name} audio source.`);
                         } else {
                              console.warn(`${name} audio not ready (readyState: ${element.readyState}), skipping connection.`);
                         }

                    } catch (e) { console.warn(`Could not connect ${name} audio:`, e); }
                } else {
                     // console.log(`${name} audio element invalid or has no src.`);
                }
            };

            connectAudioSource(newsAudioElement, "News Audio");
            connectAudioSource(activeTtsSource, "TTS Audio");


            canvasStream = canvas.captureStream(24); // Capture at 24fps

            if (audioSourcesConnected > 0 && destination.stream.getAudioTracks().length > 0) {
                destination.stream.getAudioTracks().forEach(track => {
                    canvasStream.addTrack(track.clone()); // Clone to keep original streams intact
                });
                 console.log(`Added ${destination.stream.getAudioTracks().length} audio tracks to canvas stream.`);
            } else {
                console.warn("No audio tracks were successfully connected and added to the recording stream.");
            }

            const options = {
                mimeType: 'video/webm;codecs=vp8,opus', // VP8 is often faster to encode
                videoBitsPerSecond: 1500000, // 1.5 Mbps
                audioBitsPerSecond: 96000    // 96 kbps
            };
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                console.warn(`${options.mimeType} not supported, using default.`);
                delete options.mimeType;
            }

            mediaRecorderForShare = new MediaRecorder(canvasStream, options);
            const recordedChunks = [];

            mediaRecorderForShare.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    recordedChunks.push(e.data);
                }
            };

            mediaRecorderForShare.onstop = () => {
                console.log("MediaRecorder (for share) stopped.");
                 // Clean up audio context and stream tracks *after* recording stops
                 if (audioCtx && audioCtx.state !== 'closed') {
                     audioCtx.close().catch(e => console.warn("Error closing AudioContext post-recording:", e));
                 }
                 canvasStream.getTracks().forEach(track => track.stop());

                 // Check if aborted
                 if (shareAbortController.signal.aborted) {
                     console.log("Recording stopped due to abort signal.");
                     isProcessing = false;
                     reject(new DOMException('Aborted', 'AbortError'));
                     return;
                 }

                if (recordedChunks.length === 0) {
                    console.error("Recording stopped, but no data was collected (share).");
                    shareStatus.textContent = 'Error: Failed to record video (no data collected).';
                    shareStatus.className = 'share-status error';
                    isProcessing = false;
                    reject(new Error("No data in recorded chunks"));
                    return;
                }

                const blob = new Blob(recordedChunks, { type: recordedChunks[0]?.type || 'video/webm' });
                if (blob.size === 0) {
                    console.error("Recorded blob is empty (share)!");
                    shareStatus.textContent = 'Error: Failed to record video (empty result).';
                    shareStatus.className = 'share-status error';
                    isProcessing = false;
                    reject(new Error("Empty video blob recorded"));
                    return;
                }

                combinedVideoBlob = blob; // Store the final blob

                 // Update and show preview
                if (previewVideoEl && sharePreviewContainer) {
                    try {
                        const previewUrl = URL.createObjectURL(combinedVideoBlob);
                        previewVideoEl.src = previewUrl;
                         // Optional: Revoke previous URL if exists to free memory
                         // if (previewVideoEl.dataset.currentUrl) {
                         //    URL.revokeObjectURL(previewVideoEl.dataset.currentUrl);
                         // }
                         // previewVideoEl.dataset.currentUrl = previewUrl; // Store current URL

                        previewVideoEl.onloadedmetadata = () => {
                            sharePreviewContainer.classList.add('active');
                            console.log("Preview loaded.");
                        };
                         previewVideoEl.onerror = (e) => {
                             console.error("Error loading preview video:", e, previewVideoEl.error);
                             sharePreviewContainer.classList.remove('active');
                             shareStatus.textContent += ' (Preview failed to load)';
                             shareStatus.className = 'share-status error';
                         };
                         previewVideoEl.load(); // Explicitly load the new source
                    } catch(previewError) {
                         console.error("Error setting up preview:", previewError);
                         sharePreviewContainer.classList.remove('active');
                         shareStatus.textContent += ' (Preview setup failed)';
                         shareStatus.className = 'share-status error';
                    }
                }

                // Don't set status here, let the calling function do it
                // shareStatus.textContent = 'Media ready!';
                // shareStatus.className = 'share-status success';
                isProcessing = false;
                shareAbortController.signal.removeEventListener('abort', abortHandler); // Clean up listener
                resolve(combinedVideoBlob);
            };

            mediaRecorderForShare.onerror = (event) => {
                console.error("MediaRecorder (for share) error:", event.error);
                shareStatus.textContent = `Error during recording: ${event.error.name}`;
                shareStatus.className = 'share-status error';
                if (audioCtx && audioCtx.state !== 'closed') audioCtx.close().catch(e=>console.warn(e));
                canvasStream.getTracks().forEach(track => track.stop());
                isProcessing = false;
                 shareAbortController.signal.removeEventListener('abort', abortHandler);
                reject(event.error);
            };

            // --- Start Playback and Recording ---
            mediaRecorderForShare.start();
            console.log("MediaRecorder (for share) started.");

            // Reset and play media elements
            videoElement.currentTime = 0;
            videoElement.muted = true; // Mute video element itself if mixing audio

            const playPromises = [];
            playPromises.push(videoElement.play().catch(e => { console.warn("Video element play error:", e); return e; })); // Return error to check later

             // Only play audio elements if they were successfully connected
             if (newsAudioElement && audioCtx.state === 'running' && destination.numberOfInputs > 0) { // Check context state and connections
                 const isNewsConnected = Array.from(audioCtx._nativeAudioContext._nodeOutputs[0]).some(node => node === destination); // Hacky check, better way needed
                 // Safer: Check if a source node was created for it
                 // if (newsSourceNode) { // Assuming newsSourceNode was stored if created
                    newsAudioElement.currentTime = 0;
                    playPromises.push(newsAudioElement.play().catch(e => console.warn("News audio play error:", e)));
                 // }
             }
             if (activeTtsSource && audioCtx.state === 'running' && destination.numberOfInputs > 0) {
                 // if (ttsSourceNode) { // Assuming ttsSourceNode was stored
                     activeTtsSource.currentTime = 0;
                     playPromises.push(activeTtsSource.play().catch(e => console.warn("TTS audio play error:", e)));
                 // }
             }

            // Wait for all media to start playing (or fail)
            await Promise.all(playPromises);
            console.log("Media elements playback initiated.");


             // Determine the actual duration based on video and requested max duration
             const videoDuration = videoElement.duration;
             if (!videoDuration || isNaN(videoDuration) || videoDuration === Infinity) {
                  console.warn("Video duration is unknown or invalid. Using requested max duration.");
                  // Ensure we don't run forever if duration is bad
                  if (maxDurationSeconds > 300 || maxDurationSeconds <= 0) maxDurationSeconds = 60;
             }
             const actualDuration = Math.min(videoDuration || maxDurationSeconds, maxDurationSeconds);
             console.log(`Recording for ${actualDuration.toFixed(2)} seconds.`);


            // --- Canvas Drawing Loop ---
            let animationFrameId;
            let lastFrameTime = 0;
            const frameInterval = 1000 / 24; // Target 24fps draw rate

            function drawVideoFrame(now) {
                if (mediaRecorderForShare.state !== 'recording' || shareAbortController.signal.aborted) {
                     cancelAnimationFrame(animationFrameId);
                     console.log("Canvas draw loop stopped.");
                     return;
                }

                if (now - lastFrameTime >= frameInterval) {
                     if (videoElement.videoWidth > 0 && videoElement.videoHeight > 0 && videoElement.readyState >= videoElement.HAVE_CURRENT_DATA) {
                         ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
                    } else {
                         // Draw black or placeholder if video not ready
                        ctx.fillStyle = 'black';
                        ctx.fillRect(0, 0, canvas.width, canvas.height);
                    }
                    lastFrameTime = now;
                }
                animationFrameId = requestAnimationFrame(drawVideoFrame);
            }
            animationFrameId = requestAnimationFrame(drawVideoFrame);


            // --- Stop Recording After Duration ---
            timeoutId = setTimeout(() => {
                 if (mediaRecorderForShare && mediaRecorderForShare.state === 'recording') {
                    console.log(`Stopping recording after ${actualDuration} seconds.`);
                    mediaRecorderForShare.stop(); // Triggers onstop
                 }
                 // Pause elements after recording stops (or was scheduled to stop)
                 videoElement.pause();
                 if (newsAudioElement) newsAudioElement.pause();
                 if (activeTtsSource) activeTtsSource.pause();
                 // Cancel the drawing loop explicitly if it's still running
                 if (animationFrameId) cancelAnimationFrame(animationFrameId);

            }, actualDuration * 1000 + 100); // Add slight buffer

        } catch (error) {
            console.error('Error in prepareCombinedMedia setup:', error);
            shareStatus.textContent = 'Error preparing media: ' + error.message;
            shareStatus.className = 'share-status error';
            if (audioCtx && audioCtx.state !== 'closed') audioCtx.close().catch(e=>console.warn(e));
            if (canvasStream) canvasStream.getTracks().forEach(track => track.stop());
            isProcessing = false;
            shareAbortController.signal.removeEventListener('abort', abortHandler);
            reject(error);
        }
    });
}


   async function shareToSocialMedia(platform) {
    const shareStatus = document.getElementById('share-status');
    const shareProgressContainer = document.getElementById('share-progress-container');
    // const shareProgressItems = document.getElementById('share-progress-items'); // For multi-platform status

    // Reset UI for single share action
    shareProgressContainer.classList.remove('active');
    // if (shareProgressItems) shareProgressItems.innerHTML = '';

    // Use the already prepared blob
    if (!combinedVideoBlob || combinedVideoBlob.size === 0) {
        shareStatus.textContent = 'Error: Video data is not available for sharing.';
        shareStatus.className = 'share-status error';
        console.error("shareToSocialMedia called without a valid combinedVideoBlob.");
        return;
    }

    try {
        shareStatus.textContent = 'Preparing to share...';
        shareStatus.className = 'share-status progress';

        // Get current news item details (ensure newsItems and currentIndex are accessible)
        let currentItem;
        try {
            currentItem = (typeof newsItems !== 'undefined' && typeof currentIndex !== 'undefined' && newsItems[currentIndex])
                            ? newsItems[currentIndex]
                            : { title: 'Interesting Video', url: window.location.href, description: '' }; // Fallback
        } catch (e) {
            console.warn("Could not access global newsItems/currentIndex, using fallback.");
            currentItem = { title: 'Interesting Video', url: window.location.href, description: '' };
        }

        const title = currentItem.title || 'Check out this video';
        const pageUrl = currentItem.url || window.location.href;
        const description = currentItem.description || title; // Use description or title

        // Determine filename and type
        const timestamp = Date.now();
        const filename = `shared_video_${timestamp}.webm`;
        const fileType = combinedVideoBlob.type || 'video/webm';

        const videoFile = new File([combinedVideoBlob], filename, { type: fileType });

        // Use Web Share API if available and can share files
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [videoFile] })) {
             shareStatus.textContent = 'Opening system share dialog...';
             shareStatus.className = 'share-status progress';
             try {
                await navigator.share({
                    title: title,
                    text: description, // Share description text
                    url: pageUrl,     // Share URL alongside text/video
                    files: [videoFile]
                });
                shareStatus.textContent = 'System share dialog opened successfully.';
                shareStatus.className = 'share-status success';
                console.log('Successfully shared via navigator.share');
                 // Close modal after successful system share? Optional.
                 // document.getElementById('share-modal')?.classList.remove('active');

             } catch (error) {
                 console.error('Error using navigator.share:', error);
                 if (error.name === 'AbortError') {
                     shareStatus.textContent = 'Sharing cancelled by user.';
                     shareStatus.className = 'share-status info';
                 } else {
                     shareStatus.textContent = `System share failed: ${error.message}. Please download and share manually.`;
                     shareStatus.className = 'share-status error';
                     // Offer download as fallback
                     offerManualDownloadInstructions(platform, videoFile, title, pageUrl);
                 }
             }
        } else {
            // Web Share API not supported or cannot share files -> Fallback
            console.log("Web Share API (with files) not supported. Falling back to manual download/share instructions.");
             shareStatus.textContent = 'Direct sharing not supported. Please use download.';
             shareStatus.className = 'share-status info';
             offerManualDownloadInstructions(platform, videoFile, title, pageUrl);
        }

    } catch (error) {
        console.error('Error in shareToSocialMedia:', error);
        shareStatus.textContent = 'An unexpected error occurred during sharing: ' + error.message;
        shareStatus.className = 'share-status error';
    }
}

// Helper to show download + manual upload instructions
function offerManualDownloadInstructions(platform, videoFile, title, shareUrl) {
    const shareStatus = document.getElementById('share-status');
    if (!shareStatus) return;

    let platformName = platform.charAt(0).toUpperCase() + platform.slice(1);
    if (platform === 'all') platformName = 'your desired platform';

    let platformWebUrl = '';
     let instructions = `
        <p>To share on <strong>${platformName}</strong>:</p>
        <ol>
            <li>First, <strong>download the video</strong>:</li>
            <button class="download-btn" id="manual-share-download" style="margin: 5px 0 10px 0; background-color: #17a2b8; color: white;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                Download Video (.webm)
            </button>
            <li>Then, open ${platformName} and manually upload the video you just downloaded. You can copy the text below:</li>
             <textarea readonly style="width: 95%; height: 60px; margin-top: 5px; font-size: 0.9em; padding: 5px; border-radius: 3px; border: 1px solid #ccc;">${title} ${shareUrl}</textarea>
        </ol>
    `;

     // Add specific platform links where useful
     switch (platform.toLowerCase()) {
        case 'twitter': platformWebUrl = `https://twitter.com/compose/tweet`; break;
        case 'facebook': platformWebUrl = `https://www.facebook.com/`; break; // User needs to find upload
        case 'youtube': platformWebUrl = 'https://studio.youtube.com/channel/upload'; break;
        case 'reddit': platformWebUrl = 'https://www.reddit.com/submit'; break;
        // WhatsApp, Instagram, Snapchat usually require mobile app or specific setup
     }

     if (platformWebUrl) {
         instructions += `<p><a href="${platformWebUrl}" target="_blank" rel="noopener noreferrer" class="share-platform-link" style="display: inline-block; margin-top: 5px; padding: 5px 10px; background: #eee; border-radius: 3px;">Open ${platformName} in new tab</a></p>`;
     }

    shareStatus.innerHTML = instructions;
    shareStatus.className = 'share-status info'; // Informational state

    const downloadBtn = document.getElementById('manual-share-download');
    if (downloadBtn) {
        // Remove previous listener if any (safer)
        downloadBtn.replaceWith(downloadBtn.cloneNode(true)); // Clone to remove listeners
        const newDownloadBtn = document.getElementById('manual-share-download'); // Get the new button
        newDownloadBtn.addEventListener('click', () => {
            downloadVideo(videoFile, `${platform}_share_video.webm`);
             // Provide feedback after click
             newDownloadBtn.textContent = 'Download Started!';
             setTimeout(() => { newDownloadBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg> Download Video (.webm)`; }, 2000);
        });
    }
}


// FFmpeg related functions (Placeholders - require FFmpeg library setup)
// async function convertToTwitterFormat(blob) {
//   // Placeholder: Requires FFmpeg.wasm or server-side conversion
//   console.warn("Video conversion (e.g., for Twitter) requires FFmpeg setup, which is not included here. Returning original blob.");
//   return blob; // Return original blob as fallback
// }
//
// async function processVideoForTwitter(videoBlob) {
//   try {
//     console.log('Starting Twitter video conversion (Placeholder)...');
//     // const convertedBlob = await convertToTwitterFormat(videoBlob); // Actual conversion call
//     const convertedBlob = videoBlob; // Placeholder
//     console.log('Video conversion successful (Placeholder)');
//
//     // Example: download the "converted" blob
//     // const url = URL.createObjectURL(convertedBlob);
//     // const a = document.createElement('a');
//     // a.href = url;
//     // a.download = 'twitter_video_placeholder.webm'; // Should be .mp4 if converted
//     // a.textContent = 'Download Twitter-ready video (Placeholder)';
//     // document.body.appendChild(a);
//
//     return convertedBlob;
//   } catch (error) {
//     console.error('Failed to process video (Placeholder):', error);
//     // alert('Video conversion failed: ' + error.message);
//     throw error; // Re-throw
//   }
// }


// Platform specific sharing logic (mostly covered by Web Share API or manual fallback now)
// async function platformShare(platform, title, shareUrl, videoFile) { ... }
// This function is largely replaced by the logic within shareToSocialMedia using navigator.share and the manual fallback.


// Offer video download with platform-specific instructions (also integrated into fallback)
// function offerVideoDownload(platform, videoFile) { ... }
// This is now part of offerManualDownloadInstructions


  // Initialize the sharing functionality
  function initShare() { // Renamed to avoid conflict if 'init' is global elsewhere
      console.log("Initializing Share Module...");
      createShareUI();
      setupShareEvents();
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initShare);
  } else {
    // DOM is already ready
    initShare();
  }

})(); // End of IIFE