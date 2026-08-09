// Submit a vote
export async function onRequestPost(context) {
  const { request, env } = context;
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
