import 'fastify';

declare module 'fastify' {
  interface Session {
    authenticated?: boolean;
    username?: string;
  }
}
