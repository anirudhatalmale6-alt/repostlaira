import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, fontSize } from '../lib/theme';
import { extractMedia, getDownloadUrl, type ExtractResponse, type MediaFormat } from '../lib/api';
import { detectPlatform } from '../lib/platform-detect';
import { downloadMedia, shareMedia, formatFileSize, type DownloadProgress } from '../lib/download';
import { saveToHistory } from '../lib/storage';
import { showInterstitial } from '../lib/ads';
import MediaPreviewCard from '../components/MediaPreviewCard';
import DownloadButton from '../components/DownloadButton';
import PlatformBadge from '../components/PlatformBadge';
import AdBanner from '../components/AdBanner';
import type { Platform } from '../lib/theme';

type ScreenState = 'loading' | 'preview' | 'error';
type DlState = 'idle' | 'downloading' | 'success' | 'error';

export default function PreviewScreen() {
  const { url } = useLocalSearchParams<{ url: string }>();
  const router = useRouter();

  const [screenState, setScreenState] = useState<ScreenState>('loading');
  const [data, setData] = useState<ExtractResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [selectedFormat, setSelectedFormat] = useState<MediaFormat | null>(null);
  const [dlState, setDlState] = useState<DlState>('idle');
  const [dlProgress, setDlProgress] = useState(0);
  const [savedUri, setSavedUri] = useState<string | null>(null);

  const detected = url ? detectPlatform(url) : null;

  useEffect(() => {
    if (!url) {
      setScreenState('error');
      setErrorMsg('Aucune URL fournie.');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setScreenState('loading');
        const result = await extractMedia(url);
        if (cancelled) return;
        setData(result);
        if (result.formats && result.formats.length > 0) {
          setSelectedFormat(result.formats[0]);
        }
        setScreenState('preview');
      } catch (err: any) {
        if (cancelled) return;
        setScreenState('error');
        setErrorMsg(
          err?.response?.data?.message ||
            err?.message ||
            'Impossible d\'extraire le contenu. Verifiez le lien et reessayez.'
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  const handleDownload = useCallback(async () => {
    if (!data) return;

    if (!selectedFormat?.format_id || !url) {
      Alert.alert('Erreur', 'Aucun lien de telechargement disponible.');
      return;
    }
    const downloadUrl = getDownloadUrl(url, selectedFormat.format_id, data.title);

    try {
      await showInterstitial();
      setDlState('downloading');
      setDlProgress(0);

      const result = await downloadMedia(
        downloadUrl,
        data.title || 'repostlaira_media',
        selectedFormat?.format,
        (progress: DownloadProgress) => {
          setDlProgress(progress.progress);
        }
      );

      setSavedUri(result.uri);
      setDlState('success');

      // Save to history
      await saveToHistory({
        url: url || '',
        title: data.title,
        thumbnail: data.thumbnail,
        platform: data.platform,
        uploader: data.uploader,
        fileUri: result.uri,
      });
    } catch (err: any) {
      setDlState('error');
      Alert.alert(
        'Echec du telechargement',
        err?.message || 'Une erreur est survenue lors du telechargement.'
      );
    }
  }, [data, selectedFormat, url]);

  const handleShare = useCallback(async () => {
    if (!savedUri) return;
    try {
      await shareMedia(savedUri);
    } catch (err: any) {
      Alert.alert('Erreur', err?.message || 'Impossible de partager le fichier.');
    }
  }, [savedUri]);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleRetry = useCallback(() => {
    setScreenState('loading');
    setErrorMsg('');
    setDlState('idle');
    setDlProgress(0);
    setSavedUri(null);
    if (url) {
      (async () => {
        try {
          const result = await extractMedia(url);
          setData(result);
          if (result.formats && result.formats.length > 0) {
            setSelectedFormat(result.formats[0]);
          }
          setScreenState('preview');
        } catch (err: any) {
          setScreenState('error');
          setErrorMsg(
            err?.response?.data?.message || err?.message || 'Echec de l\'extraction.'
          );
        }
      })();
    }
  }, [url]);

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={handleBack} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backIcon}>&#x2190;</Text>
          <Text style={styles.backText}>Retour</Text>
        </TouchableOpacity>
        {detected && <PlatformBadge platform={detected.platform} size="small" />}
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Loading */}
        {screenState === 'loading' && (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={styles.loadingText}>Extraction en cours...</Text>
            <Text style={styles.loadingSubtext}>
              Analyse du contenu depuis {detected?.label || 'la plateforme'}
            </Text>
          </View>
        )}

        {/* Error */}
        {screenState === 'error' && (
          <View style={styles.centered}>
            <View style={styles.errorIconContainer}>
              <Text style={styles.errorIconLarge}>&#x26A0;</Text>
            </View>
            <Text style={styles.errorTitle}>Echec de l'extraction</Text>
            <Text style={styles.errorText}>{errorMsg}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={handleRetry} activeOpacity={0.7}>
              <Text style={styles.retryBtnText}>Reessayer</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Preview */}
        {screenState === 'preview' && data && (
          <View style={styles.previewContent}>
            <MediaPreviewCard
              thumbnail={data.thumbnail}
              title={data.title}
              uploader={data.uploader}
              platform={(data.platform as Platform) || detected?.platform || 'tiktok'}
              duration={data.duration}
            />

            {/* Quality Selector */}
            {data.formats && data.formats.length > 1 && (
              <View style={styles.qualitySection}>
                <Text style={styles.qualityTitle}>Qualite</Text>
                <View style={styles.qualityGrid}>
                  {data.formats.map((fmt, idx) => (
                    <TouchableOpacity
                      key={idx}
                      style={[
                        styles.qualityOption,
                        selectedFormat === fmt && styles.qualityOptionActive,
                      ]}
                      onPress={() => setSelectedFormat(fmt)}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.qualityLabel,
                          selectedFormat === fmt && styles.qualityLabelActive,
                        ]}
                      >
                        {fmt.quality}
                      </Text>
                      {fmt.filesize ? (
                        <Text style={styles.qualitySize}>
                          {formatFileSize(fmt.filesize)}
                        </Text>
                      ) : null}
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {/* Download Button */}
            <View style={styles.downloadSection}>
              <DownloadButton
                state={dlState}
                progress={dlProgress}
                onPress={dlState === 'error' ? handleRetry : handleDownload}
              />
            </View>

            {/* Share Button (after success) */}
            {dlState === 'success' && savedUri && (
              <TouchableOpacity
                style={styles.shareBtn}
                onPress={handleShare}
                activeOpacity={0.7}
              >
                <Text style={styles.shareIcon}>&#x2197;</Text>
                <Text style={styles.shareBtnText}>Partager</Text>
              </TouchableOpacity>
            )}

            {/* URL info */}
            <View style={styles.urlInfo}>
              <Text style={styles.urlLabel}>Source</Text>
              <Text style={styles.urlText} numberOfLines={2}>
                {url}
              </Text>
            </View>
          </View>
        )}
      </ScrollView>
      <AdBanner />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  backIcon: {
    color: colors.accent,
    fontSize: fontSize.xl,
  },
  backText: {
    color: colors.accent,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxxl,
    paddingTop: spacing.xl,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: spacing.md,
  },
  loadingText: {
    color: colors.textPrimary,
    fontSize: fontSize.lg,
    fontWeight: '600',
    marginTop: spacing.lg,
  },
  loadingSubtext: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  errorIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.error + '1A',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  errorIconLarge: {
    fontSize: 28,
    color: colors.error,
  },
  errorTitle: {
    color: colors.textPrimary,
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  errorText: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 280,
  },
  retryBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    marginTop: spacing.lg,
  },
  retryBtnText: {
    color: colors.white,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  previewContent: {
    gap: spacing.xl,
  },
  qualitySection: {
    gap: spacing.md,
  },
  qualityTitle: {
    color: colors.textPrimary,
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  qualityGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  qualityOption: {
    backgroundColor: colors.bgCard,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    minWidth: 90,
  },
  qualityOptionActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accent + '15',
  },
  qualityLabel: {
    color: colors.textPrimary,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  qualityLabelActive: {
    color: colors.accent,
  },
  qualitySize: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  downloadSection: {
    marginTop: spacing.sm,
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bgCard,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.lg,
  },
  shareIcon: {
    color: colors.accent,
    fontSize: fontSize.xl,
  },
  shareBtnText: {
    color: colors.accent,
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
  urlInfo: {
    backgroundColor: colors.bgCard,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  urlLabel: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  urlText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
});
