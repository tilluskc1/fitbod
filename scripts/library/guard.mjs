// (#431) The exercise library ships text and tags only. This guard runs on every row the import writes
// (scripts/import-library.mjs) and again on the committed files at build time (scripts/library-check.mjs),
// so a row carrying media, a link or a media file name fails the build instead of shipping.
//
// Rejects: a media field (`image`, `images`, `gif_url`, `media_id`, `attribution`, anything named like a
// video), a URL, a media file extension, or `gymvisual`, anywhere in the row: keys and string values,
// nested arrays and objects included.

const MEDIA_KEYS = new Set(['image', 'images', 'gifurl', 'mediaid', 'attribution']);
const URL = /https?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|org|net|io|co|dev|app)\//i;
const MEDIA_EXT = /\.(?:jpe?g|png|gif|webp|avif|svg|bmp|tiff?|heic|mp4|m4v|webm|mov|avi|mkv|mp3|wav|ogg)\b/i;
const GYMVISUAL = /gymvisual/i;

const keyName = (key) => key.toLowerCase().replace(/[^a-z]/g, '');

/** Why `row` may not ship, or null when it is clean. */
export function guardRow(row) {
  const seen = [];
  const walk = (value, path) => {
    if (typeof value === 'string') {
      if (URL.test(value)) seen.push(`URL in ${path}`);
      else if (MEDIA_EXT.test(value)) seen.push(`media file name in ${path}`);
      else if (GYMVISUAL.test(value)) seen.push(`gymvisual in ${path}`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        const name = keyName(key);
        if (MEDIA_KEYS.has(name) || name.includes('video') || GYMVISUAL.test(key)) seen.push(`media field "${key}"`);
        else walk(item, path ? `${path}.${key}` : key);
      }
    }
  };
  walk(row, '');
  return seen.length ? seen[0] : null;
}
