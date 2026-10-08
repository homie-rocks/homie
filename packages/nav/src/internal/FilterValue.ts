/** The mesh runtime registers its singleton. Grid-only imports have no backend. */
export let queryFilter: unknown;
export function registerQueryFilter(value: unknown): void {
  queryFilter = value;
}
