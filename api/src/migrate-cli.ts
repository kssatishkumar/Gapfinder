import { migrate } from './migrate';
import { closePool } from './db';

migrate()
  .then(() => closePool())
  .catch(async e => {
    console.error(e);
    await closePool();
    process.exit(1);
  });
