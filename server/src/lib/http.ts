export function apiError(status: number, code: string, message: string): Response {
  return Response.json({ error: code, message }, { status });
}

export function notFoundResponse(): Response {
  return apiError(404, 'not_found', 'The requested resource was not found.');
}
