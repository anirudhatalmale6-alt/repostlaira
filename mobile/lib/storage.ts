import AsyncStorage from '@react-native-async-storage/async-storage';

const HISTORY_KEY = 'download_history';

export interface DownloadHistoryItem {
  id: string;
  url: string;
  title: string;
  thumbnail: string;
  platform: string;
  uploader: string;
  downloadedAt: string;
  fileUri?: string;
}

export async function getHistory(): Promise<DownloadHistoryItem[]> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveToHistory(item: Omit<DownloadHistoryItem, 'id' | 'downloadedAt'>): Promise<void> {
  try {
    const history = await getHistory();
    const newItem: DownloadHistoryItem = {
      ...item,
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 8),
      downloadedAt: new Date().toISOString(),
    };
    history.unshift(newItem);
    // Keep only last 100 items
    const trimmed = history.slice(0, 100);
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
  } catch (err) {
    console.error('Failed to save history:', err);
  }
}

export async function deleteFromHistory(id: string): Promise<void> {
  try {
    const history = await getHistory();
    const filtered = history.filter(item => item.id !== id);
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(filtered));
  } catch (err) {
    console.error('Failed to delete history item:', err);
  }
}

export async function clearHistory(): Promise<void> {
  try {
    await AsyncStorage.removeItem(HISTORY_KEY);
  } catch (err) {
    console.error('Failed to clear history:', err);
  }
}

export async function getHistoryCount(): Promise<number> {
  const history = await getHistory();
  return history.length;
}
