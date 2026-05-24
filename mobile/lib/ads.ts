import { Platform } from 'react-native';
import {
  InterstitialAd,
  RewardedAd,
  BannerAdSize,
  TestIds,
  AdEventType,
  RewardedAdEventType,
} from 'react-native-google-mobile-ads';

const IS_TEST = __DEV__;

const AD_UNIT_IDS = {
  banner: IS_TEST
    ? TestIds.BANNER
    : Platform.select({
        ios: 'ca-app-pub-REPLACE_WITH_REAL_ID/banner_ios',
        android: 'ca-app-pub-REPLACE_WITH_REAL_ID/banner_android',
      }) || TestIds.BANNER,
  interstitial: IS_TEST
    ? TestIds.INTERSTITIAL
    : Platform.select({
        ios: 'ca-app-pub-REPLACE_WITH_REAL_ID/interstitial_ios',
        android: 'ca-app-pub-REPLACE_WITH_REAL_ID/interstitial_android',
      }) || TestIds.INTERSTITIAL,
  rewarded: IS_TEST
    ? TestIds.REWARDED
    : Platform.select({
        ios: 'ca-app-pub-REPLACE_WITH_REAL_ID/rewarded_ios',
        android: 'ca-app-pub-REPLACE_WITH_REAL_ID/rewarded_android',
      }) || TestIds.REWARDED,
};

export { AD_UNIT_IDS, BannerAdSize, TestIds };

let interstitialAd: InterstitialAd | null = null;
let interstitialLoaded = false;

export function loadInterstitial(): void {
  try {
    interstitialAd = InterstitialAd.createForAdRequest(AD_UNIT_IDS.interstitial, {
      requestNonPersonalizedAdsOnly: true,
    });

    interstitialAd.addAdEventListener(AdEventType.LOADED, () => {
      interstitialLoaded = true;
    });

    interstitialAd.addAdEventListener(AdEventType.CLOSED, () => {
      interstitialLoaded = false;
      loadInterstitial();
    });

    interstitialAd.addAdEventListener(AdEventType.ERROR, () => {
      interstitialLoaded = false;
      setTimeout(loadInterstitial, 30000);
    });

    interstitialAd.load();
  } catch (e) {
    console.log('[ads] Failed to load interstitial:', e);
  }
}

export function showInterstitial(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!interstitialAd || !interstitialLoaded) {
      resolve(false);
      return;
    }
    try {
      interstitialAd.addAdEventListener(AdEventType.CLOSED, () => {
        resolve(true);
      });
      interstitialAd.show();
    } catch (e) {
      console.log('[ads] Failed to show interstitial:', e);
      resolve(false);
    }
  });
}

let rewardedAd: RewardedAd | null = null;
let rewardedLoaded = false;

export function loadRewarded(): void {
  try {
    rewardedAd = RewardedAd.createForAdRequest(AD_UNIT_IDS.rewarded, {
      requestNonPersonalizedAdsOnly: true,
    });

    rewardedAd.addAdEventListener(RewardedAdEventType.LOADED, () => {
      rewardedLoaded = true;
    });

    rewardedAd.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
      // Reward will be handled by the caller
    });

    rewardedAd.addAdEventListener(AdEventType.CLOSED, () => {
      rewardedLoaded = false;
      loadRewarded();
    });

    rewardedAd.addAdEventListener(AdEventType.ERROR, () => {
      rewardedLoaded = false;
      setTimeout(loadRewarded, 30000);
    });

    rewardedAd.load();
  } catch (e) {
    console.log('[ads] Failed to load rewarded:', e);
  }
}

export function showRewarded(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!rewardedAd || !rewardedLoaded) {
      resolve(false);
      return;
    }
    try {
      rewardedAd.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
        resolve(true);
      });
      rewardedAd.addAdEventListener(AdEventType.CLOSED, () => {
        resolve(false);
      });
      rewardedAd.show();
    } catch (e) {
      console.log('[ads] Failed to show rewarded:', e);
      resolve(false);
    }
  });
}

export function initAds(): void {
  loadInterstitial();
  loadRewarded();
}
