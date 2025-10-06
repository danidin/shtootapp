import { Kafka } from 'kafkajs';
import { Shtoot } from './entities.js';

const kafka = new Kafka({
  clientId: 'ozen-producer',
  brokers: ['partzoof.shtootnet.shtoot.oraclevcn.com:9092'],
  retry: {
    initialRetryTime: 300,
    retries: 50
  }
});

const topic = 'shtootapp-events';

const producer = kafka.producer();

export const startKafkaProducer = async () => {
  await producer.connect();
};

export const sendShtootSaidEvent = async (shtoot: Omit<Shtoot, 'timestamp'>) => {
  await producer.send({
    topic,
    messages: [
      {
        key: 'shtoot-said',
        value: JSON.stringify(shtoot),
      },
    ],
  });
};

export { producer };
