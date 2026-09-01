import { createTRPCRouter } from '../init';
import { adminRouter } from './admin';
import { checkoutRouter } from './checkout';
import { eventsRouter } from './events';
import { ordersRouter } from './orders';
import { ticketsRouter } from './tickets';

export const appRouter = createTRPCRouter({
  admin: adminRouter,
  checkout: checkoutRouter,
  events: eventsRouter,
  orders: ordersRouter,
  tickets: ticketsRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
