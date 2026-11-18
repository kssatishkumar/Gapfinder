import awsLambdaFastify from '@fastify/aws-lambda';
import { buildApp } from './app';

const app = buildApp({ logger: true });
const proxy = awsLambdaFastify(app);
await app.ready();

export const handler = proxy;
