// Single Worker entry point for the unified "Workers with assets" model.
// Cloudflare doesn't auto-route a functions/ directory here the way classic
// Pages did — this file handles every dynamic request, falling back to the
// ASSETS binding (env.ASSETS.fetch) for anything it doesn't explicitly own.

const { searchGoogleBooks } = require('./lib/google-books');
const { searchBook } = require('./lib/open-library');

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    // Preserve the old Express convenience routes.
    if (pathname === '/proposals' && method === 'GET') {
      const rewritten = new URL('/proposals.html', url);
      return env.ASSETS.fetch(new Request(rewritten, request));
    }
    if (pathname === '/decide' && method === 'GET') {
      const rewritten = new URL('/decide.html', url);
      return env.ASSETS.fetch(new Request(rewritten, request));
    }
    if (pathname === '/vote' && method === 'GET') {
      return Response.redirect(new URL('/?view=vote', url), 302);
    }

    if (pathname === '/api/preview' && method === 'GET') {
      return handlePreview(request, env);
    }
    if (pathname === '/api/recommend' && method === 'POST') {
      return handleRecommend(request, env);
    }
    if (pathname === '/api/recommendations' && method === 'GET') {
      return handleRecommendations(env);
    }
    if (pathname === '/api/vote/next' && method === 'GET') {
      return handleVoteNext(request, env);
    }
    if (pathname === '/api/vote' && method === 'POST') {
      return handleVote(request, env);
    }

    // Everything else: static files (index.html, proposals.html, etc.)
    return env.ASSETS.fetch(request);
  }
};

// --- Preview book info (for live lookup before submission) ---
async function handlePreview(request, env) {
  const url = new URL(request.url);
  const query = url.searchParams.get('q');

  if (!query || !query.trim()) {
    return Response.json({ error: 'Query is required.' }, { status: 400 });
  }

  let description = null;
  let coverUrl = null;
  let title = null;
  let authors = null;

  try {
    const googleData = await searchGoogleBooks(query.trim(), env.GOOGLE_BOOKS_API_KEY);
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

  return Response.json({ title, authors, description, coverUrl });
}

// --- Handle form submission ---
async function handleRecommend(request, env) {
  const body = await request.json();
  const { bookNameAuthor, userReason, voterId, skipLookup } = body;

  if (!bookNameAuthor || !bookNameAuthor.trim()) {
    return Response.json({ error: 'Book name and author is required.' }, { status: 400 });
  }

  let fetchedDescription = null;
  let coverUrl = null;
  let fetchedTitle = null;
  let fetchedAuthors = null;

  if (!skipLookup) {
    try {
      const googleData = await searchGoogleBooks(bookNameAuthor.trim(), env.GOOGLE_BOOKS_API_KEY);
      if (googleData) {
        fetchedDescription = googleData.description || null;
        coverUrl = googleData.coverUrl || null;
        fetchedTitle = googleData.title || null;
        fetchedAuthors = googleData.authors || null;
      }
    } catch (err) {
      console.error('Google Books lookup failed:', err.message);
    }

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

  const result = await env.DB.prepare(`
    INSERT INTO recommendations (book_name_author, user_reason, fetched_title, fetched_authors, fetched_description, cover_url, submitted_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    bookNameAuthor.trim(),
    userReason?.trim() || null,
    fetchedTitle,
    fetchedAuthors,
    fetchedDescription,
    coverUrl,
    voterId || null
  ).run();

  return Response.json({
    success: true,
    recommendation: {
      id: result.meta.last_row_id,
      bookNameAuthor: bookNameAuthor.trim(),
      userReason: userReason?.trim() || null,
      fetchedTitle,
      fetchedAuthors,
      fetchedDescription,
      coverUrl
    }
  });
}

// --- Get all recommendations with vote counts ---
async function handleRecommendations(env) {
  const { results } = await env.DB.prepare(`
    SELECT r.*,
      COALESCE(SUM(CASE WHEN v.vote = 'interested' THEN 1 ELSE 0 END), 0) AS votes_interested,
      COALESCE(SUM(CASE WHEN v.vote = 'not_interested' THEN 1 ELSE 0 END), 0) AS votes_not_interested
    FROM recommendations r
    LEFT JOIN votes v ON v.recommendation_id = r.id
    GROUP BY r.id
    ORDER BY r.created_at DESC
  `).all();

  return Response.json(results);
}

// --- Get next proposal to vote on ---
async function handleVoteNext(request, env) {
  const url = new URL(request.url);
  const voterId = url.searchParams.get('voterId');

  if (!voterId) {
    return Response.json({ error: 'voterId is required.' }, { status: 400 });
  }

  const row = await env.DB.prepare(`
    SELECT r.* FROM recommendations r
    WHERE r.id NOT IN (
      SELECT recommendation_id FROM votes WHERE voter_id = ?
    )
    AND (r.submitted_by IS NULL OR r.submitted_by != ?)
    ORDER BY r.created_at DESC
    LIMIT 1
  `).bind(voterId, voterId).first();

  if (!row) {
    return Response.json({ proposal: null });
  }

  return Response.json({ proposal: row });
}

// --- Submit a vote ---
async function handleVote(request, env) {
  const { recommendationId, voterId, vote } = await request.json();

  if (!recommendationId || !voterId || !vote) {
    return Response.json({ error: 'recommendationId, voterId, and vote are required.' }, { status: 400 });
  }

  if (!['interested', 'skip', 'not_interested'].includes(vote)) {
    return Response.json({ error: 'vote must be "interested", "skip", or "not_interested".' }, { status: 400 });
  }

  try {
    await env.DB.prepare(`
      INSERT INTO votes (recommendation_id, voter_id, vote)
      VALUES (?, ?, ?)
    `).bind(recommendationId, voterId, vote).run();
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return Response.json({ error: 'Already voted on this proposal.' }, { status: 409 });
    }
    throw err;
  }

  return Response.json({ success: true });
}
