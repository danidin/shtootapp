import { Kafka } from 'kafkajs';
import { shtoots, eventBus, SHTOOT_ADDED } from './resolvers.js';
import { Shtoot } from './entities.js';
import { sendToTokens, isFcmReady } from './fcm.js';
import { sendFcmTokenRemovedEvent } from './partzoof-producer.js';

// Configure as needed:
const kafka = new Kafka({
  clientId: 'ozen-consumer',
  brokers: [process.env.KAFKA_BROKER || ''],
  retry: {
    initialRetryTime: 300,
    retries: 50
  }
});

const topic = 'shtootapp-events';

export const publicKeys: Map<string, string> = new Map();
export const fcmTokens: Map<string, Set<string>> = new Map();

const addFcmToken = (email: string, token: string) => {
  let set = fcmTokens.get(email);
  if (!set) {
    set = new Set();
    fcmTokens.set(email, set);
  }
  set.add(token);
};

const removeFcmToken = (email: string | null, token: string) => {
  if (email) {
    fcmTokens.get(email)?.delete(token);
    return;
  }
  for (const set of fcmTokens.values()) set.delete(token);
};

const pushShtootToRecipients = async (shtoot: Shtoot) => {
  if (!isFcmReady() || !shtoot.space) return;
  const members = shtoot.space.split(',').map(s => s.trim()).filter(Boolean);
  const recipients = members.filter(m => m !== shtoot.userID);
  for (const recipient of recipients) {
    const tokens = Array.from(fcmTokens.get(recipient) || []);
    if (tokens.length === 0) continue;
    const result = await sendToTokens(tokens, {
      type: 'shtoot',
      shtootId: shtoot.ID,
      senderID: shtoot.userID,
      space: shtoot.space,
      targetUser: recipient,
      payload: shtoot.text,
    });
    for (const t of result.invalidTokens) {
      removeFcmToken(recipient, t);
      await sendFcmTokenRemovedEvent(recipient, t).catch(() => {});
    }
  }
};

export const startKafkaConsumer = async () => {
  const consumer = kafka.consumer({ groupId: `ozen-consumer-group-${Math.random()}` });

  await consumer.connect();
  await consumer.subscribe({ topic, fromBeginning: true });

  await consumer.run({
    eachMessage: async ({ message }) => {
      // KafkaJS gives keys/values as Buffer or null
      const key = message.key?.toString();

      if (key === 'key-created') {
        const valueStr = message.value?.toString();
        if (!valueStr) return;
        try {
          const { email, publicKey } = JSON.parse(valueStr);
          if (email && publicKey) publicKeys.set(email, publicKey);
        } catch (err) {
          console.error('[Kafka] Failed to parse key-created event:', err);
        }
        return;
      }

      if (key === 'fcm-token-registered') {
        const valueStr = message.value?.toString();
        if (!valueStr) return;
        try {
          const { email, token } = JSON.parse(valueStr);
          if (email && token) addFcmToken(email, token);
        } catch (err) {
          console.error('[Kafka] Failed to parse fcm-token-registered event:', err);
        }
        return;
      }

      if (key === 'fcm-token-removed') {
        const valueStr = message.value?.toString();
        if (!valueStr) return;
        try {
          const { email, token } = JSON.parse(valueStr);
          if (token) removeFcmToken(email ?? null, token);
        } catch (err) {
          console.error('[Kafka] Failed to parse fcm-token-removed event:', err);
        }
        return;
      }

      if (key !== 'shtoot-said') return;

      // Assuming the value is a JSON string representing the Shtoot entity:
      const valueStr = message.value?.toString();
      if (!valueStr) return;
      try {
        const shtoot: Shtoot = JSON.parse(valueStr);
        const timestamp = message.timestamp ? Number(message.timestamp) : Date.now()
        // Prevent duplicates if restarting
        if (!shtoots.some(s => s.ID === shtoot.ID)) {
          const stamped = { ...shtoot, timestamp };
          shtoots.push(stamped);
          eventBus.emit(SHTOOT_ADDED, stamped);
          pushShtootToRecipients(stamped).catch(err => {
            console.error('🦻 FCM push failed:', err);
          });
        }
      } catch (err) {
        console.error('[Kafka] Failed to parse shtoot:', err, valueStr);
      }
    }
  });

  console.log('🦻 ozen: Kafka consumer ready & listening for events.');
};
