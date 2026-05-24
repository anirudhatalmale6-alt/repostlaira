import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE_URL = 'http://localhost:3010';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use(
  async (config) => {
    try {
      const token = await AsyncStorage.getItem('auth_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch {}
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      AsyncStorage.removeItem('auth_token');
    }
    return Promise.reject(error);
  }
);

export interface ExtractRequest {
  url: string;
}

export interface MediaFormat {
  format_id: string;
  quality: string;
  format: string;
  url: string;
  ext: string;
  filesize?: number | null;
  has_audio: boolean;
  has_video: boolean;
}

export interface ExtractResponse {
  platform: string;
  id: string;
  title: string;
  thumbnail: string | null;
  uploader: string | null;
  duration?: number | null;
  formats: MediaFormat[];
}

export const extractMedia = async (url: string): Promise<ExtractResponse> => {
  const response = await api.post('/api/extract', { url });
  return response.data.data;
};

export default api;
