export const dynamic = 'force-static';

/** Healthcheck do Railway. */
export function GET() {
  return Response.json({ status: 'ok', service: 'site' });
}
