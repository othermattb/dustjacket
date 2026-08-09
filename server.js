require('dotenv').config();
const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const { searchGoogleBooks } = require('./lib/google-books');
const { searchBook } = require('./lib/open-library');

const app = express();
const PORT = 3000;

// --- Database setup ---
const db = new Database(path.join(__dirname, 'books.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS recommendations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_name_author TEXT NOT NULL,
    user_reason TEXT,
    fetched_title TEXT,
    fetched_authors TEXT,
    fetched_description TEXT,
    cover_url TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// Migrate: add fetched_title and fetched_authors if they don't exist
try {
  db.exec(`ALTER TABLE recommendations ADD COLUMN fetched_title TEXT`);
} catch (e) { /* column already exists */ }
try {
  db.exec(`ALTER TABLE recommendations ADD COLUMN fetched_authors TEXT`);
} catch (e) { /* column already exists */ }
try {
  db.exec(`ALTER TABLE recommendations ADD COLUMN submitted_by TEXT`);
} catch (e) { /* column already exists */ }

db.exec(`
  CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recommendation_id INTEGER NOT NULL,
    voter_id TEXT NOT NULL,
    vote TEXT NOT NULL CHECK(vote IN ('interested', 'skip', 'not_interested')),
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (recommendation_id) REFERENCES recommendations(id),
    UNIQUE(recommendation_id, voter_id)
  )
`);

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Routes ---

// Serve the form
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve the proposals viewer
app.get('/proposals', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'proposals.html'));
});

// Legacy voting page URL — now the Vote toggle on the home page
app.get('/vote', (req, res) => {
  res.redirect('/?view=vote');
});

// Preview book info (for live lookup before submission)
app.get('/api/preview', async (req, res) => {
  const query = req.query.q;
  if (!query || !query.trim()) {
    return res.status(400).json({ error: 'Query is required.' });
  }

  let description = null;
  let coverUrl = null;
  let title = null;
  let authors = null;

  try {
    const googleData = await searchGoogleBooks(query.trim(), process.env.GOOGLE_BOOKS_API_KEY);
    if (googleData) {
      description = googleData.description || null;
      coverUrl = googleData.coverUrl || null;
      title = googleData.title || null;
      authors = googleData.authors || null;
    }
  } catch (err) {
    console.error('Google Books preview failed:', err.message);
  }

  if (!description || !coverUrl) {
    try {
      const openLibData = await searchBook(query.trim());
      if (openLibData) {
        if (!description) description = openLibData.description || null;
        if (!coverUrl) coverUrl = openLibData.coverUrl || null;
      }
    } catch (err) {
      console.error('Open Library preview failed:', err.message);
    }
  }

  res.json({ title, authors, description, coverUrl });
});

// Handle form submission
app.post('/api/recommend', async (req, res) => {
  const { bookNameAuthor, userReason, voterId, skipLookup } = req.body;

  if (!bookNameAuthor || !bookNameAuthor.trim()) {
    return res.status(400).json({ error: 'Book name and author is required.' });
  }

  // Fetch book info — try Google Books first, fall back to Open Library
  let fetchedDescription = null;
  let coverUrl = null;
  let fetchedTitle = null;
  let fetchedAuthors = null;

  if (!skipLookup) {
    try {
      const googleData = await searchGoogleBooks(bookNameAuthor.trim(), process.env.GOOGLE_BOOKS_API_KEY);
      if (googleData) {
        fetchedDescription = googleData.description || null;
        coverUrl = googleData.coverUrl || null;
        fetchedTitle = googleData.title || null;
        fetchedAuthors = googleData.authors || null;
      }
    } catch (err) {
      console.error('Google Books lookup failed:', err.message);
    }

    // Fall back to Open Library if Google Books didn't return results
    if (!fetchedDescription || !coverUrl) {
      try {
        const openLibData = await searchBook(bookNameAuthor.trim());
        if (openLibData) {
          if (!fetchedDescription) fetchedDescription = openLibData.description || null;
          if (!coverUrl) coverUrl = openLibData.coverUrl || null;
        }
      } catch (err) {
        console.error('Open Library lookup failed:', err.message);
      }
    }
  }

  // Save to database
  const stmt = db.prepare(`
    INSERT INTO recommendations (book_name_author, user_reason, fetched_title, fetched_authors, fetched_description, cover_url, submitted_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    bookNameAuthor.trim(),
    userReason?.trim() || null,
    fetchedTitle,
    fetchedAuthors,
    fetchedDescription,
    coverUrl,
    voterId || null
  );

  res.json({
    success: true,
    recommendation: {
      id: result.lastInsertRowid,
      bookNameAuthor: bookNameAuthor.trim(),
      userReason: userReason?.trim() || null,
      fetchedTitle,
      fetchedAuthors,
      fetchedDescription,
      coverUrl
    }
  });
});

// Get all recommendations with vote counts
app.get('/api/recommendations', (req, res) => {
  const rows = db.prepare(`
    SELECT r.*,
      COALESCE(SUM(CASE WHEN v.vote = 'interested' THEN 1 ELSE 0 END), 0) AS votes_interested,
      COALESCE(SUM(CASE WHEN v.vote = 'not_interested' THEN 1 ELSE 0 END), 0) AS votes_not_interested
    FROM recommendations r
    LEFT JOIN votes v ON v.recommendation_id = r.id
    GROUP BY r.id
    ORDER BY r.created_at DESC
  `).all();
  res.json(rows);
});

// Get next proposal to vote on (most recent first, excluding already-voted)
app.get('/api/vote/next', (req, res) => {
  const voterId = req.query.voterId;
  if (!voterId) {
    return res.status(400).json({ error: 'voterId is required.' });
  }

  const row = db.prepare(`
    SELECT r.* FROM recommendations r
    WHERE r.id NOT IN (
      SELECT recommendation_id FROM votes WHERE voter_id = ?
    )
    AND (r.submitted_by IS NULL OR r.submitted_by != ?)
    ORDER BY r.created_at DESC
    LIMIT 1
  `).get(voterId, voterId);

  if (!row) {
    return res.json({ proposal: null });
  }

  res.json({ proposal: row });
});

// Submit a vote
app.post('/api/vote', (req, res) => {
  const { recommendationId, voterId, vote } = req.body;

  if (!recommendationId || !voterId || !vote) {
    return res.status(400).json({ error: 'recommendationId, voterId, and vote are required.' });
  }

  if (!['interested', 'skip', 'not_interested'].includes(vote)) {
    return res.status(400).json({ error: 'vote must be "interested", "skip", or "not_interested".' });
  }

  try {
    db.prepare(`
      INSERT INTO votes (recommendation_id, voter_id, vote)
      VALUES (?, ?, ?)
    `).run(recommendationId, voterId, vote);
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'Already voted on this proposal.' });
    }
    throw err;
  }

  res.json({ success: true });
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`Book recommendations app running at http://localhost:${PORT}`);
});
