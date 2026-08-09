const { searchGoogleBooks } = require('../../lib/google-books');
const { searchBook } = require('../../lib/open-library');

// Handle form submission
export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json();
  const { bookNameAuthor, userReason, voterId, skipLookup } = body;

  if (!bookNameAuthor || !bookNameAuthor.trim()) {
    return Response.json({ error: 'Book name and author is required.' }, { status: 400 });
  }

  // Fetch book info — try Google Books first, fall back to Open Library
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

  // Save to D1
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
