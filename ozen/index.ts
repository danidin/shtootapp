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
import { decodeJwtResponse } from './auth.js';

const PROTOCOL = 'https';
const WS_PROTOCOL = 'wss';
const HOSTNAME = '149.81.7.230';
const PORT = 4000;

const startServer = async () => {
  await Promise.all([
    startKafkaConsumer(),
    startKafkaProducer(),
  ]);
  
  const app = express();

  app.get('/health', (req: any, res: any) => {
    res.status(200).send('OK');
  });

  const schema = makeExecutableSchema({ typeDefs, resolvers });

  const server = new ApolloServer({
    schema,
    context: ({ req }) => {
      if (!req.headers.authorization) {
        return { user: null };
      }
      const token = req.headers.authorization.split(' ')[1];
      const user = decodeJwtResponse(token);
      return { user };
    },
   });

  await server.start();
  server.applyMiddleware({ app, path: '/graphql' });
  
  const httpServer = createServer(app);

  const wsServer = new WebSocketServer({
    server: httpServer,
    path: '/graphql',
  });

  useServer({
    schema,
    context: (ctx, msg, args) => {
      const token = ctx.connectionParams?.Authorization?.split(' ')[1];
      const user = decodeJwtResponse(token);
      return { user };
    },
  }, wsServer);

  httpServer.listen(PORT, () => {
    console.log(`🦻 ozen GraphQL server ready at ${PROTOCOL}://${HOSTNAME}:${PORT}/graphql`);
    console.log(`🦻 Subscriptions ready at ${WS_PROTOCOL}://${HOSTNAME}:${PORT}/graphql`);
  });
};
  // ...
};

startServer();
