import React from 'react';
import {
  TouchableOpacity,
  Text,
  View,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { colors, spacing, borderRadius, fontSize } from '../lib/theme';

type DownloadState = 'idle' | 'downloading' | 'success' | 'error';

interface DownloadButtonProps {
  state: DownloadState;
  progress: number;
  onPress: () => void;
  disabled?: boolean;
}

export default function DownloadButton({
  state,
  progress,
  onPress,
  disabled,
}: DownloadButtonProps) {
  const getButtonStyle = () => {
    switch (state) {
      case 'downloading':
        return styles.downloading;
      case 'success':
        return styles.success;
      case 'error':
        return styles.error;
      default:
        return styles.idle;
    }
  };

  const getContent = () => {
    switch (state) {
      case 'downloading':
        return (
          <View style={styles.downloadingContent}>
            <ActivityIndicator color={colors.white} size="small" />
            <Text style={styles.buttonText}>
              Telechargement... {Math.round(progress * 100)}%
            </Text>
          </View>
        );
      case 'success':
        return (
          <View style={styles.successContent}>
            <Text style={styles.checkIcon}>&#x2713;</Text>
            <Text style={styles.buttonText}>Enregistre !</Text>
          </View>
        );
      case 'error':
        return (
          <View style={styles.errorContent}>
            <Text style={styles.errorIcon}>&#x26A0;</Text>
            <Text style={styles.buttonText}>Erreur - Reessayer</Text>
          </View>
        );
      default:
        return (
          <View style={styles.idleContent}>
            <Text style={styles.downloadIcon}>&#x2B07;</Text>
            <Text style={styles.buttonText}>Telecharger</Text>
          </View>
        );
    }
  };

  return (
    <View style={styles.wrapper}>
      <TouchableOpacity
        style={[
          styles.button,
          getButtonStyle(),
          disabled && styles.disabled,
        ]}
        onPress={onPress}
        disabled={disabled || state === 'downloading'}
        activeOpacity={0.8}
      >
        {state === 'downloading' && (
          <View style={styles.progressTrack}>
            <View
              style={[styles.progressFill, { width: `${Math.max(progress * 100, 2)}%` }]}
            />
          </View>
        )}
        <View style={styles.content}>{getContent()}</View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
  },
  button: {
    borderRadius: borderRadius.lg,
    minHeight: 56,
    overflow: 'hidden',
    position: 'relative',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
    zIndex: 2,
  },
  idle: {
    backgroundColor: colors.accent,
  },
  downloading: {
    backgroundColor: colors.accentDark,
  },
  success: {
    backgroundColor: colors.success,
  },
  error: {
    backgroundColor: colors.error,
  },
  disabled: {
    opacity: 0.5,
  },
  progressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.2)',
    zIndex: 1,
  },
  progressFill: {
    height: '100%',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  idleContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  downloadingContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  successContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  errorContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  buttonText: {
    color: colors.white,
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  downloadIcon: {
    color: colors.white,
    fontSize: fontSize.xl,
  },
  checkIcon: {
    color: colors.white,
    fontSize: fontSize.xl,
    fontWeight: '800',
  },
  errorIcon: {
    color: colors.white,
    fontSize: fontSize.xl,
  },
});
