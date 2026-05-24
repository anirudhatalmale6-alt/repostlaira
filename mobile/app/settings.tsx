import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { colors, spacing, borderRadius, fontSize } from '../lib/theme';
import { clearHistory, getHistoryCount } from '../lib/storage';

const APP_VERSION = '1.0.0';

type Language = 'fr' | 'en' | 'es';

const languages: { key: Language; label: string }[] = [
  { key: 'fr', label: 'Francais' },
  { key: 'en', label: 'English' },
  { key: 'es', label: 'Espanol' },
];

export default function SettingsScreen() {
  const [historyCount, setHistoryCount] = useState(0);
  const [selectedLang, setSelectedLang] = useState<Language>('fr');

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const count = await getHistoryCount();
        setHistoryCount(count);
      })();
    }, [])
  );

  const handleClearHistory = useCallback(() => {
    if (historyCount === 0) {
      Alert.alert('Historique vide', 'Il n\'y a rien a supprimer.');
      return;
    }
    Alert.alert(
      'Effacer l\'historique',
      `Etes-vous sur de vouloir supprimer ${historyCount} element${historyCount > 1 ? 's' : ''} ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Effacer',
          style: 'destructive',
          onPress: async () => {
            await clearHistory();
            setHistoryCount(0);
            Alert.alert('Termine', 'L\'historique a ete efface.');
          },
        },
      ]
    );
  }, [historyCount]);

  const handleRateApp = useCallback(() => {
    Alert.alert(
      'Evaluer RepostLaira',
      'Cette fonctionnalite sera disponible une fois l\'application publiee sur les stores.'
    );
  }, []);

  const handleContact = useCallback(() => {
    Linking.openURL('mailto:support@lairaboost.com?subject=RepostLaira%20-%20Support');
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.headerBar}>
          <Text style={styles.headerTitle}>Reglages</Text>
        </View>

        {/* Premium Upsell Card */}
        <View style={styles.premiumCard}>
          <View style={styles.premiumBadge}>
            <Text style={styles.premiumBadgeText}>PRO</Text>
          </View>
          <Text style={styles.premiumTitle}>RepostLaira Premium</Text>
          <Text style={styles.premiumDesc}>
            Telechargements illimites, sans publicites, qualite maximale et support prioritaire.
          </Text>
          <TouchableOpacity style={styles.premiumBtn} activeOpacity={0.8}>
            <Text style={styles.premiumBtnText}>Passer a Premium</Text>
          </TouchableOpacity>
        </View>

        {/* Language Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Langue</Text>
          <View style={styles.langRow}>
            {languages.map((lang) => (
              <TouchableOpacity
                key={lang.key}
                style={[
                  styles.langOption,
                  selectedLang === lang.key && styles.langOptionActive,
                ]}
                onPress={() => setSelectedLang(lang.key)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.langLabel,
                    selectedLang === lang.key && styles.langLabelActive,
                  ]}
                >
                  {lang.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Data Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Donnees</Text>

          <TouchableOpacity
            style={styles.settingRow}
            onPress={handleClearHistory}
            activeOpacity={0.7}
          >
            <View style={styles.settingLeft}>
              <Text style={styles.settingIcon}>&#x1F5D1;</Text>
              <View>
                <Text style={styles.settingLabel}>Effacer l'historique</Text>
                <Text style={styles.settingSubLabel}>
                  {historyCount} element{historyCount !== 1 ? 's' : ''} enregistre{historyCount !== 1 ? 's' : ''}
                </Text>
              </View>
            </View>
            <Text style={styles.chevron}>&#x203A;</Text>
          </TouchableOpacity>
        </View>

        {/* About Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>A propos</Text>

          <View style={styles.settingRow}>
            <View style={styles.settingLeft}>
              <Text style={styles.settingIcon}>&#x2139;</Text>
              <View>
                <Text style={styles.settingLabel}>Version</Text>
                <Text style={styles.settingSubLabel}>{APP_VERSION}</Text>
              </View>
            </View>
          </View>

          <TouchableOpacity
            style={styles.settingRow}
            onPress={handleRateApp}
            activeOpacity={0.7}
          >
            <View style={styles.settingLeft}>
              <Text style={styles.settingIcon}>&#x2605;</Text>
              <Text style={styles.settingLabel}>Evaluer l'application</Text>
            </View>
            <Text style={styles.chevron}>&#x203A;</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.settingRow}
            onPress={handleContact}
            activeOpacity={0.7}
          >
            <View style={styles.settingLeft}>
              <Text style={styles.settingIcon}>&#x2709;</Text>
              <Text style={styles.settingLabel}>Nous contacter</Text>
            </View>
            <Text style={styles.chevron}>&#x203A;</Text>
          </TouchableOpacity>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>RepostLaira v{APP_VERSION}</Text>
          <Text style={styles.footerText}>Propulse par Lairaboost</Text>
          <Text style={styles.footerCopy}>
            {'©'} 2026 Lairaboost. Tous droits reserves.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  headerBar: {
    paddingTop: spacing.xxl,
    paddingBottom: spacing.lg,
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: fontSize.xxl,
    fontWeight: '800',
  },
  premiumCard: {
    backgroundColor: colors.accent + '15',
    borderRadius: borderRadius.lg,
    borderWidth: 1.5,
    borderColor: colors.accent + '40',
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.xxl,
  },
  premiumBadge: {
    backgroundColor: colors.accent,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  premiumBadgeText: {
    color: colors.white,
    fontSize: fontSize.xs,
    fontWeight: '900',
    letterSpacing: 2,
  },
  premiumTitle: {
    color: colors.textPrimary,
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  premiumDesc: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
  premiumBtn: {
    backgroundColor: colors.accent,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  premiumBtnText: {
    color: colors.white,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  section: {
    marginBottom: spacing.xxl,
    gap: spacing.md,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: spacing.xs,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bgCard,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
  },
  settingIcon: {
    fontSize: fontSize.lg,
    color: colors.textSecondary,
    width: 24,
    textAlign: 'center',
  },
  settingLabel: {
    color: colors.textPrimary,
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  settingSubLabel: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  chevron: {
    color: colors.textMuted,
    fontSize: fontSize.xl,
    fontWeight: '300',
  },
  langRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  langOption: {
    flex: 1,
    backgroundColor: colors.bgCard,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  langOptionActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accent + '15',
  },
  langLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  langLabelActive: {
    color: colors.accent,
  },
  footer: {
    alignItems: 'center',
    paddingTop: spacing.xxl,
    gap: spacing.xs,
  },
  footerText: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
  },
  footerCopy: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    marginTop: spacing.sm,
  },
});
