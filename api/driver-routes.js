import { neon } from '@neondatabase/serverless';

const connectionString = process.env.VECTOROPS_DB_DATABASE_URL;

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(body));
}

function routePackage(route, stops) {
  return {
    routeId: route.id,
    routeNumber: route.route_number || '',
    routeName: route.route_name || 'Route',
    routeDate: route.route_date ? String(route.route_date).slice(0, 10) : '',
    driver: route.driver_name || '',
    status: route.status || 'ASSIGNED',
    plannedStart: route.planned_start || '',
    plannedFinish: route.planned_finish || '',
    totalMiles: Number(route.total_miles) || 0,
    totalCases: Number(route.total_cases) || 0,
    actualStart: route.actual_start || null,
    actualFinish: route.actual_finish || null,
    stops: stops.map(stop => ({
      id: stop.id,
      sequence: stop.sequence,
      customer: stop.customer || 'Stop',
      locationKey: stop.location_key || '',
      address: stop.address || '',
      cases: Number(stop.cases) || 0,
      window: stop.window_text || '',
      plannedArrival: stop.planned_arrival || '',
      plannedServiceMinutes: Number(stop.planned_service_minutes) || 0,
      lat: stop.latitude === null ? null : Number(stop.latitude),
      lng: stop.longitude === null ? null : Number(stop.longitude),
      status: stop.status || 'PENDING',
      actualArrival: stop.actual_arrival || null,
      actualDeparture: stop.actual_departure || null
    }))
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { error: 'Method not allowed' });
  }
  if (!connectionString) return json(res, 500, { error: 'Database connection is not configured.' });

  const driver = String(req.query.driver || '').trim();
  const routeId = String(req.query.routeId || '').trim();
  if (!driver && !routeId) return json(res, 400, { error: 'driver or routeId is required.' });

  const sql = neon(connectionString);

  try {
    let routeRows;
    if (routeId) {
      routeRows = await sql`
        SELECT * FROM routes
        WHERE id = ${routeId}
        LIMIT 1
      `;
    } else {
      routeRows = await sql`
        SELECT * FROM routes
        WHERE LOWER(driver_name) = LOWER(${driver})
          AND status <> 'COMPLETE'
        ORDER BY route_date ASC NULLS LAST, created_at DESC
      `;
    }

    const output = [];
    for (const route of routeRows) {
      const stopRows = await sql`
        SELECT * FROM route_stops
        WHERE route_id = ${route.id}
        ORDER BY sequence ASC, id ASC
      `;
      output.push(routePackage(route, stopRows));
    }

    return json(res, 200, { ok: true, routes: output });
  } catch (error) {
    console.error('driver-routes error', error);
    return json(res, 500, { error: 'Could not load driver routes.', detail: error?.message || String(error) });
  }
}
