import { createTRPCRouter } from '../init';
import { adminRouter } from './admin';
import { eventsRouter } from './events';
import { ticketsRouter } from './tickets';

export const appRouter = createTRPCRouter({
  admin: adminRouter,
  events: eventsRouter,
  tickets: ticketsRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
