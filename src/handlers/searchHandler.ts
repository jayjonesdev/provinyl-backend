import { Response } from 'express';
import { AuthRequest } from '../types';
import { createUserClientFor, createAppClient } from '../services/discogsService';
import { searchResultToRelease, mapPagination } from '../utils/toRelease';
import { fail } from '../utils/httpError';
import logger from '../utils/logger';
import type { SearchQuery } from '../validators';

// Discogs search-type → entity-type filter. Most map to release search.
const TYPE_ENTITY: Record<SearchQuery['type'], string> = {
  title: 'release',
  artist: 'release',
  label: 'label',
  catno: 'release',
  barcode: 'release',
  track: 'release',
};

// Types that map to a dedicated Discogs param rather than the free-text `q`.
const DEDICATED_PARAM = new Set<SearchQuery['type']>(['artist', 'label', 'catno', 'barcode', 'track']);

// GET /api/v1/search?q=&type=title|artist|label|catno|barcode|track&page=&per_page=
export async function search(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { q, type, page, per_page } = req.valid!.query as SearchQuery;

    const searchParams: Record<string, string | number> = {
      type: TYPE_ENTITY[type],
      page,
      per_page,
    };
    // Dedicated-param types pass the term under their own key; title goes as `q`.
    if (DEDICATED_PARAM.has(type)) searchParams[type] = q;

    // Fetch the user's wantlist ids so results can be flagged (non-fatal).
    let wantlistIds = new Set<number>();
    if (req.user) {
      try {
        const wantlistData = await createUserClientFor(req.user).getWantlist(req.user.username, 1, 100);
        wantlistIds = new Set((wantlistData.wants ?? []).map((w) => w.id));
      } catch {
        // in_wantlist stays false if this fails
      }
    }

    const client = req.user ? createUserClientFor(req.user) : createAppClient();
    const freeText = DEDICATED_PARAM.has(type) ? '' : q;
    const data = await client.searchDatabase(freeText, searchParams);

    res.json({
      results: (data.results ?? []).map((r) => searchResultToRelease(r, wantlistIds.has(r.id))),
      pagination: mapPagination(data.pagination),
    });
  } catch (err) {
    logger.error({ err }, 'Search failed');
    fail(res, 502, 'discogs_error', 'Search failed');
  }
}
