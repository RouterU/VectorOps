import { neon } from '@neondatabase/serverless';

const connectionString = process.env.VECTOROPS_DB_DATABASE_URL;

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

  const route = req.body || {};
  const routeId = String(route.routeId || '').trim();
  const driver = String(route.driver || '').trim();
  const stops = Array.isArray(route.stops) ? route.stops : [];

  if (!routeId) return json(res, 400, { error: 'routeId is required.' });
  if (!driver) return json(res, 400, { error: 'driver is required.' });
  if (!stops.length) return json(res, 400, { error: 'At least one stop is required.' });

  const sql = neon(connectionString);

  try {
    await sql`
      INSERT INTO routes (
        id, route_number, route_name, route_date, driver_name, status,
        planned_start, planned_finish, total_miles, total_cases,
        actual_start, actual_finish, created_at, updated_at
      ) VALUES (
        ${routeId},
        ${String(route.routeNumber || '')},
        ${String(route.routeName || 'Route')},
        ${route.routeDate || null},
        ${driver},
        'ASSIGNED',
        ${String(route.plannedStart || '')},
        ${String(route.plannedFinish || '')},
        ${Number(route.totalMiles) || 0},
        ${Number(route.totalCases) || 0},
        NULL, NULL, NOW(), NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        route_number = EXCLUDED.route_number,
        route_name = EXCLUDED.route_name,
        route_date = EXCLUDED.route_date,
        driver_name = EXCLUDED.driver_name,
        status = 'ASSIGNED',
        planned_start = EXCLUDED.planned_start,
        planned_finish = EXCLUDED.planned_finish,
        total_miles = EXCLUDED.total_miles,
        total_cases = EXCLUDED.total_cases,
        actual_start = NULL,
        actual_finish = NULL,
        updated_at = NOW()
    `;

    await sql`DELETE FROM route_stops WHERE route_id = ${routeId}`;

    for (const stop of stops) {
      const stopId = String(stop.id || `${routeId}-${stop.sequence || Date.now()}`);
      await sql`
        INSERT INTO route_stops (
          id, route_id, sequence, customer, location_key, address, cases,
          window_text, planned_arrival, planned_service_minutes,
          latitude, longitude, status, actual_arrival, actual_departure
        ) VALUES (
          ${stopId}, ${routeId}, ${Number(stop.sequence) || 0},
          ${String(stop.customer || 'Stop')}, ${String(stop.locationKey || '')},
          ${String(stop.address || '')}, ${Number(stop.cases) || 0},
          ${String(stop.window || '')}, ${String(stop.plannedArrival || '')},
          ${Number(stop.plannedServiceMinutes) || 0},
          ${Number.isFinite(Number(stop.lat)) ? Number(stop.lat) : null},
          ${Number.isFinite(Number(stop.lng)) ? Number(stop.lng) : null},
          'PENDING', NULL, NULL
        )
      `;
    }

    await sql`
      INSERT INTO route_events (route_id, stop_id, event_type, latitude, longitude)
      VALUES (${routeId}, NULL, 'ROUTE_ASSIGNED', NULL, NULL)
    `;

    return json(res, 200, {
      ok: true,
      routeId,
      driver,
      stopCount: stops.length,
      status: 'ASSIGNED'
    });
  } catch (error) {
    console.error('publish-route error', error);
    return json(res, 500, { error: 'Could not publish route.', detail: error?.message || String(error) });
  }
}
