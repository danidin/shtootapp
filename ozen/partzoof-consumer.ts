import { Kafka } from 'kafkajs';
import { shtoots, eventBus, SHTOOT_ADDED } from './resolvers';
import { Shtoot } from './entities';

// Configure as needed:
const kafka = new Kafka({
  clientId: 'ozen-graphql-server',
  brokers: ['kafka:9092']
});

const topic = 'shtootapp-events';

export const startKafkaConsumer = async () => {
  const consumer = kafka.consumer({ groupId: `ozen-consumer-group-${Math.random()}` });

  await consumer.connect();
  await consumer.subscribe({ topic, fromBeginning: true });

  await consumer.run({
    eachMessage: async ({ message }) => {
      // KafkaJS gives keys/values as Buffer or null
      const key = message.key?.toString();
      if (key !== 'shtoot-said') return;

      // Assuming the value is a JSON string representing the Shtoot entity:
      const valueStr = message.value?.toString();
      if (!valueStr) return;
      try {
        const shtoot: Shtoot = JSON.parse(valueStr);
        const timestamp = message.timestamp ? Number(message.timestamp) : Date.now()
        // Prevent duplicates if restarting
        if (!shtoots.some(s => s.ID === shtoot.ID)) {
          shtoots.push({ ...shtoot, timestamp });
          eventBus.emit(SHTOOT_ADDED, { ...shtoot, timestamp });
        }
      } catch (err) {
        console.error('[Kafka] Failed to parse shtoot:', err, valueStr);
      }
    }
  });

  console.log('🦻 ozen: Kafka consumer ready & listening for events.');
};
