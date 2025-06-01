let mediaRecorder;
let recordedChunks = [];
let isRecording = false;
let recordStream;
let canvasStream;
let canvasInterval;
let wakeLock;

function setupRecordingButton() {
  const recordBtn = document.getElementById('record-btn');
  if (recordBtn) {
    recordBtn.addEventListener('click', toggleRecording);
  } else {
    console.error("Record button not found for setup.");
  }
}

async function toggleRecording() {
  if (isRecording) {
    stopRecording();
  } else {
    await startRecording(); // Make sure to await the async start
  }
  updateRecordButton(); // Update button state after start/stop attempt
}

async function startRecording() {
  // Ensure we are not already processing a recording start
  if (isRecording) {
      console.warn("Recording is already in progress.");
      return;
  }
  recordedChunks = [];
  isRecording = true; // Set state early to prevent race conditions
  showRecordingIndicator(true); // Show indicator early
  updateRecordButton(); // Update button icon early

  try {
    // Get video element's position and dimensions
    const videoElement = document.getElementById('video-1');
    if (!videoElement) {
        throw new Error("Video element #video-1 not found.");
    }
    const rect = videoElement.getBoundingClientRect();

    // Check for valid dimensions
    if (rect.width <= 0 || rect.height <= 0) {
      console.warn("Video element has zero dimensions. Using fallback size for canvas.");
      rect.width = 640; // Example fallback
      rect.height = 360;
      // Or try to get dimensions later if video metadata loads
    }

    try {
      if (navigator.wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        console.log('Wake Lock is active.');
        wakeLock.addEventListener('release', () => {
          console.log('Wake Lock was released');
          wakeLock = null; // Reset wakeLock variable
        });
      } else {
          console.warn('Wake Lock API is not supported in this browser.');
      }
    } catch (wakeLockErr) {
      console.warn('Could not acquire wake lock:', wakeLockErr);
    }

    // Create a canvas for cropping
    const canvas = document.createElement('canvas');
    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext('2d');

    // Create a hidden container for the canvas (optional, helps debugging)
    const canvasContainer = document.createElement('div');
    canvasContainer.style.position = 'absolute';
    canvasContainer.style.left = '-9999px';
    canvasContainer.appendChild(canvas);
    document.body.appendChild(canvasContainer);

    // First get display media (screen capture)
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        displaySurface: "monitor", // Monitor allows capturing specific windows too sometimes
        cursor: "never"          // Don't capture the cursor
      },
      audio: true,               // Request system audio
      preferCurrentTab: false    // Prefer entire screen/window over just the current tab
    });

    // Check if we got video tracks
     const videoTracks = displayStream.getVideoTracks();
     if (videoTracks.length === 0) {
        throw new Error("No video track captured from screen.");
     }
     const videoTrack = videoTracks[0];

    // Check if we got audio tracks
    const audioTracks = displayStream.getAudioTracks();
    if (audioTracks.length === 0) {
      console.warn('No system audio captured - make sure to check "Share audio" (or "Share system audio") in the browser prompt.');
    }

    // Set up the canvas drawing interval (for cropping)
    // Create a video element to play the captured screen content (needed for drawImage)
    const screenVideo = document.createElement('video');
    screenVideo.style.position = 'absolute'; // Keep it off-screen or hidden
    screenVideo.style.left = '-9999px';
    screenVideo.srcObject = new MediaStream([videoTrack]);
    screenVideo.muted = true; // Mute it, we capture audio separately if needed

    await screenVideo.play(); // Start playing the screen capture into the hidden video

    // Get the frameRate from the video track settings if possible, else default
    const settings = videoTrack.getSettings();
    const frameRate = settings.frameRate || 30;

    // Draw frames to canvas at the framerate of the source
    canvasInterval = setInterval(() => {
      if (isRecording && screenVideo.readyState >= screenVideo.HAVE_CURRENT_DATA) {
        // Calculate the position to crop from the full screen
        // Re-get rect in case of window resize/scroll, though this might be complex
        const currentRect = videoElement.getBoundingClientRect();
        const screenX = currentRect.left; // Use current left position
        const screenY = currentRect.top;  // Use current top position

        // Check if dimensions changed significantly
        if (Math.abs(currentRect.width - canvas.width) > 1 || Math.abs(currentRect.height - canvas.height) > 1) {
            console.warn("Video element size changed during recording. Canvas might not match.");
            // Optionally resize canvas here, but it's complex with MediaRecorder
            // canvas.width = currentRect.width;
            // canvas.height = currentRect.height;
        }

        // Draw the cropped area from the *hidden screen video* to the canvas
        try {
            ctx.drawImage(
              screenVideo,     // Source is the hidden video playing the screen capture
              screenX,         // Source X (top-left corner of the target element on the screen)
              screenY,         // Source Y
              currentRect.width, // Source width (current width of the target element)
              currentRect.height,// Source height
              0,               // Destination X on canvas
              0,               // Destination Y on canvas
              canvas.width,    // Destination width on canvas (fixed at start)
              canvas.height    // Destination height on canvas
            );
        } catch (drawError) {
             console.error("Error drawing to canvas:", drawError);
             // Potentially stop recording if drawing fails repeatedly
        }
      } else if (!isRecording) {
           clearInterval(canvasInterval); // Stop interval if recording stopped elsewhere
      }
    }, 1000 / frameRate); // Interval based on source frame rate

    // Get a stream from the canvas
    canvasStream = canvas.captureStream(frameRate);

    // Create a new MediaStream to combine canvas video and display audio
    const combinedStream = new MediaStream();

    // Add video track from canvas
    canvasStream.getVideoTracks().forEach(track => {
      combinedStream.addTrack(track);
    });

    // Add audio tracks from display capture
    audioTracks.forEach(track => {
      // Clone the track to avoid issues if the original displayStream stops early
      combinedStream.addTrack(track.clone());
    });

    // If no system audio was captured, try to get microphone audio as fallback
    if (audioTracks.length === 0) {
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            sampleRate: 44100 // Standard audio sample rate
          }
        });

        micStream.getAudioTracks().forEach(track => {
          combinedStream.addTrack(track); // Add mic track
        });

        console.log("Using microphone audio as fallback (system audio not captured).");
      } catch (audioErr) {
        console.warn("Could not get microphone audio either:", audioErr);
        showError("Audio capture failed. Recording will have no sound.");
      }
    }

    // Ensure the combined stream actually has tracks before proceeding
    if (combinedStream.getTracks().length === 0) {
        throw new Error("Failed to create a combined stream with any tracks.");
    }


    // Record the combined stream
    let options;
    const supportedTypes = [
        'video/webm; codecs=vp9,opus',
        'video/webm; codecs=vp8,opus',
        'video/webm; codecs=h264,opus',
        'video/mp4; codecs=h264,aac', // Less likely to be supported by MediaRecorder directly
        'video/webm' // Fallback
    ];

    let selectedType = '';
    for (const type of supportedTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
            selectedType = type;
            break;
        }
    }

    if (!selectedType) {
        console.warn("No preferred mimeType supported, using browser default.");
        options = {}; // Use default
    } else {
        console.log("Using mimeType:", selectedType);
        options = { mimeType: selectedType };
    }


    // Add bitrate options if needed, e.g., options.videoBitsPerSecond = 2500000;
     options.videoBitsPerSecond = 2 * 1024 * 1024; // 2 Mbps for video
     options.audioBitsPerSecond = 128 * 1000; // 128 kbps for audio


    try {
        mediaRecorder = new MediaRecorder(combinedStream, options);
    } catch (recorderError) {
        console.error("Failed to create MediaRecorder:", recorderError);
        // Attempt without specific options as a last resort
        try {
            console.warn("Retrying MediaRecorder creation with default options.");
            mediaRecorder = new MediaRecorder(combinedStream);
        } catch (fallbackError) {
            throw new Error(`MediaRecorder creation failed: ${fallbackError.message}`);
        }
    }


    mediaRecorder.ondataavailable = handleDataAvailable;

    mediaRecorder.onstop = () => {
      handleStop(); // Process the recorded data

      // Clean up resources
      clearInterval(canvasInterval);
      canvasInterval = null;

       // Stop screen video playback
      screenVideo.pause();
      screenVideo.srcObject = null;


      // Stop all tracks in the streams we created/captured
      if (canvasStream) {
        canvasStream.getTracks().forEach(track => track.stop());
      }
       // We stop combinedStream tracks *instead* of displayStream tracks directly
       // because we might have added mic audio to combinedStream.
      if (combinedStream) {
          combinedStream.getTracks().forEach(track => track.stop());
      }
      // The original displayStream tracks should stop automatically if they were
      // the source for the combinedStream tracks that we just stopped.
      // If issues persist, explicitly stop displayStream tracks too:
      // if (displayStream) {
      //     displayStream.getTracks().forEach(track => track.stop());
      // }


      if (wakeLock) {
        wakeLock.release().catch(err => console.warn("Error releasing wake lock:", err));
        // wakeLock variable is reset by the 'release' event listener added earlier
      }

      // Remove the hidden canvas container
      if (canvasContainer && canvasContainer.parentNode) {
          document.body.removeChild(canvasContainer);
      }

      // Ensure state is updated
      isRecording = false;
      showRecordingIndicator(false);
      updateRecordButton();
    };

     mediaRecorder.onerror = (event) => {
        console.error("MediaRecorder Error:", event.error);
        showError(`Recording error: ${event.error.name}. Stopping recording.`);
        stopRecording(); // Attempt a clean stop
    };

    // Start recording
    mediaRecorder.start(1000); // Collect data in chunks (e.g., every 1 second)
    console.log("MediaRecorder started with state:", mediaRecorder.state);


    // Store references for cleanup (optional, combinedStream is now key)
    // recordStream = displayStream; // Keep original if needed for direct stop

  } catch (err) {
    console.error("Error starting screen recording:", err);
    isRecording = false; // Ensure state is reset on error
    showRecordingIndicator(false);
    updateRecordButton();
    showError(`Failed to start recording: ${err.message}. Please ensure permissions are granted and screen/audio is shared.`);

     // Clean up partial resources if error occurred mid-setup
     if (canvasInterval) clearInterval(canvasInterval);
     if (canvasStream) canvasStream.getTracks().forEach(track => track.stop());
     // displayStream might exist if getUserMedia succeeded but later steps failed
     // const displayStreamTracks = recordStream?.getTracks() ?? []; // Get tracks if recordStream was assigned
     // displayStreamTracks.forEach(track => track.stop());
     if (wakeLock) wakeLock.release().catch(e => console.warn("Error releasing wake lock on error:", e));
     const canvasContainer = document.querySelector('div[style*="left: -9999px;"]'); // Find dynamically created container
     if (canvasContainer && canvasContainer.parentNode) document.body.removeChild(canvasContainer);
  }
}

function stopRecording() {
  if (mediaRecorder && (mediaRecorder.state === "recording" || mediaRecorder.state === "paused")) {
    try {
        console.log("Stopping MediaRecorder...");
        mediaRecorder.stop(); // This triggers the 'onstop' event handler asynchronously
        // State updates (isRecording=false, indicator, button) are now handled within onstop for cleaner flow
    } catch (e) {
        console.error("Error calling mediaRecorder.stop():", e);
        // Force cleanup if stop fails critically
        isRecording = false;
        showRecordingIndicator(false);
        updateRecordButton();
         // Manually clean up tracks if onstop might not fire
        if (canvasStream) canvasStream.getTracks().forEach(track => track.stop());
        // Consider stopping combinedStream tracks here too as a fallback
        // combinedStream?.getTracks().forEach(track => track.stop());
        if (wakeLock) wakeLock.release().catch(err => console.warn("Error releasing wake lock during forced stop:", err));

    }
  } else {
    console.warn("stopRecording called but MediaRecorder is not active or doesn't exist. State:", mediaRecorder?.state);
    // Ensure UI is consistent even if recorder wasn't active
    if (isRecording) { // If state somehow got out of sync
        isRecording = false;
        showRecordingIndicator(false);
        updateRecordButton();
    }
  }

  // Clear the drawing interval immediately upon requesting stop
  if (canvasInterval) {
    clearInterval(canvasInterval);
    canvasInterval = null;
  }
}


function handleDataAvailable(event) {
  if (event.data && event.data.size > 0) {
    recordedChunks.push(event.data);
  } else {
      // console.log("ondataavailable event received, but no data.");
  }
}

function handleStop() {
    console.log("MediaRecorder stopped. Processing recorded data...");
    if (recordedChunks.length === 0) {
        console.warn("No recorded chunks available. Download cancelled.");
        showError("Recording failed: No video data was captured.");
        // Ensure UI is reset correctly even on failure
        isRecording = false;
        showRecordingIndicator(false);
        updateRecordButton();
        return; // Exit early
    }

  // Create a blob from the recorded chunks
  // Use the mimeType from the first chunk if available, otherwise default
  const mimeType = recordedChunks[0]?.type || 'video/webm';
  const blob = new Blob(recordedChunks, {
    type: mimeType
  });

  // Get the extension based on the mimeType
  let extension = '.webm';
  if (mimeType.includes('mp4')) {
      extension = '.mp4';
  } // Add more checks if other types are possible

  // Create a URL for the blob
  const url = URL.createObjectURL(blob);

  // Create a download link
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  // Use timestamp in filename for uniqueness
  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  a.download = `imaginea-video-${timestamp}${extension}`;

  // Add to document, click it, and remove it
  document.body.appendChild(a);
  a.click();

  // Clean up the URL object after a short delay
  setTimeout(() => {
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    console.log("Download initiated and resources cleaned up.");
  }, 100);

  // Reset chunks for the next recording
  recordedChunks = [];

  // Final state updates (already handled in the caller stopRecording -> onstop chain)
  // isRecording = false;
  // showRecordingIndicator(false);
  // updateRecordButton();
}


function updateRecordButton() {
  const btn = document.getElementById('record-btn');
  if (!btn) return;

  if (isRecording) {
    btn.innerHTML = `<i data-lucide="square"></i>`; // Recording -> Show Stop icon
    btn.setAttribute('aria-label', 'Stop recording');
  } else {
    btn.innerHTML = `<i data-lucide="video"></i>`; // Not recording -> Show Record icon
     btn.setAttribute('aria-label', 'Record content');
  }
  // Re-render Lucide icons if they were replaced
  if (typeof lucide !== 'undefined') {
      lucide.createIcons();
  }
}

function showRecordingIndicator(show) {
  // Create or get recording indicator
  let indicator = document.getElementById('recording-indicator');
  const container = document.querySelector('.carousel-container'); // Ensure container exists

  if (!container) {
      console.error("Cannot show recording indicator: '.carousel-container' not found.");
      return;
  }

  if (!indicator && show) {
    indicator = document.createElement('div');
    indicator.id = 'recording-indicator';
    indicator.style.position = 'absolute';
    indicator.style.top = '70px'; // Adjust position as needed
    indicator.style.right = '15px';
    indicator.style.backgroundColor = 'rgba(255, 0, 0, 0.8)'; // More opaque
    indicator.style.color = 'white';
    indicator.style.padding = '5px 10px';
    indicator.style.borderRadius = '4px';
    indicator.style.fontSize = '12px'; // Smaller font
    indicator.style.fontWeight = 'bold';
    indicator.style.zIndex = '1001'; // Ensure it's above other controls
    indicator.style.display = 'flex';
    indicator.style.alignItems = 'center';
    indicator.style.gap = '5px';
    indicator.setAttribute('aria-live', 'assertive'); // Announce start/stop
    indicator.innerHTML = `
      <div style="width: 10px; height: 10px; background-color: red; border-radius: 50%; animation: pulse 1.5s infinite ease-in-out;"></div>
      <span>RECORDING</span>
    `;

    // Add pulse animation if not already present
    if (!document.getElementById('recording-pulse-style')) {
        const style = document.createElement('style');
        style.id = 'recording-pulse-style';
        style.textContent = `
          @keyframes pulse {
            0% { transform: scale(1); opacity: 1; }
            50% { transform: scale(0.8); opacity: 0.7; }
            100% { transform: scale(1); opacity: 1; }
          }
        `;
        document.head.appendChild(style);
    }

    container.appendChild(indicator);

  } else if (indicator && !show) {
    indicator.remove();
  }
}

// Use the showError function from the main script if available, or define a local one
// Assuming the main script's showError is accessible globally:
// function showError(message) {
//     const mainShowError = window.showError; // Access global function if needed
//     if (mainShowError) {
//         mainShowError(message);
//     } else {
//         // Fallback basic alert if global function isn't found
//         console.error("showError function not found, using alert:", message);
//         alert(`Error: ${message}`);
//     }
// }

// Local showError if needed (copy from original):
function showError(message) {
  const errorMessage = document.getElementById('error-message');
  if (errorMessage) {
      errorMessage.textContent = message;
      errorMessage.classList.add('active');

      // Hide error after 5 seconds
      setTimeout(() => {
        errorMessage.classList.remove('active');
      }, 5000);
  } else {
      console.error("Error message element not found. Message:", message);
      alert("Error: " + message); // Fallback
  }
}
