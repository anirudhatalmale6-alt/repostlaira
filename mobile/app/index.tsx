import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
  FlatList,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, platformColors, spacing, borderRadius, fontSize } from '../lib/theme';
import { detectPlatform, isValidUrl, getPlatformIcon } from '../lib/platform-detect';
import LinkInput from '../components/LinkInput';
import type { Platform } from '../lib/theme';

const platforms: { key: Platform; label: string }[] = [
  { key: 'tiktok', label: 'TikTok' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'twitter', label: 'Twitter' },
  { key: 'facebook', label: 'Facebook' },
];

const lairaboostServices = [
  { name: 'TikTok', metrics: 'Followers, Likes, Views', color: '#000000', icon: 'TK' },
  { name: 'Instagram', metrics: 'Followers, Likes, Views', color: '#E1306C', icon: 'IG' },
  { name: 'YouTube', metrics: 'Views, Subscribers, Likes', color: '#FF0000', icon: 'YT' },
  { name: 'Twitter', metrics: 'Followers, Likes, Retweets', color: '#1DA1F2', icon: 'X' },
  { name: 'Facebook', metrics: 'Followers, Likes, Views', color: '#1877F2', icon: 'FB' },
  { name: 'Telegram', metrics: 'Members, Views, Reactions', color: '#0088CC', icon: 'TG' },
  { name: 'Spotify', metrics: 'Plays, Followers, Saves', color: '#1DB954', icon: 'SP' },
  { name: 'Twitch', metrics: 'Followers, Views, Subs', color: '#9146FF', icon: 'TW' },
  { name: 'LinkedIn', metrics: 'Followers, Likes, Views', color: '#0A66C2', icon: 'LI' },
  { name: 'Snapchat', metrics: 'Followers, Views, Score', color: '#FFFC00', icon: 'SC' },
  { name: 'Reddit', metrics: 'Upvotes, Members, Awards', color: '#FF4500', icon: 'RD' },
  { name: 'Pinterest', metrics: 'Followers, Pins, Saves', color: '#E60023', icon: 'PI' },
];

export default function HomeScreen() {
  const router = useRouter();
  const [url, setUrl] = useState('');

  const openLairaboost = useCallback(() => {
    Linking.openURL('https://lairaboost.com');
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = url.trim();
    if (!trimmed) {
      Alert.alert('Lien requis', 'Veuillez coller un lien valide.');
      return;
    }

    if (!isValidUrl(trimmed)) {
      Alert.alert(
        'Lien invalide',
        'Le lien saisi ne semble pas etre une URL valide. Verifiez et reessayez.'
      );
      return;
    }

    const detected = detectPlatform(trimmed);
    if (!detected) {
      Alert.alert(
        'Plateforme non supportee',
        'Ce lien ne correspond a aucune plateforme supportee (TikTok, Instagram, YouTube, Twitter, Facebook).'
      );
      return;
    }

    router.push({ pathname: '/preview', params: { url: trimmed } });
  }, [url, router]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header / Branding */}
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            <View style={styles.logoIcon}>
              <Text style={styles.logoIconText}>R</Text>
            </View>
          </View>
          <Text style={styles.appName}>RepostLaira</Text>
          <Text style={styles.subtitle}>
            Telechargez et repostez du contenu de vos reseaux sociaux preferes
          </Text>
        </View>

        {/* Platform Icons Row */}
        <View style={styles.platformRow}>
          {platforms.map((p) => (
            <View key={p.key} style={styles.platformItem}>
              <View
                style={[
                  styles.platformCircle,
                  { backgroundColor: platformColors[p.key] || colors.accent },
                ]}
              >
                <Text style={styles.platformCircleText}>
                  {getPlatformIcon(p.key)}
                </Text>
              </View>
              <Text style={styles.platformLabel}>{p.label}</Text>
            </View>
          ))}
        </View>

        {/* Divider */}
        <View style={styles.divider} />

        {/* Link Input Section */}
        <View style={styles.inputSection}>
          <Text style={styles.sectionTitle}>Coller un lien</Text>
          <LinkInput
            value={url}
            onChangeText={setUrl}
            onSubmit={handleSubmit}
          />
        </View>

        {/* Lairaboost Services Carousel */}
        <View style={styles.carouselSection}>
          <View style={styles.carouselHeader}>
            <Text style={styles.sectionTitle}>Boostez vos reseaux</Text>
            <TouchableOpacity onPress={openLairaboost} activeOpacity={0.7}>
              <Text style={styles.seeAllLink}>Voir tout</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.carouselSubtitle}>
            Propulse par Lairaboost.com
          </Text>
          <FlatList
            data={lairaboostServices}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item) => item.name}
            contentContainerStyle={styles.carouselList}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.serviceCard}
                onPress={openLairaboost}
                activeOpacity={0.7}
              >
                <View style={[styles.serviceIconCircle, { backgroundColor: item.color }]}>
                  <Text style={[
                    styles.serviceIconText,
                    item.name === 'Snapchat' && { color: '#000' },
                  ]}>
                    {item.icon}
                  </Text>
                </View>
                <Text style={styles.serviceName}>{item.name}</Text>
                <Text style={styles.serviceMetrics}>{item.metrics}</Text>
              </TouchableOpacity>
            )}
          />
        </View>

        <View style={styles.divider} />

        {/* Info Cards */}
        <View style={styles.infoSection}>
          <View style={styles.infoCard}>
            <Text style={styles.infoIcon}>1</Text>
            <View style={styles.infoTextWrap}>
              <Text style={styles.infoTitle}>Copiez le lien</Text>
              <Text style={styles.infoDesc}>
                Depuis TikTok, Instagram, YouTube, Twitter ou Facebook
              </Text>
            </View>
          </View>

          <View style={styles.infoCard}>
            <Text style={styles.infoIcon}>2</Text>
            <View style={styles.infoTextWrap}>
              <Text style={styles.infoTitle}>Collez ici</Text>
              <Text style={styles.infoDesc}>
                Utilisez le bouton Auto-coller ou collez manuellement
              </Text>
            </View>
          </View>

          <View style={styles.infoCard}>
            <Text style={styles.infoIcon}>3</Text>
            <View style={styles.infoTextWrap}>
              <Text style={styles.infoTitle}>Telechargez</Text>
              <Text style={styles.infoDesc}>
                Choisissez la qualite et enregistrez dans votre galerie
              </Text>
            </View>
          </View>
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
  header: {
    alignItems: 'center',
    paddingTop: spacing.xxl,
    paddingBottom: spacing.lg,
  },
  logoContainer: {
    marginBottom: spacing.lg,
  },
  logoIcon: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  logoIconText: {
    color: colors.white,
    fontSize: 36,
    fontWeight: '900',
  },
  appName: {
    color: colors.white,
    fontSize: fontSize.xxxl,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 20,
    maxWidth: 300,
  },
  platformRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.lg,
    marginTop: spacing.xxl,
  },
  platformItem: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  platformCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  platformCircleText: {
    color: colors.white,
    fontSize: fontSize.sm,
    fontWeight: '800',
  },
  platformLabel: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.xxl,
  },
  inputSection: {
    gap: spacing.md,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  carouselSection: {
    marginTop: spacing.xxl,
  },
  carouselHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  carouselSubtitle: {
    color: colors.accent,
    fontSize: fontSize.xs,
    fontWeight: '600',
    marginBottom: spacing.lg,
  },
  seeAllLink: {
    color: colors.accent,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  carouselList: {
    gap: spacing.md,
    paddingRight: spacing.xl,
  },
  serviceCard: {
    backgroundColor: colors.bgCard,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    width: 120,
    alignItems: 'center',
    gap: spacing.sm,
  },
  serviceIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serviceIconText: {
    color: colors.white,
    fontSize: fontSize.sm,
    fontWeight: '900',
  },
  serviceName: {
    color: colors.textPrimary,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  serviceMetrics: {
    color: colors.textMuted,
    fontSize: 10,
    textAlign: 'center',
    lineHeight: 14,
  },
  infoSection: {
    gap: spacing.md,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgCard,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    gap: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoIcon: {
    color: colors.accent,
    fontSize: fontSize.xl,
    fontWeight: '900',
    width: 32,
    height: 32,
    lineHeight: 32,
    textAlign: 'center',
    backgroundColor: colors.accent + '1A',
    borderRadius: borderRadius.sm,
    overflow: 'hidden',
  },
  infoTextWrap: {
    flex: 1,
    gap: 2,
  },
  infoTitle: {
    color: colors.textPrimary,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  infoDesc: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    lineHeight: 18,
  },
});
