export const colors = {
  bg: '#1a1c24',
  bgLight: '#22252e',
  bgCard: '#2a2d37',
  accent: '#3B82F6',
  accentDark: '#2563EB',
  white: '#ffffff',
  textPrimary: '#ffffff',
  textSecondary: '#9ca3af',
  textMuted: '#6b7280',
  border: '#333640',
  error: '#ef4444',
  success: '#22c55e',
  warning: '#f59e0b',
} as const;

export const platformColors = {
  tiktok: '#000000',
  instagram: '#E1306C',
  youtube: '#FF0000',
  twitter: '#1DA1F2',
  facebook: '#1877F2',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const borderRadius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 999,
} as const;

export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 26,
  xxxl: 32,
} as const;

export type Platform = 'tiktok' | 'instagram' | 'youtube' | 'twitter' | 'facebook';
