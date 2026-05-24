import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';

export interface DownloadProgress {
  totalBytesWritten: number;
  totalBytesExpectedToWrite: number;
  progress: number;
}

export type ProgressCallback = (progress: DownloadProgress) => void;

function getFileExtension(url: string, format?: string): string {
  if (format) {
    if (format.includes('mp4') || format.includes('video')) return '.mp4';
    if (format.includes('mp3') || format.includes('audio')) return '.mp3';
    if (format.includes('webm')) return '.webm';
    if (format.includes('jpg') || format.includes('jpeg')) return '.jpg';
    if (format.includes('png')) return '.png';
  }
  // Try to extract from URL
  const match = url.match(/\.(mp4|mp3|webm|jpg|jpeg|png|gif|mov|avi|mkv)/i);
  if (match) return '.' + match[1].toLowerCase();
  return '.mp4';
}

export async function downloadMedia(
  downloadUrl: string,
  filename: string,
  format?: string,
  onProgress?: ProgressCallback
): Promise<{ uri: string; saved: boolean }> {
  const { status } = await MediaLibrary.requestPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Permission d\'acces a la galerie refusee');
  }

  const ext = getFileExtension(downloadUrl, format);
  const sanitizedName = filename.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 80);
  const localUri = FileSystem.documentDirectory + sanitizedName + ext;

  const downloadResumable = FileSystem.createDownloadResumable(
    downloadUrl,
    localUri,
    {},
    (downloadProgress) => {
      if (onProgress) {
        const progress =
          downloadProgress.totalBytesExpectedToWrite > 0
            ? downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite
            : 0;
        onProgress({
          totalBytesWritten: downloadProgress.totalBytesWritten,
          totalBytesExpectedToWrite: downloadProgress.totalBytesExpectedToWrite,
          progress,
        });
      }
    }
  );

  const result = await downloadResumable.downloadAsync();
  if (!result || !result.uri) {
    throw new Error('Echec du telechargement');
  }

  try {
    const asset = await MediaLibrary.createAssetAsync(result.uri);
    if (asset) {
      // Clean up temp file
      await FileSystem.deleteAsync(result.uri, { idempotent: true });
      return { uri: asset.uri, saved: true };
    }
  } catch (err) {
    console.warn('Could not save to media library:', err);
  }

  return { uri: result.uri, saved: false };
}

export async function shareMedia(uri: string): Promise<void> {
  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new Error('Le partage n\'est pas disponible sur cet appareil');
  }
  await Sharing.shareAsync(uri);
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}
