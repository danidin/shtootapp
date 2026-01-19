import express from 'express';
import { ApolloServer, AuthenticationError } from 'apollo-server-express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/use/ws';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { typeDefs } from './typeDefs.js';
import { resolvers } from './resolvers.js';
import { startKafkaConsumer } from './partzoof-consumer.js';
import { startKafkaProducer } from './partzoof-producer.js';
import { decodeJwtResponse } from './auth.js';

const PROTOCOL = process.env.OZEN_PROTOCOL;
const WS_PROTOCOL = process.env.OZEN_WS_PROTOCOL;
const HOSTNAME = process.env.OZEN_HOST;
const PORT = process.env.OZEN_PORT;

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

  const isDev = process.env.NODE_ENV === 'development';

  const server = new ApolloServer({
    schema,
    introspection: isDev,
    plugins: isDev ? [] : [
      {
        async serverWillStart() {
          return {
            async renderLandingPage() {
              return { html: '<html><body>Not found</body></html>' };
            },
          };
        },
      },
    ],
    context: ({ req }) => {
      if (!req.headers.authorization) {
        throw new AuthenticationError('Authentication required');
      }
      const token = req.headers.authorization.split(' ')[1];
      const user = decodeJwtResponse(token);
      if (!user) {
        throw new AuthenticationError('Invalid token');
      }
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
    onConnect: (ctx) => {
      const auth = ctx.connectionParams?.Authorization;
      const token = typeof auth === 'string' ? auth.split(' ')[1] : undefined;
      const user = decodeJwtResponse(token);
      if (!user) {
        return false;
      }
      return true;
    },
    context: (ctx) => {
      const auth = ctx.connectionParams?.Authorization;
      const token = typeof auth === 'string' ? auth.split(' ')[1] : undefined;
      const user = decodeJwtResponse(token);
      return { user };
    },
  }, wsServer);

  httpServer.listen(PORT, () => {
    console.log(`🦻 ozen GraphQL server ready at ${PROTOCOL}://${HOSTNAME}:${PORT}/graphql`);
    console.log(`🦻 Subscriptions ready at ${WS_PROTOCOL}://${HOSTNAME}:${PORT}/graphql`);
  });
};

startServer();
