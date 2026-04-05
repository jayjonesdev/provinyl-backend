import { Response } from 'express';
import { AuthRequest } from '../types';
import { createUserClient, createAppClient } from '../services/discogsService';
import { normalizeSearchResult, normalizePagination } from '../utils/normalize';
import logger from '../utils/logger';

// Search type → Discogs params mapping
const TYPE_PARAMS: Record<string, Record<string, string>> = {
  title:   { type: 'release' },
  artist:  { type: 'release' },
  label:   { type: 'label' },
  catno:   { type: 'release' },
  barcode: { type: 'release' },
  track:   { type: 'release' },
};

// GET /api/v1/search?q=...&type=title|artist|label|catno|barcode|track&page=1
export async function search(req: AuthRequest, res: Response): Promise<void> {
  try {
    const q = ((req.query['q'] as string) ?? '').trim();
    const type = ((req.query['type'] as string) ?? 'title').toLowerCase();
    const page = parseInt((req.query['page'] as string) ?? '1', 10);
    const perPage = Math.min(parseInt((req.query['per_page'] as string) ?? '25', 10), 50);

    if (!q) {
      res.status(400).json({ error: 'Query parameter q is required' });
      return;
    }

    const extraParams = TYPE_PARAMS[type] ?? TYPE_PARAMS['title'];

    // Build the search params — some types use a dedicated param key
    const searchParams: Record<string, string | number> = {
      ...extraParams,
      page,
      per_page: perPage,
    };

    if (type === 'artist')  searchParams['artist'] = q;
    else if (type === 'label')   searchParams['label'] = q;
    else if (type === 'catno')   searchParams['catno'] = q;
    else if (type === 'barcode') searchParams['barcode'] = q;
    else if (type === 'track')   searchParams['track'] = q;
    // title / default: q goes as the free-text query (passed as first arg)

    // Fetch wantlist IDs for the authenticated user so we can set in_wantlist
    let wantlistIds = new Set<number>();
    if (req.user) {
      try {
        const userClient = createUserClient(
          req.user.discogsAccessToken,
          req.user.discogsAccessTokenSecret,
        );
        // Fetch up to 100 wantlist items to check against — page 1 is sufficient for the flag
        const wantlistData = await userClient.getWantlist(req.user.username, 1, 100);
        wantlistIds = new Set((wantlistData.wants ?? []).map((w) => w.id));
      } catch {
        // Non-fatal — in_wantlist will be false if this fails
      }
    }

    const client = req.user
      ? createUserClient(req.user.discogsAccessToken, req.user.discogsAccessTokenSecret)
      : createAppClient();

    const searchQuery = ['artist', 'label', 'catno', 'barcode', 'track'].includes(type) ? '' : q;
    const data = await client.searchDatabase(searchQuery, searchParams);

    res.json({
      results: (data.results ?? []).map((r) =>
        normalizeSearchResult(r, wantlistIds.has(r.id)),
      ),
      pagination: normalizePagination(data.pagination),
    });
  } catch (err) {
    logger.error({ err }, 'Search failed');
    res.status(502).json({ error: 'Search failed' });
  }
}
