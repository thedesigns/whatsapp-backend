import { Expo, ExpoPushMessage } from 'expo-server-sdk';

const expo = new Expo();

export const sendPushNotification = async (
  pushToken: string,
  title: string,
  body: string,
  data?: any
) => {
  if (!Expo.isExpoPushToken(pushToken)) {
    console.error(`❌ Push token ${pushToken} is not a valid Expo push token`);
    return;
  }

  const message: ExpoPushMessage = {
    to: pushToken,
    sound: 'default',
    title,
    body,
    data,
    priority: 'high',
    channelId: 'default',
  };

  try {
    const ticketChunk = await expo.sendPushNotificationsAsync([message]);
    console.log('✅ Push notification sent successfully:', ticketChunk);
  } catch (error) {
    console.error('❌ Error sending push notification:', error);
  }
};
