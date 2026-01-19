import EventEmitter from 'events';
import { GraphQLError } from 'graphql';
import { User, Shtoot, Service } from './entities.js';
import { sendShtootSaidEvent } from './partzoof-producer.js';

export const eventBus = new EventEmitter();
export const SHTOOT_ADDED = 'SHTOOT_ADDED';

export const users: User[] = [];
export const shtoots: Shtoot[] = [];
export const services: Service[] = [];

const generateID = () => Math.random().toString(36).substring(2, 12);

export const resolvers = {
  Query: {
    users: () => users,
    user: (_: any, { ID }: { ID: string }) => users.find(u => u.ID === ID),
    shtoots: (_: any, __: any, context: { user?: { email: string } }) => {
      const user = context.user;
      if (user) {
        return shtoots.filter(s => !s.space || s.space.includes(user.email));
      }
      return shtoots;
    },
    shtoot: (_: any, { ID }: { ID: string }) => shtoots.find(s => s.ID === ID),
    services: () => services,
    service: (_: any, { ID }: { ID: string }) => services.find(s => s.ID === ID),
  },
  Mutation: {
    createUser: (_: any, { email, displayName }: { email: string, displayName: string }) => {
      const user = { ID: generateID(), email, displayName };
      users.push(user);
      return user;
    },
    createShtoot: async (_: any, { userID, text, space }: { userID: string, text: string, space?: string }, context: { user?: { email: string } }) => {
      if (space && (!context.user || !space.includes(context.user.email))) {
        throw new GraphQLError('You are not a member of this space', {
          extensions: { code: 'FORBIDDEN', http: { status: 403 } }
        });
      }
      const shtoot: Shtoot = { ID: generateID(), userID, text, timestamp: 0, space: space || '' };
      await sendShtootSaidEvent(shtoot);
      return shtoot;
    },
    createService: (_: any, { pathToContract }: { pathToContract: string }) => {
      const service = { ID: generateID(), pathToContract };
      services.push(service);
      return service;
    },
  },
  Subscription: {
    shtootAdded: {
      subscribe: async function* (_: any, __: any, context: { user?: { email: string } }) {
        const user = context.user;
        const queue: Shtoot[] = shtoots.filter(s => !s.space || (user && s.space.includes(user.email)));

        const handler = (shtoot: Shtoot) => {
          if (!shtoot.space || (user && shtoot.space.includes(user.email))) {
            queue.push(shtoot);
          }
        };

        eventBus.on(SHTOOT_ADDED, handler);

        try {
          while (true) {
            if (queue.length > 0) {
              yield { shtootAdded: queue.shift() };
            } else {
              await new Promise(resolve => {
                const check = (shtoot: Shtoot) => {
                  if (!shtoot.space || (user && shtoot.space.includes(user.email))) {
                    eventBus.off(SHTOOT_ADDED, check);
                    resolve(null);
                  }
                };
                eventBus.on(SHTOOT_ADDED, check);
              });
            }
          }
        } finally {
          eventBus.off(SHTOOT_ADDED, handler);
        }
      }
    }
  }
};
