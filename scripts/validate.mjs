// Validates public/agent-data/*.json against agents/DATA_SCHEMA.md.
// Exit code 1 on any error — used before commits and in the deploy build.
import { validateAll } from './lib.mjs';

const errors = validateAll();
if (errors.length) {
  console.error(`Agent data INVALID (${errors.length} problem${errors.length > 1 ? 's' : ''}):`);
  errors.slice(0, 50).forEach((e) => console.error(' - ' + e));
  process.exit(1);
}
console.log('Agent data valid.');
