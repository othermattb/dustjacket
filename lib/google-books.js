/**
 * Google Books API integration.
 * Searches for a book and returns description + cover image.
 * Requires a Google Books API key, passed in by the caller — Cloudflare
 * Pages Functions deliver it via env.GOOGLE_BOOKS_API_KEY (no process.env
 * global there), and local dev (server.js) passes process.env's copy.
 */

const GOOGLE_BOOKS_URL = 'https://www.googleapis.com/books/v1/volumes';

/**
 * Search Google Books for a book and retrieve its description and cover.
 * @param {string} query - The book name and author as a single string
 * @param {string} apiKey - Google Books API key
 * @returns {Promise<{description: string|null, coverUrl: string|null}>}
 */
async function searchGoogleBooks(query, apiKey) {
  if (!apiKey) {
    throw new Error('GOOGLE_BOOKS_API_KEY not configured');
  }

  const params = new URLSearchParams({
    q: query,
    maxResults: '1',
    key: apiKey
  });

  const res = await fetch(`${GOOGLE_BOOKS_URL}?${params}`);
  if (!res.ok) {
    throw new Error(`Google Books API error: ${res.status}`);
  }

  const data = await res.json();

  if (!data.items || data.items.length === 0) {
    return { description: null, coverUrl: null };
  }

  const volumeInfo = data.items[0].volumeInfo;

  // Get title and authors
  const title = volumeInfo.title || null;
  const authors = volumeInfo.authors ? volumeInfo.authors.join(', ') : null;

  // Get description
  const description = volumeInfo.description || null;

  // Get cover — prefer the "thumbnail" and upgrade to a larger size
  let coverUrl = null;
  if (volumeInfo.imageLinks) {
    // Google returns http URLs; upgrade to https and request a larger image
    coverUrl = volumeInfo.imageLinks.thumbnail
      || volumeInfo.imageLinks.smallThumbnail
      || null;

    if (coverUrl) {
      coverUrl = coverUrl.replace('http://', 'https://');
      // Remove zoom parameter and set to zoom=1 for a decent size
      coverUrl = coverUrl.replace(/&zoom=\d+/, '&zoom=1');
    }
  }

  return { title, authors, description, coverUrl };
}

module.exports = { searchGoogleBooks };
