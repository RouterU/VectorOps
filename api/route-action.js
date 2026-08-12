import { neon } from '@neondatabase/serverless';

const connectionString = process.env.VECTOROPS_DB_DATABASE_URL;
const VALID_ACTIONS = new Set(['START_ROUTE', 'ARRIVED', 'COMPLETE_STOP', 'COMPLETE_ROUTE']);

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'Method not allowed' });
  }
  if (!connectionString) return json(res, 500, { error: 'Database connection is not configured.' });

  const body = req.body || {};
  const routeId = String(body.routeId || '').trim();
  const stopId = body.stopId ? String(body.stopId).trim() : null;
  const action = String(body.action || '').trim().toUpperCase();
  const lat = Number.isFinite(Number(body.latitude)) ? Number(body.latitude) : null;
  const lng = Number.isFinite(Number(body.longitude)) ? Number(body.longitude) : null;

  if (!routeId) return json(res, 400, { error: 'routeId is required.' });
  if (!VALID_ACTIONS.has(action)) return json(res, 400, { error: 'Invalid action.' });
  if ((action === 'ARRIVED' || action === 'COMPLETE_STOP') && !stopId) {
    return json(res, 400, { error: 'stopId is required for this action.' });
  }

  const sql = neon(connectionString);

  try {
    if (action === 'START_ROUTE') {
      await sql`
        UPDATE routes
        SET status = 'IN_PROGRESS', actual_start = COALESCE(actual_start, NOW()), updated_at = NOW()
        WHERE id = ${routeId}
      `;
    }

    if (action === 'ARRIVED') {
      await sql`
        UPDATE route_stops
        SET status = 'ARRIVED', actual_arrival = COALESCE(actual_arrival, NOW())
        WHERE id = ${stopId} AND route_id = ${routeId}
      `;
      await sql`UPDATE routes SET status = 'IN_PROGRESS', updated_at = NOW() WHERE id = ${routeId}`;
    }

    if (action === 'COMPLETE_STOP') {
      await sql`
        UPDATE route_stops
        SET status = 'COMPLETE',
            actual_arrival = COALESCE(actual_arrival, NOW()),
            actual_departure = COALESCE(actual_departure, NOW())
        WHERE id = ${stopId} AND route_id = ${routeId}
      `;

      const remaining = await sql`
        SELECT COUNT(*)::int AS count
        FROM route_stops
        WHERE route_id = ${routeId} AND status <> 'COMPLETE'
      `;
      if ((remaining[0]?.count || 0) === 0) {
        await sql`
          UPDATE routes
          SET status = 'COMPLETE', actual_finish = COALESCE(actual_finish, NOW()), updated_at = NOW()
          WHERE id = ${routeId}
        `;
      } else {
        await sql`UPDATE routes SET status = 'IN_PROGRESS', updated_at = NOW() WHERE id = ${routeId}`;
      }
    }

    if (action === 'COMPLETE_ROUTE') {
      await sql`
        UPDATE routes
        SET status = 'COMPLETE', actual_finish = COALESCE(actual_finish, NOW()), updated_at = NOW()
        WHERE id = ${routeId}
      `;
    }

    await sql`
      INSERT INTO route_events (route_id, stop_id, event_type, latitude, longitude)
      VALUES (${routeId}, ${stopId}, ${action}, ${lat}, ${lng})
    `;

    const routeRows = await sql`SELECT status, actual_start, actual_finish FROM routes WHERE id = ${routeId} LIMIT 1`;
    return json(res, 200, { ok: true, routeId, stopId, action, route: routeRows[0] || null });
  } catch (error) {
    console.error('route-action error', error);
    return json(res, 500, { error: 'Could not update route.', detail: error?.message || String(error) });
  }
}
