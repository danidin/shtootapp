import { Kafka } from 'kafkajs';
import { Shtoot } from './entities';

const kafka = new Kafka({
  clientId: 'ozen-graphql-server',
  brokers: ['kafka:9092']
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
