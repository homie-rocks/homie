/** Complete local schema and subscriptions before any request can emit an event. */
export async function prepareLocalDatabase({migrate,register}) {
  if(!await migrate())return 'Local database migration failed; fix the D1 error above before serving requests.';
  if(!await register())return 'Local function registration failed; fix the D1 error above before serving requests.';
  return null;
}
