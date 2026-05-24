import { spawn } from 'child_process';
import { config } from '../config';

// --- Types ---

export interface ExtractedFormat {
  format_id: string;
  url: string;
  quality: string;
  ext: string;
  filesize: number | null;
  has_audio: boolean;
  has_video: boolean;
}

export interface ExtractedMedia {
  platform: string;
  id: string;
  title: string;
  thumbnail: string | null;
  duration: number | null;
  uploader: string | null;
  formats: ExtractedFormat[];
}

export class ExtractionError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'ExtractionError';
    this.code = code;
  }
}

// --- URL Validation ---

const ALLOWED_DOMAINS = [
  'tiktok.com',
  'vm.tiktok.com',
  'instagram.com',
  'instagr.am',
  'youtube.com',
  'youtu.be',
  'twitter.com',
  'x.com',
  'facebook.com',
  'fb.watch',
];

function isAllowedUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.replace(/^www\./, '').toLowerCase();
    return ALLOWED_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
}

function detectPlatform(urlString: string): string {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.replace(/^www\./, '').toLowerCase();

    if (hostname.includes('tiktok.com')) return 'tiktok';
    if (hostname.includes('instagram.com') || hostname.includes('instagr.am')) return 'instagram';
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) return 'youtube';
    if (hostname.includes('twitter.com') || hostname.includes('x.com')) return 'twitter';
    if (hostname.includes('facebook.com') || hostname.includes('fb.watch')) return 'facebook';

    return 'unknown';
  } catch {
    return 'unknown';
  }
}

// --- yt-dlp Execution ---

function runYtDlp(args: string[], timeout?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(config.ytdlp.path, args, {
      timeout: timeout || config.ytdlp.timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        // Parse common yt-dlp errors
        const errMsg = stderr.toLowerCase();
        if (errMsg.includes('private') || errMsg.includes('login required')) {
          reject(new ExtractionError('This content is private or requires login.', 'PRIVATE_CONTENT'));
        } else if (errMsg.includes('not found') || errMsg.includes('does not exist') || errMsg.includes('video unavailable')) {
          reject(new ExtractionError('Content not found or has been deleted.', 'NOT_FOUND'));
        } else if (errMsg.includes('unsupported url') || errMsg.includes('no video formats')) {
          reject(new ExtractionError('Unsupported URL or no downloadable content found.', 'UNSUPPORTED'));
        } else {
          reject(new ExtractionError(
            `Extraction failed: ${stderr.trim().slice(0, 200) || 'Unknown error'}`,
            'EXTRACTION_FAILED'
          ));
        }
      }
    });

    proc.on('error', (err) => {
      if ((err as any).code === 'ETIMEDOUT' || err.message.includes('TIMEOUT')) {
        reject(new ExtractionError('Extraction timed out. Please try again.', 'TIMEOUT'));
      } else {
        reject(new ExtractionError(`Failed to run yt-dlp: ${err.message}`, 'SPAWN_ERROR'));
      }
    });

    // Manual timeout as extra safety net
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new ExtractionError('Extraction timed out after ' + (config.ytdlp.timeout / 1000) + 's.', 'TIMEOUT'));
    }, (timeout || config.ytdlp.timeout) + 2000);

    proc.on('close', () => clearTimeout(timer));
  });
}

// --- Format Selection ---

function normalizeFormats(rawFormats: any[]): ExtractedFormat[] {
  if (!rawFormats || !Array.isArray(rawFormats)) return [];

  const formats: ExtractedFormat[] = rawFormats
    .filter((f: any) => f.url) // must have a URL
    .map((f: any) => ({
      format_id: f.format_id || 'unknown',
      url: f.url,
      quality: buildQualityLabel(f),
      ext: f.ext || 'mp4',
      filesize: f.filesize || f.filesize_approx || null,
      has_audio: f.acodec !== 'none' && !!f.acodec,
      has_video: f.vcodec !== 'none' && !!f.vcodec,
    }));

  return selectBestFormats(formats, rawFormats);
}

function buildQualityLabel(f: any): string {
  const parts: string[] = [];

  if (f.height) {
    parts.push(`${f.height}p`);
  } else if (f.format_note) {
    parts.push(f.format_note);
  }

  if (f.fps && f.fps > 30) {
    parts.push(`${f.fps}fps`);
  }

  const hasVideo = f.vcodec !== 'none' && !!f.vcodec;
  const hasAudio = f.acodec !== 'none' && !!f.acodec;

  if (hasVideo && hasAudio) {
    parts.push('video+audio');
  } else if (hasVideo) {
    parts.push('video only');
  } else if (hasAudio) {
    parts.push('audio only');
  }

  return parts.join(' ') || 'unknown';
}

function selectBestFormats(formats: ExtractedFormat[], rawFormats: any[]): ExtractedFormat[] {
  const selected: ExtractedFormat[] = [];

  // Best combined (video + audio)
  const combined = formats.filter((f) => f.has_video && f.has_audio);
  if (combined.length > 0) {
    // Sort by resolution (from raw formats) descending
    combined.sort((a, b) => {
      const rawA = rawFormats.find((r: any) => r.format_id === a.format_id);
      const rawB = rawFormats.find((r: any) => r.format_id === b.format_id);
      return ((rawB?.height || 0) - (rawA?.height || 0));
    });
    // Keep top 3 resolutions
    selected.push(...combined.slice(0, 3));
  }

  // Best video only (no audio)
  const videoOnly = formats.filter((f) => f.has_video && !f.has_audio);
  if (videoOnly.length > 0) {
    videoOnly.sort((a, b) => {
      const rawA = rawFormats.find((r: any) => r.format_id === a.format_id);
      const rawB = rawFormats.find((r: any) => r.format_id === b.format_id);
      return ((rawB?.height || 0) - (rawA?.height || 0));
    });
    selected.push(videoOnly[0]); // Best video-only
  }

  // Best audio only
  const audioOnly = formats.filter((f) => f.has_audio && !f.has_video);
  if (audioOnly.length > 0) {
    audioOnly.sort((a, b) => {
      const rawA = rawFormats.find((r: any) => r.format_id === a.format_id);
      const rawB = rawFormats.find((r: any) => r.format_id === b.format_id);
      return ((rawB?.abr || 0) - (rawA?.abr || 0));
    });
    selected.push(audioOnly[0]); // Best audio-only
  }

  // If no formats were selected from the above categories, return all (up to 5)
  if (selected.length === 0) {
    return formats.slice(0, 5);
  }

  return selected;
}

// --- Public API ---

/**
 * Extract media information from a social media URL.
 */
export async function extractMedia(url: string): Promise<ExtractedMedia> {
  if (!isAllowedUrl(url)) {
    throw new ExtractionError(
      'Unsupported platform. Supported: TikTok, Instagram, YouTube, Twitter/X, Facebook.',
      'INVALID_URL'
    );
  }

  const platform = detectPlatform(url);

  const output = await runYtDlp([
    '--dump-json',
    '--no-download',
    '--no-warnings',
    '--no-check-certificates',
    url,
  ]);

  let data: any;
  try {
    data = JSON.parse(output);
  } catch {
    throw new ExtractionError('Failed to parse extraction results.', 'PARSE_ERROR');
  }

  const formats = normalizeFormats(data.formats);

  return {
    platform,
    id: data.id || '',
    title: data.title || data.fulltitle || 'Untitled',
    thumbnail: data.thumbnail || data.thumbnails?.[data.thumbnails.length - 1]?.url || null,
    duration: data.duration ? Math.round(data.duration) : null,
    uploader: data.uploader || data.channel || data.creator || null,
    formats,
  };
}

/**
 * Get a fresh direct download URL for a specific format.
 */
export async function getDirectUrl(url: string, formatId: string): Promise<string> {
  if (!isAllowedUrl(url)) {
    throw new ExtractionError(
      'Unsupported platform.',
      'INVALID_URL'
    );
  }

  const output = await runYtDlp([
    '--get-url',
    '-f', formatId,
    '--no-warnings',
    '--no-check-certificates',
    url,
  ]);

  if (!output) {
    throw new ExtractionError('Could not retrieve download URL.', 'NO_URL');
  }

  // yt-dlp may return multiple lines if format merges video+audio
  // Return the first URL
  return output.split('\n')[0].trim();
}
