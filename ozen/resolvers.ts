import EventEmitter from 'events';
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
    shtoots: () => shtoots,
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
    createShtoot: async (_: any, { userID, text }: { userID: string, text: string }) => {
      const shtoot = { ID: generateID(), userID, text };
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
      subscribe: async function* () {
        const queue: Shtoot[] = [...shtoots];
        const handler = (shtoot: Shtoot) => queue.push(shtoot);

        eventBus.on(SHTOOT_ADDED, handler);

        try {
          while (true) {
            if (queue.length === 0) {
              await new Promise(resolve => {
                const check = () => {
                  if (queue.length > 0) {
                    eventBus.off(SHTOOT_ADDED, check);
                    resolve(null);
                  }
                };
                eventBus.on(SHTOOT_ADDED, check);
              });
            }
            while (queue.length > 0) {
              yield { shtootAdded: queue.shift() };
            }
          }
        } finally {
          eventBus.off(SHTOOT_ADDED, handler);
        }
      }
    }
  }
};
