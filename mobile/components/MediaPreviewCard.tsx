import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { colors, spacing, borderRadius, fontSize } from '../lib/theme';
import { formatDuration } from '../lib/download';
import PlatformBadge from './PlatformBadge';
import type { Platform } from '../lib/theme';

interface MediaPreviewCardProps {
  thumbnail: string;
  title: string;
  uploader: string;
  platform: Platform | string;
  duration?: number;
}

export default function MediaPreviewCard({
  thumbnail,
  title,
  uploader,
  platform,
  duration,
}: MediaPreviewCardProps) {
  const durationStr = duration ? formatDuration(duration) : '';

  return (
    <View style={styles.card}>
      <View style={styles.thumbnailContainer}>
        {thumbnail ? (
          <Image
            source={{ uri: thumbnail }}
            style={styles.thumbnail}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.thumbnail, styles.placeholderThumbnail]}>
            <Text style={styles.placeholderIcon}>&#x1F3AC;</Text>
          </View>
        )}
        {durationStr ? (
          <View style={styles.durationBadge}>
            <Text style={styles.durationText}>{durationStr}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.infoSection}>
        <View style={styles.platformRow}>
          <PlatformBadge platform={platform} size="small" />
        </View>

        <Text style={styles.title} numberOfLines={2}>
          {title || 'Sans titre'}
        </Text>

        {uploader ? (
          <View style={styles.uploaderRow}>
            <Text style={styles.uploaderIcon}>&#x263A;</Text>
            <Text style={styles.uploaderText}>{uploader}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  thumbnailContainer: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: colors.bgLight,
    position: 'relative',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  placeholderThumbnail: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgLight,
  },
  placeholderIcon: {
    fontSize: 48,
  },
  durationBadge: {
    position: 'absolute',
    bottom: spacing.sm,
    right: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  durationText: {
    color: colors.white,
    fontSize: fontSize.xs,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  infoSection: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  platformRow: {
    flexDirection: 'row',
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.lg,
    fontWeight: '700',
    lineHeight: 24,
  },
  uploaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  uploaderIcon: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  uploaderText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
});
