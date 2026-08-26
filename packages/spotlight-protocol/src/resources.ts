export type SpotlightResourceStatus = "online" | "offline" | "unknown";

export interface SpotlightResourceRef<
  TMetadata extends Record<string, unknown> = Record<string, unknown>,
> {
  namespace: string;
  id: string;
  name: string;
  aliases?: string[];
  summary?: string;
  status?: SpotlightResourceStatus;
  metadata?: TMetadata;
}

export interface SpotlightResourceSearchInput {
  /** Omit or leave blank to list the current resource collection. */
  query?: string;
  limit?: number;
  cursor?: string;
  filters?: Record<string, unknown>;
}

export interface SpotlightResourceSearchResult<
  TResource extends SpotlightResourceRef = SpotlightResourceRef,
> {
  items: TResource[];
  nextCursor?: string;
  total?: number;
}
