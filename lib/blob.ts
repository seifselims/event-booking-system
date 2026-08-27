import { del } from '@vercel/blob';

/**
 * Poster storage cleanup.
 *
 * `poster_url` is a free-form column: it holds either a file we uploaded to
 * Vercel Blob or a URL an organizer pasted from somewhere else. Only the former
 * is ours to delete, so every removal is gated on the URL actually pointing at
 * our own store.
 */

/**
 * Does this URL point at our blob store?
 *
 * Matched on the host rather than by a substring, so a pasted URL that merely
 * *contains* the store's name (a path, a query parameter, an open redirect)
 * cannot be mistaken for ours. `del` throws `BlobError: Some urls are
 * malformed` on a foreign host, so this also keeps a pasted URL from turning a
 * successful save into a failed one.
 */
export function isOwnBlobUrl(url: string) {
  let host: string;

  try {
    host = new URL(url).host;
  } catch {
    return false; // not a URL at all — nothing to delete
  }

  return /^[a-z0-9]+\.(public|private)\.blob\.vercel-storage\.com$/.test(host);
}

/**
 * Delete a poster we uploaded, if that is what this URL is.
 *
 * Never throws. A failed cleanup is a leaked file, which is a cost problem; a
 * thrown error here would fail the organizer's *save*, which is a correctness
 * problem — the row is already written by the time this runs, so rejecting the
 * mutation would report a save that actually happened as failed. `del` is
 * idempotent for our own store (deleting an absent blob is a no-op), so a
 * double call is safe.
 */
export async function deleteOwnBlob(url: string | null | undefined) {
  if (!url || !isOwnBlobUrl(url)) return;

  try {
    await del(url);
  } catch (error) {
    console.error('[blob] failed to delete poster', url, error);
  }
}
