import type { Platform } from './theme';

interface PlatformPattern {
  platform: Platform;
  patterns: RegExp[];
  label: string;
}

const platformPatterns: PlatformPattern[] = [
  {
    platform: 'tiktok',
    patterns: [
      /(?:www\.)?tiktok\.com/i,
      /vm\.tiktok\.com/i,
      /vt\.tiktok\.com/i,
    ],
    label: 'TikTok',
  },
  {
    platform: 'instagram',
    patterns: [
      /(?:www\.)?instagram\.com/i,
      /instagr\.am/i,
    ],
    label: 'Instagram',
  },
  {
    platform: 'youtube',
    patterns: [
      /(?:www\.)?youtube\.com/i,
      /youtu\.be/i,
      /m\.youtube\.com/i,
    ],
    label: 'YouTube',
  },
  {
    platform: 'twitter',
    patterns: [
      /(?:www\.)?twitter\.com/i,
      /(?:www\.)?x\.com/i,
    ],
    label: 'Twitter / X',
  },
  {
    platform: 'facebook',
    patterns: [
      /(?:www\.)?facebook\.com/i,
      /fb\.watch/i,
      /fb\.com/i,
      /(?:www\.)?fb\.gg/i,
    ],
    label: 'Facebook',
  },
];

export interface DetectionResult {
  platform: Platform;
  label: string;
}

export function detectPlatform(url: string): DetectionResult | null {
  if (!url || url.trim().length === 0) return null;

  const trimmed = url.trim();

  for (const entry of platformPatterns) {
    for (const pattern of entry.patterns) {
      if (pattern.test(trimmed)) {
        return {
          platform: entry.platform,
          label: entry.label,
        };
      }
    }
  }

  return null;
}

export function isValidUrl(text: string): boolean {
  try {
    const url = new URL(text.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function getPlatformIcon(platform: Platform): string {
  switch (platform) {
    case 'tiktok': return 'TT';
    case 'instagram': return 'IG';
    case 'youtube': return 'YT';
    case 'twitter': return 'X';
    case 'facebook': return 'FB';
    default: return '?';
  }
}

export function getPlatformLabel(platform: Platform | string): string {
  const entry = platformPatterns.find(p => p.platform === platform);
  return entry?.label || platform;
}
