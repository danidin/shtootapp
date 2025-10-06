import express from 'express';
import { ApolloServer } from 'apollo-server-express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/use/ws';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { typeDefs } from './typeDefs.js';
import { resolvers } from './resolvers.js';
import { startKafkaConsumer } from './partzoof-consumer.js';
import { startKafkaProducer } from './partzoof-producer.js';

const PORT = 4000;

const startServer = async () => {
  await Promise.all([
    startKafkaConsumer(),
    startKafkaProducer(),
  ]);
  
  const app = express();

  const schema = makeExecutableSchema({ typeDefs, resolvers });
  const server = new ApolloServer({ schema });

  await server.start();
  server.applyMiddleware({ app, path: '/graphql' });

  const httpServer = createServer(app);

  const wsServer = new WebSocketServer({
    server: httpServer,
    path: '/graphql',
  });

  useServer({ schema }, wsServer);

  httpServer.listen(PORT, () => {
    console.log(`🦻 ozen GraphQL server ready at http://localhost:${PORT}/graphql`);
    console.log(`🦻 Subscriptions ready at ws://localhost:${PORT}/graphql`);
  });
};

startServer();
