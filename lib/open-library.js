/**
 * Open Library API integration.
 * Searches for a book by name/author string and returns:
 * - description (from the work's details)
 * - coverUrl (medium-size cover image)
 *
 * If nothing is found, returns null for each field.
 * Uses Node's built-in fetch (available in Node 18+).
 */

const SEARCH_URL = 'https://openlibrary.org/search.json';
const WORKS_URL = 'https://openlibrary.org';
const COVER_URL = 'https://covers.openlibrary.org/b/id';

/**
 * Search Open Library for a book and retrieve its description and cover.
 * @param {string} query - The book name and author as a single string
 * @returns {Promise<{description: string|null, coverUrl: string|null}>}
 */
async function searchBook(query) {
  // Search for the book
  const searchParams = new URLSearchParams({
    q: query,
    limit: '1',
    fields: 'key,title,author_name,cover_i,first_sentence'
  });

  const searchRes = await fetch(`${SEARCH_URL}?${searchParams}`);
  if (!searchRes.ok) {
    throw new Error(`Open Library search failed: ${searchRes.status}`);
  }

  const searchData = await searchRes.json();

  if (!searchData.docs || searchData.docs.length === 0) {
    return { description: null, coverUrl: null };
  }

  const book = searchData.docs[0];

  // Get cover URL if a cover ID exists
  let coverUrl = null;
  if (book.cover_i) {
    coverUrl = `${COVER_URL}/${book.cover_i}-M.jpg`;
  }

  // Try to get a fuller description from the work's detail page
  let description = null;

  if (book.key) {
    try {
      const workRes = await fetch(`${WORKS_URL}${book.key}.json`);
      if (workRes.ok) {
        const workData = await workRes.json();

        if (workData.description) {
          // Description can be a string or an object with a "value" key
          description = typeof workData.description === 'string'
            ? workData.description
            : workData.description.value || null;
        }
      }
    } catch (err) {
      console.error('Failed to fetch work details:', err.message);
    }
  }

  // Fall back to first_sentence from search results if no work description
  if (!description && book.first_sentence) {
    description = Array.isArray(book.first_sentence)
      ? book.first_sentence[0]
      : book.first_sentence;
  }

  return { description, coverUrl };
}

module.exports = { searchBook };
