// Get all recommendations with vote counts
export async function onRequestGet(context) {
  const { env } = context;

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
