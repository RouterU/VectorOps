import { neon } from '@neondatabase/serverless';

const connectionString = process.env.VECTOROPS_DB_DATABASE_URL;

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.send(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { error: 'Method not allowed' });
  }

  if (!connectionString) {
    return json(res, 500, { error: 'Database connection is not configured.' });
  }

  const sql = neon(connectionString);

  try {
    const rows = await sql`
      SELECT
        r.id AS route_id,
        r.route_number,
        r.route_name,
        r.route_date,
        r.driver_name,
        r.status,
        r.actual_start,
        r.actual_finish,
        r.updated_at,
        COALESCE(stop_counts.total_stops, 0)::int AS total_stops,
        COALESCE(stop_counts.completed_stops, 0)::int AS completed_stops,
        current_stop.id AS current_stop_id,
        current_stop.sequence AS current_stop_sequence,
        current_stop.customer AS current_stop_customer,
        current_stop.status AS current_stop_status,
        last_event.event_type AS last_event_type,
        last_event.created_at AS last_event_at
      FROM routes r
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) AS total_stops,
          COUNT(*) FILTER (WHERE status = 'COMPLETE') AS completed_stops
        FROM route_stops rs
        WHERE rs.route_id = r.id
      ) stop_counts ON TRUE
      LEFT JOIN LATERAL (
        SELECT rs.id, rs.sequence, rs.customer, rs.status
        FROM route_stops rs
        WHERE rs.route_id = r.id
          AND rs.status <> 'COMPLETE'
        ORDER BY
          CASE WHEN rs.status = 'ARRIVED' THEN 0 ELSE 1 END,
          rs.sequence ASC,
          rs.id ASC
        LIMIT 1
      ) current_stop ON TRUE
      LEFT JOIN LATERAL (
        SELECT re.event_type, re.created_at
        FROM route_events re
        WHERE re.route_id = r.id
        ORDER BY re.created_at DESC, re.id DESC
        LIMIT 1
      ) last_event ON TRUE
      ORDER BY r.updated_at DESC, r.created_at DESC
      LIMIT 500
    `;

    return json(res, 200, {
      ok: true,
      routes: rows.map(row => ({
        routeId: row.route_id,
        routeNumber: row.route_number || '',
        routeName: row.route_name || 'Route',
        routeDate: row.route_date ? String(row.route_date).slice(0, 10) : '',
        driverName: row.driver_name || '',
        status: row.status || 'ASSIGNED',
        actualStart: row.actual_start || null,
        actualFinish: row.actual_finish || null,
        updatedAt: row.updated_at || null,
        totalStops: Number(row.total_stops) || 0,
        completedStops: Number(row.completed_stops) || 0,
        currentStop: row.current_stop_id ? {
          id: row.current_stop_id,
          sequence: row.current_stop_sequence,
          customer: row.current_stop_customer || 'Stop',
          status: row.current_stop_status || 'PENDING'
        } : null,
        lastEventType: row.last_event_type || null,
        lastEventAt: row.last_event_at || null
      }))
    });
  } catch (error) {
    console.error('route-status error', error);
    return json(res, 500, {
      error: 'Could not load live route status.',
      detail: error?.message || String(error)
    });
  }
}
