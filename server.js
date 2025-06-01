
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const path = require('path');
const cron = require('node-cron');
const fs = require('fs');
const http = require('http');
const { parse } = require('querystring');

const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON bodies
app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  // Enable SharedArrayBuffer
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    if (req.hostname.endsWith('.glitch.me')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  // Additional security headers (recommended but optional)
  // res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  
   res.setHeader('Cache-Control', 'no-store');

  
  next();
});


// Create the audio directory if it doesn't exist
const audioDir = path.join(__dirname, 'public', 'audio');
if (!fs.existsSync(audioDir)) {
  fs.mkdirSync(audioDir, { recursive: true });
}

// Check if database file exists
const dbExists = fs.existsSync('./news.db');

// Initialize SQLite database
const db = new sqlite3.Database('./news.db', (err) => {
  if (err) {
    console.error('Error opening database', err);
  } else {
    console.log('Connected to the SQLite database');
    
    // Initialize database tables with proper error handling
    initializeDatabase();
  }
});

function initializeDatabase() {
  // If database already exists, check if it needs migration
  if (dbExists) {
    console.log('Checking if database needs migration...');
    
    // Check if the news table exists
    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='news'", (err, table) => {
      if (err) {
        console.error('Error checking if table exists:', err);
        return;
      }
      
      if (!table) {
        // Table doesn't exist, create it
        createNewsTable();
      } else {
        // Table exists, check if it has batch_id column
        db.all("PRAGMA table_info(news)", (err, columns) => {
          if (err) {
            console.error('Error checking table columns:', err);
            return;
          }
          
          const hasBatchId = columns.some(col => col.name === 'batch_id');
          
          if (!hasBatchId) {
            console.log('Migrating database to add batch_id column...');
            // Add batch_id column to existing table
            db.run("ALTER TABLE news ADD COLUMN batch_id TEXT DEFAULT 'initial_batch'", (err) => {
              if (err) {
                console.error('Error adding batch_id column:', err);
              } else {
                console.log('Successfully added batch_id column');
              }
            });
          } else {
            console.log('Database schema is up to date');
          }
        });
      }
      
      // Check if tts_audio table exists and create it if not
      createTtsAudioTable();
    });
  } else {
    // New database, create tables
    createNewsTable();
    createTtsAudioTable();
  }
}

function createNewsTable() {
  console.log('Creating news table...');
  db.run(`CREATE TABLE IF NOT EXISTS news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    url TEXT,
    image TEXT,
    publishedAt TEXT,
    source TEXT,
    batch_id TEXT NOT NULL,
    fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Error creating news table:', err);
    } else {
      console.log('News table created successfully');
    }
  });
}

function createTtsAudioTable() {
  console.log('Creating tts_audio table...');
  db.run(`CREATE TABLE IF NOT EXISTS tts_audio (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    news_id INTEGER NOT NULL,
    audio_path TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (news_id) REFERENCES news(id)
  )`, (err) => {
    if (err) {
      console.error('Error creating tts_audio table:', err);
    } else {
      console.log('TTS audio table created successfully');
    }
  });
}

// Simple TTS Implementation
// Helper function to download a file from URL
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const protocol = require(url.startsWith('https') ? 'https' : 'http');
    const file = fs.createWriteStream(dest);
    
    protocol.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }
      
      response.pipe(file);
      
      file.on('finish', () => {
        file.close(() => resolve());
      });
      
      file.on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

// Generate TTS audio using Google TTS (instead of ElevenLabs)
async function generateTtsAudio(text, newsId) {
  try {
    // First check if we already have audio for this news item
    const existingAudio = await new Promise((resolve, reject) => {
      db.get('SELECT audio_path FROM tts_audio WHERE news_id = ?', [newsId], (err, row) => {
        if (err) {
          console.error('Error checking for existing TTS audio:', err);
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
    
    // If audio already exists, return the path
    if (existingAudio) {
      console.log(`Using existing TTS audio for news ID ${newsId} at ${existingAudio.audio_path}`);
      return existingAudio.audio_path;
    }
    
    console.log(`Generating new TTS audio for news ID ${newsId}...`);
    
    // Create unique filename and directories
    const timestamp = Date.now();
    const fileName = `news_${newsId}_${timestamp}.mp3`;
    const outputFile = path.join(audioDir, fileName);
    
    // Create a temporary directory for chunks
    const tempDir = path.join(audioDir, `temp_${timestamp}`);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }
    
    // Split text into chunks (Google TTS has a character limit)
    const MAX_CHARS = 200;
    const textChunks = [];
    
    for (let i = 0; i < text.length; i += MAX_CHARS) {
      textChunks.push(text.substring(i, i + MAX_CHARS));
    }
    
    // Download each chunk
    for (let i = 0; i < textChunks.length; i++) {
      const chunk = textChunks[i];
      const encodedText = encodeURIComponent(chunk);
      // Use Google Translate TTS service (same as in the simple TTS server)
      const url = `http://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en&q=${encodedText}`;
      const chunkFile = path.join(tempDir, `chunk_${i}.mp3`);
      
      await downloadFile(url, chunkFile);
    }
    
    // Combine all MP3 files
    const outputStream = fs.createWriteStream(outputFile);
    
    for (let i = 0; i < textChunks.length; i++) {
      const chunkFile = path.join(tempDir, `chunk_${i}.mp3`);
      const chunkData = fs.readFileSync(chunkFile);
      outputStream.write(chunkData);
    }
    
    outputStream.end();
    
    // Wait for the file to be written
    await new Promise(resolve => {
      outputStream.on('finish', resolve);
    });
    
    // Clean up temp files
    for (let i = 0; i < textChunks.length; i++) {
      fs.unlinkSync(path.join(tempDir, `chunk_${i}.mp3`));
    }
    fs.rmdirSync(tempDir);
    
    // Get the relative path for database storage
    const relativePath = `/audio/${fileName}`;
    
    // Insert record into the database
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO tts_audio (news_id, audio_path) VALUES (?, ?)`,
        [newsId, relativePath],
        function(err) {
          if (err) {
            console.error('Error inserting TTS audio record:', err);
            reject(err);
          } else {
            console.log(`TTS audio saved for news ID ${newsId} at ${outputFile}`);
            resolve();
          }
        }
      );
    });
    
    return relativePath;
  } catch (error) {
    console.error('Error generating TTS audio:', error);
    throw error;
  }
}

// Fetch news from GNews API and store in database
async function fetchAndStoreNews() {
  try {
    console.log('Fetching fresh news from GNews API...');
    const response = await axios.get('https://gnews.io/api/v4/top-headlines', {
      params: {
        token: '973de7360b49225b484c14a98fcc0a7f',
        lang: 'en',
        max: 10
      }
    });

    if (response.data && response.data.articles) {
      const articles = response.data.articles.slice(0, 5); // Get first 5 articles
      
      // Generate a unique batch ID for this set of news (timestamp)
      const batchId = new Date().toISOString();
      
      // Insert articles one by one with error handling
      console.log(`Storing ${articles.length} articles with batch ID: ${batchId}`);
      
      for (const article of articles) {
        const newsId = await new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO news (title, description, url, image, publishedAt, source, batch_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              article.title || 'No Title',
              article.description || '',
              article.url || '',
              article.image || '',
              article.publishedAt || new Date().toISOString(),
              article.source?.name || 'Unknown',
              batchId
            ],
            function(err) {
              if (err) {
                console.error('Error inserting article:', err);
                reject(err);
              } else {
                resolve(this.lastID);
              }
            }
          );
        }).catch(err => {
          console.error('Promise rejected:', err);
          return null;
        });
        
        if (newsId) {
          try {
            // Generate TTS audio for this news item
            const textToSpeak = `${article.title}. ${article.description || ''}`;
            await generateTtsAudio(textToSpeak, newsId);
          } catch (error) {
            console.error(`Failed to generate TTS for news ID ${newsId}:`, error);
          }
        }
      }
      
      console.log('News data stored in database with batch ID:', batchId);
    }
  } catch (error) {
    console.error('Error fetching or storing news:', error);
  }
}

// Add a TTS web interface route
app.get('/tts', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Simple Text-to-Speech</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
          form { max-width: 500px; margin: 0 auto; }
          textarea { width: 100%; height: 150px; padding: 10px; margin-bottom: 15px; }
          button { padding: 10px 15px; background: #4CAF50; color: white; border: none; cursor: pointer; }
          button:hover { background: #45a049; }
          select { padding: 8px; margin-bottom: 15px; }
          .audio-files { margin-top: 50px; max-width: 700px; margin: 40px auto; }
          .file-list { list-style: none; padding: 0; }
          .file-list li { padding: 15px; border-bottom: 1px solid #eee; display: flex; align-items: center; flex-wrap: wrap; }
          .file-name { margin-right: 10px; flex: 1; }
          audio { margin: 0 10px; }
          .download-btn { 
            display: inline-block; 
            padding: 8px 15px; 
            background: #2196F3; 
            color: white; 
            text-decoration: none; 
            border-radius: 4px;
          }
          a.home-btn {
            display: inline-block;
            padding: 10px 15px;
            background: #607D8B;
            color: white;
            text-decoration: none;
            border-radius: 4px;
            margin-bottom: 20px;
          }
        </style>
      </head>
      <body>
        <a href="/" class="home-btn">Back to News</a>
        <h1>Simple Text-to-Speech</h1>
        <form action="/api/tts/convert" method="post">
          <div>
            <label for="text">Enter text to convert:</label>
            <textarea id="text" name="text" required></textarea>
          </div>
          <div>
            <label for="lang">Select language:</label>
            <select id="lang" name="lang">
              <option value="en">English</option>
              <option value="fr">French</option>
              <option value="es">Spanish</option>
              <option value="de">German</option>
              <option value="it">Italian</option>
              <option value="ja">Japanese</option>
            </select>
          </div>
          <div>
            <button type="submit">Convert to Speech</button>
          </div>
        </form>
      </body>
    </html>
  `);
});

// API endpoint to convert text to speech directly
app.post('/api/tts/convert', async (req, res) => {
  try {
    let body = '';
    
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', async () => {
      try {
        const formData = parse(body);
        const text = formData.text || '';
        const lang = formData.lang || 'en';
        
        if (!text) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Text is required');
          return;
        }
        
        // Split text into chunks (Google TTS has a character limit)
        const MAX_CHARS = 200;
        const textChunks = [];
        
        for (let i = 0; i < text.length; i += MAX_CHARS) {
          textChunks.push(text.substring(i, i + MAX_CHARS));
        }
        
        // Create unique filename
        const timestamp = Date.now();
        const fileName = `speech_${timestamp}.mp3`;
        const outputFile = path.join(audioDir, fileName);
        
        // Create a temporary directory for chunks
        const tempDir = path.join(audioDir, `temp_${timestamp}`);
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir);
        }
        
        // Download each chunk
        for (let i = 0; i < textChunks.length; i++) {
          const chunk = textChunks[i];
          const encodedText = encodeURIComponent(chunk);
          const url = `http://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodedText}`;
          const chunkFile = path.join(tempDir, `chunk_${i}.mp3`);
          
          await downloadFile(url, chunkFile);
        }
        
        // Combine all MP3 files
        const outputStream = fs.createWriteStream(outputFile);
        
        for (let i = 0; i < textChunks.length; i++) {
          const chunkFile = path.join(tempDir, `chunk_${i}.mp3`);
          const chunkData = fs.readFileSync(chunkFile);
          outputStream.write(chunkData);
        }
        
        outputStream.end();
        
        // Wait for the file to be written
        await new Promise(resolve => {
          outputStream.on('finish', resolve);
        });
        
        // Clean up temp files
        for (let i = 0; i < textChunks.length; i++) {
          fs.unlinkSync(path.join(tempDir, `chunk_${i}.mp3`));
        }
        fs.rmdirSync(tempDir);
        
        // Send response with audio player and download link
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <head>
              <title>Your TTS Result</title>
              <style>
                body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; text-align: center; }
                .container { max-width: 600px; margin: 0 auto; }
                audio { width: 100%; margin: 20px 0; }
                .download-btn { 
                  display: inline-block; 
                  padding: 10px 20px; 
                  background: #2196F3; 
                  color: white; 
                  text-decoration: none; 
                  border-radius: 4px;
                  margin-right: 10px;
                }
                .back-btn {
                  display: inline-block; 
                  padding: 10px 20px; 
                  background: #607D8B; 
                  color: white; 
                  text-decoration: none; 
                  border-radius: 4px;
                }
              </style>
            </head>
            <body>
              <div class="container">
                <h1>Your Text-to-Speech Result</h1>
                <p>Listen to your converted speech:</p>
                
                <audio controls autoplay>
                  <source src="/audio/${fileName}" type="audio/mpeg">
                  Your browser does not support the audio element.
                </audio>
                
                <div>
                  <a href="/audio/${fileName}" download class="download-btn">Download MP3</a>
                  <a href="/tts" class="back-btn">Convert Another</a>
                </div>
              </div>
            </body>
          </html>
        `);
      } catch (error) {
        console.error('Error:', error);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error: ' + error.message);
      }
    });
  } catch (error) {
    console.error('Error in TTS conversion endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API endpoint to get the latest news
app.get('/api/news/latest', (req, res) => {
  // Get the latest batch of news
  db.all(`
    SELECT n.*, t.audio_path as tts_audio_path 
    FROM news n
    LEFT JOIN tts_audio t ON n.id = t.news_id
    WHERE n.batch_id = (SELECT batch_id FROM news ORDER BY fetched_at DESC LIMIT 1)
    ORDER BY n.id ASC
  `, (err, rows) => {
    if (err) {
      console.error('Error retrieving latest news:', err);
      return res.status(500).json({ error: 'Failed to retrieve news' });
    }
    
    res.json({ articles: rows });
  });
});

// API endpoint to get all available batches
app.get('/api/news/batches', (req, res) => {
  db.all(`
    SELECT batch_id, MIN(fetched_at) as fetch_time, COUNT(*) as article_count
    FROM news
    GROUP BY batch_id
    ORDER BY fetch_time DESC
  `, (err, rows) => {
    if (err) {
      console.error('Error retrieving news batches:', err);
      return res.status(500).json({ error: 'Failed to retrieve news batches' });
    }
    
    // Format the dates for better display
    const batches = rows.map(batch => {
      return {
        ...batch,
        fetch_time_formatted: new Date(batch.fetch_time).toLocaleString()
      };
    });
    
    res.json({ batches });
  });
});

// API endpoint to get news by batch_id
app.get('/api/news/batch/:batchId', (req, res) => {
  const batchId = req.params.batchId;
  
  db.all(`
    SELECT n.*, t.audio_path as tts_audio_path 
    FROM news n
    LEFT JOIN tts_audio t ON n.id = t.news_id
    WHERE n.batch_id = ?
    ORDER BY n.id ASC
  `, [batchId], (err, rows) => {
    if (err) {
      console.error('Error retrieving news by batch:', err);
      return res.status(500).json({ error: 'Failed to retrieve news batch' });
    }
    
    res.json({ articles: rows });
  });
});

// API endpoint to generate TTS audio for a news item
app.post('/api/tts/generate', async (req, res) => {
  try {
    const { newsId, text } = req.body;
    
    if (!newsId || !text) {
      return res.status(400).json({ error: 'Missing required parameters: newsId and text' });
    }
    
    // Check if TTS audio already exists for this news item
    db.get('SELECT audio_path FROM tts_audio WHERE news_id = ?', [newsId], async (err, row) => {
      if (err) {
        console.error('Error checking for existing TTS audio:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (row) {
        // TTS audio already exists
        return res.json({ audioPath: row.audio_path, existed: true });
      }
      
      try {
        // Generate new TTS audio
        const audioPath = await generateTtsAudio(text, newsId);
        res.json({ audioPath, existed: false });
      } catch (error) {
        console.error('Error in TTS generation:', error);
        res.status(500).json({ error: 'Failed to generate TTS audio' });
      }
    });
  } catch (error) {
    console.error('Error in TTS generation endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Schedule news fetch every 3 hours
cron.schedule('0 */3 * * *', () => {
   console.log(`Minute cron check at ${new Date().toISOString()}`);
   console.log(`Cron job triggered at ${new Date().toISOString()}`);
   fetchAndStoreNews();
});

app.get('/api/system/last-update', (req, res) => {
  db.get(`
    SELECT MAX(fetched_at) as last_update 
    FROM news
  `, (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    const now = new Date();
    const lastUpdate = row.last_update ? new Date(row.last_update) : null;
    const hoursSinceUpdate = lastUpdate 
      ? ((now - lastUpdate) / (1000 * 60 * 60)).toFixed(2) 
      : 'never';
    
    res.json({
      last_update: lastUpdate,
      hours_since_update: hoursSinceUpdate,
      current_server_time: now,
      cron_schedule: '0 */3 * * *'
    });
  });
});

// Index page - modified to include download buttons for audio files
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initial fetch when server starts - but wait for DB initialization
setTimeout(() => {
  fetchAndStoreNews();
}, 2000);

// Add this cron job to delete audio files older than 2 days
cron.schedule('0 0 * * *', () => {
  console.log(`Running audio cleanup at ${new Date().toISOString()}`);
  
  // Calculate the cutoff time (2 days ago)
  const cutoffTime = new Date();
  cutoffTime.setDate(cutoffTime.getDate() - 2);
  
  // Get a list of all files in the audio directory
  fs.readdir(audioDir, (err, files) => {
    if (err) {
      console.error('Error reading audio directory:', err);
      return;
    }
    
    files.forEach(file => {
      // Skip directories
      const filePath = path.join(audioDir, file);
      const stats = fs.statSync(filePath);
      
      if (!stats.isDirectory() && stats.isFile() && path.extname(file) === '.mp3') {
        // Check if file is older than 2 days
        if (stats.mtime < cutoffTime) {
          // Delete the file
          fs.unlink(filePath, (unlinkErr) => {
            if (unlinkErr) {
              console.error(`Error deleting ${file}:`, unlinkErr);
            } else {
              console.log(`Deleted old audio file: ${file}`);
              
              // Optionally update the database to mark this audio as deleted
              const audioPath = `/audio/${file}`;
              db.run('DELETE FROM tts_audio WHERE audio_path = ?', [audioPath], (dbErr) => {
                if (dbErr) {
                  console.error('Error updating database after file deletion:', dbErr);
                }
              });
            }
          });
        }
      }
    });
  });
});

// Add this near your other cron job in server.js

// Add this cron job to delete audio files older than, e.g., 2 days
cron.schedule('0 0 * * *', () => { // Runs daily at midnight
  console.log(`Running audio cleanup task at ${new Date().toISOString()}`);

  const cutoffDays = 2; // Keep audio files for 2 days
  const cutoffTime = new Date();
  cutoffTime.setDate(cutoffTime.getDate() - cutoffDays);

  // Get a list of all files in the audio directory
  fs.readdir(audioDir, (err, files) => {
    if (err) {
      console.error('Error reading audio directory for cleanup:', err);
      return;
    }

    files.forEach(file => {
      const filePath = path.join(audioDir, file);

      // Make sure it's an mp3 file and not a directory (like the temp ones)
      if (path.extname(file).toLowerCase() === '.mp3') {
        fs.stat(filePath, (statErr, stats) => {
          if (statErr) {
            console.error(`Error getting stats for ${file}:`, statErr);
            return;
          }

  
          // Check if file modification time is older than the cutoff
          if (stats.mtime < cutoffTime) {
            console.log(`Deleting old audio file: ${file} (modified: ${stats.mtime})`);

            // Delete the file
            fs.unlink(filePath, (unlinkErr) => {
              if (unlinkErr) {
                console.error(`Error deleting file ${file}:`, unlinkErr);
              } else {
                console.log(`Successfully deleted file: ${file}`);

                // Now, delete the corresponding entry from the tts_audio table
                const audioPathToDelete = `/audio/${file}`;
                db.run('DELETE FROM tts_audio WHERE audio_path = ?', [audioPathToDelete], (dbErr) => {
                  if (dbErr) {
                    console.error(`Error deleting DB entry for ${audioPathToDelete}:`, dbErr);
                  } else {
                    console.log(`Successfully deleted DB entry for ${audioPathToDelete}`);
                  }
                });
              }
            });
          }
        });
      }
    });
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});