import admin from 'firebase-admin';
import { readFileSync } from 'fs';

let initialized = false;

export const initFcm = () => {
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!path) {
    console.warn('🦻 FIREBASE_SERVICE_ACCOUNT_PATH not set — FCM push disabled');
    return;
  }
  try {
    const serviceAccount = JSON.parse(readFileSync(path, 'utf8'));
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    initialized = true;
    console.log('🦻 firebase-admin initialized');
  } catch (err) {
    console.error('🦻 firebase-admin init failed:', err);
  }
};

export const isFcmReady = () => initialized;

export interface FcmResult {
  successCount: number;
  failureCount: number;
  invalidTokens: string[];
}

export const sendToTokens = async (
  tokens: string[],
  data: Record<string, string>,
): Promise<FcmResult> => {
  if (!initialized || tokens.length === 0) {
    return { successCount: 0, failureCount: 0, invalidTokens: [] };
  }
  const message: admin.messaging.MulticastMessage = {
    tokens,
    data,
    android: { priority: 'high' },
  };
  const resp = await admin.messaging().sendEachForMulticast(message);
  const invalidTokens: string[] = [];
  resp.responses.forEach((r, i) => {
    if (!r.success && r.error) {
      const code = r.error.code;
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-argument' ||
        code === 'messaging/invalid-registration-token'
      ) {
        invalidTokens.push(tokens[i]);
      } else {
        console.error('🦻 FCM send error:', code, r.error.message);
      }
    }
  });
  return {
    successCount: resp.successCount,
    failureCount: resp.failureCount,
    invalidTokens,
  };
};
