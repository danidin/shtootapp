import express from 'express';
import { ApolloServer } from 'apollo-server-express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/use/ws';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { typeDefs } from './typeDefs';
import { resolvers } from './resolvers';
import { startKafkaConsumer } from './partzoof-consumer';
import { startKafkaProducer } from './partzoof-producer';

const PORT = 4000;

const startServer = async () => {
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

  useServer({ schema, connectionInitWaitTimeout: 15000 }, wsServer);

  await Promise.all([
    startKafkaConsumer(),
    startKafkaProducer(),
  ]);

  httpServer.listen(PORT, () => {
    console.log(`🦻 ozen GraphQL server ready at http://localhost:${PORT}/graphql`);
    console.log(`🦻 Subscriptions ready at ws://localhost:${PORT}/graphql`);
  });
};

startServer();
