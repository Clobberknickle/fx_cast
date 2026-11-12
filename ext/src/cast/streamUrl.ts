/**
 * Helpers for turning page media URLs into URLs a cast receiver can
 * actually load.
 *
 * Many video sites play through Media Source Extensions (hls.js,
 * dash.js, shaka, etc.), so the <video> element's src is a
 * `blob:https://site/...` URL. Blob URLs only exist inside the browser
 * tab that created them, so a Chromecast told to load one can never
 * fetch it and just sits on its idle screen (the cast logo). The page
 * did fetch the real stream manifest, though, so it can be recovered
 * from the page's resource timing entries.
 */

const HLS_RE = /\.m3u8(?:[?#]|$)/i;
const DASH_RE = /\.mpd(?:[?#]|$)/i;
const SMOOTH_RE = /\.ism\/manifest(?:[?#]|$)/i;

const EXTENSION_TYPES: Array<[RegExp, string]> = [
    [HLS_RE, "application/x-mpegurl"],
    [DASH_RE, "application/dash+xml"],
    [SMOOTH_RE, "application/vnd.ms-sstr+xml"],
    [/\.mp4(?:[?#]|$)/i, "video/mp4"],
    [/\.m4v(?:[?#]|$)/i, "video/mp4"],
    [/\.webm(?:[?#]|$)/i, "video/webm"],
    [/\.mkv(?:[?#]|$)/i, "video/x-matroska"],
    [/\.mp3(?:[?#]|$)/i, "audio/mpeg"],
    [/\.m4a(?:[?#]|$)/i, "audio/mp4"],
    [/\.aac(?:[?#]|$)/i, "audio/aac"],
    [/\.ogg(?:[?#]|$)/i, "audio/ogg"],
    [/\.flac(?:[?#]|$)/i, "audio/flac"]
];

/** URLs a receiver device has no way of fetching. */
export function isUnreachableUrl(url: string | undefined) {
    return (
        !!url &&
        (url.startsWith("blob:") ||
            url.startsWith("mediastream:") ||
            url.startsWith("data:"))
    );
}

/** Guess a content type from a URL's file extension. */
export function guessContentType(url: string): string | undefined {
    for (const [re, type] of EXTENSION_TYPES) {
        if (re.test(url)) return type;
    }
}

/**
 * Find the streaming manifest the page loaded most recently.
 *
 * Prefers top-level (master) HLS playlists over variant/media
 * playlists, since a variant playlist would lock the receiver to one
 * quality and may lack the separate audio rendition.
 */
export function findPageStreamManifest(): string | undefined {
    let entries: string[];
    try {
        entries = performance
            .getEntriesByType("resource")
            .map(entry => entry.name);
    } catch {
        return;
    }

    const manifests = entries.filter(
        url =>
            /^https?:/i.test(url) &&
            (HLS_RE.test(url) || DASH_RE.test(url) || SMOOTH_RE.test(url))
    );
    if (!manifests.length) return;

    // DASH/Smooth manifests are already top-level
    const topLevel = manifests.filter(url => !HLS_RE.test(url));

    /**
     * For HLS, a master playlist is usually requested before its
     * variants, and variants usually live in a sub-path of it or are
     * named "playlist", "index", "chunklist", etc. Prefer anything named
     * like a master playlist, then fall back to the first HLS playlist
     * the page requested in the most recent playback session.
     */
    const hls = manifests.filter(url => HLS_RE.test(url));
    const master = hls.filter(url => /master|main|manifest/i.test(url));

    const candidates = [...topLevel, ...master];
    if (candidates.length) return candidates[candidates.length - 1];

    if (hls.length) {
        // Last group of requests belongs to the current video. Walk back
        // to the first playlist that isn't nested under another one.
        const last = hls[hls.length - 1];
        const lastDir = last.slice(0, last.lastIndexOf("/"));
        for (const url of hls) {
            const dir = url.slice(0, url.lastIndexOf("/"));
            if (lastDir.startsWith(dir)) return url;
        }
        return last;
    }
}

/**
 * Given the URL a sender wants to load, return a URL and content type
 * the receiver can actually load, or `undefined` if there's nothing
 * better to offer.
 */
export function resolveCastableMedia(
    url: string,
    contentType?: string
): { url: string; contentType: string } | undefined {
    if (isUnreachableUrl(url)) {
        const manifest = findPageStreamManifest();
        if (!manifest) return;
        return {
            url: manifest,
            contentType: guessContentType(manifest) ?? "application/x-mpegurl"
        };
    }

    // Receivers need a content type to pick a player for HLS/DASH
    if (!contentType) {
        const guessed = guessContentType(url);
        if (guessed) return { url, contentType: guessed };
    }
}
