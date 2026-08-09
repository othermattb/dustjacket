// Get next proposal to vote on (most recent first, excluding already-voted)
export async function onRequestGet(context) {
  const { request, env } = context;
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
