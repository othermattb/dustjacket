const { searchGoogleBooks } = require('../../lib/google-books');
const { searchBook } = require('../../lib/open-library');

// Preview book info (for live lookup before submission)
export async function onRequestGet(context) {
  const { request, env } = context;
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
