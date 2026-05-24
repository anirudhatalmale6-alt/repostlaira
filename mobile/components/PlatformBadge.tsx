import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, platformColors, spacing, borderRadius, fontSize } from '../lib/theme';
import { getPlatformIcon, getPlatformLabel } from '../lib/platform-detect';
import type { Platform } from '../lib/theme';

interface PlatformBadgeProps {
  platform: Platform | string;
  size?: 'small' | 'medium' | 'large';
  showLabel?: boolean;
}

export default function PlatformBadge({
  platform,
  size = 'medium',
  showLabel = true,
}: PlatformBadgeProps) {
  const color = platformColors[platform as Platform] || colors.accent;
  const icon = getPlatformIcon(platform as Platform);
  const label = getPlatformLabel(platform);

  const sizeStyles = {
    small: {
      container: { paddingHorizontal: spacing.sm, paddingVertical: 3 },
      icon: { fontSize: fontSize.xs, width: 18, height: 18 },
      label: { fontSize: fontSize.xs },
    },
    medium: {
      container: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
      icon: { fontSize: fontSize.sm, width: 24, height: 24 },
      label: { fontSize: fontSize.sm },
    },
    large: {
      container: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
      icon: { fontSize: fontSize.md, width: 30, height: 30 },
      label: { fontSize: fontSize.md },
    },
  };

  const s = sizeStyles[size];

  return (
    <View style={[styles.container, s.container, { borderColor: color + '40' }]}>
      <View
        style={[
          styles.iconCircle,
          { backgroundColor: color, width: s.icon.width, height: s.icon.height },
        ]}
      >
        <Text style={[styles.iconText, { fontSize: s.icon.fontSize }]}>{icon}</Text>
      </View>
      {showLabel && (
        <Text style={[styles.label, s.label, { color }]}>{label}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bgCard,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  iconCircle: {
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    color: colors.white,
    fontWeight: '800',
    textAlign: 'center',
  },
  label: {
    fontWeight: '600',
  },
});
