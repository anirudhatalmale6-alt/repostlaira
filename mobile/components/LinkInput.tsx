import React, { useCallback } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { colors, spacing, borderRadius, fontSize } from '../lib/theme';
import { detectPlatform } from '../lib/platform-detect';
import PlatformBadge from './PlatformBadge';

interface LinkInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  loading?: boolean;
}

export default function LinkInput({
  value,
  onChangeText,
  onSubmit,
  loading,
}: LinkInputProps) {
  const detected = detectPlatform(value);

  const handlePaste = useCallback(async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text) {
        onChangeText(text.trim());
      }
    } catch (err) {
      console.warn('Could not read clipboard:', err);
    }
  }, [onChangeText]);

  const handleClear = useCallback(() => {
    onChangeText('');
  }, [onChangeText]);

  return (
    <View style={styles.container}>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder="Collez un lien ici..."
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={onSubmit}
          selectTextOnFocus
        />
        {value.length > 0 && (
          <TouchableOpacity style={styles.clearBtn} onPress={handleClear} activeOpacity={0.7}>
            <Text style={styles.clearIcon}>&#x2715;</Text>
          </TouchableOpacity>
        )}
      </View>

      {detected && (
        <View style={styles.detectedRow}>
          <Text style={styles.detectedLabel}>Plateforme detectee :</Text>
          <PlatformBadge platform={detected.platform} size="small" />
        </View>
      )}

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={styles.pasteBtn}
          onPress={handlePaste}
          activeOpacity={0.7}
        >
          <Text style={styles.pasteIcon}>&#x2398;</Text>
          <Text style={styles.pasteBtnText}>Auto-coller</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.submitBtn,
            (!value.trim() || loading) && styles.submitBtnDisabled,
          ]}
          onPress={onSubmit}
          disabled={!value.trim() || loading}
          activeOpacity={0.7}
        >
          {loading ? (
            <ActivityIndicator color={colors.white} size="small" />
          ) : (
            <>
              <Text style={styles.submitIcon}>&#x2B07;</Text>
              <Text style={styles.submitBtnText}>Extraire</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgCard,
    borderRadius: borderRadius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    minHeight: 56,
  },
  input: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: fontSize.md,
    paddingVertical: spacing.md,
  },
  clearBtn: {
    padding: spacing.sm,
    marginLeft: spacing.xs,
  },
  clearIcon: {
    color: colors.textMuted,
    fontSize: fontSize.md,
  },
  detectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
    paddingHorizontal: spacing.xs,
    gap: spacing.sm,
  },
  detectedLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  pasteBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgCard,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  pasteIcon: {
    color: colors.textSecondary,
    fontSize: fontSize.lg,
  },
  pasteBtnText: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  submitBtn: {
    flex: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  submitBtnDisabled: {
    opacity: 0.4,
  },
  submitIcon: {
    color: colors.white,
    fontSize: fontSize.lg,
  },
  submitBtnText: {
    color: colors.white,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
});
