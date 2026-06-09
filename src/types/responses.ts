/* ProVinyl — HTTP response envelopes that aren't a bare Release. */

import type { Release } from './release';

export interface Pagination {
  page: number;
  pages: number;
  per_page: number;
  items: number;
}

export interface SearchResponse {
  results: Release[];
  pagination: Pagination;
}
