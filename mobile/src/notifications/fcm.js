import messaging from '@react-native-firebase/messaging';

export async function initFCM() {
  try {
    const authStatus = await messaging().requestPermission();
    const enabled =
      authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL;

    if (enabled) {
      const token = await messaging().getToken();
      console.log('FCM Token:', token);
      // TODO: send token to server when endpoint is ready
    }
  } catch (e) {
    console.warn('FCM init failed:', e);
  }
}

export function setupFCMListeners() {
  // Foreground messages
  messaging().onMessage(async (remoteMessage) => {
    console.log('FCM message (foreground):', remoteMessage);
    // TODO: show in-app notification
  });

  // Background/quit message handler
  messaging().setBackgroundMessageHandler(async (remoteMessage) => {
    console.log('FCM message (background):', remoteMessage);
  });
}
