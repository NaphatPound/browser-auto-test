import { Recorder } from './recorder.js';
import { generate } from './codegen.js';
import { serializeSuite } from './storage.js';

const r = new Recorder();
r.start('https://example.com');
r.navigate('https://example.com/login');
r.capture('fill', { attrs: { name: 'username' } }, { text: 'alice' });
r.capture('fill', { attrs: { name: 'password' } }, { text: 'secret' });
r.capture('click', { attrs: { 'data-testid': 'submit' } });
r.capture('assertVisible', { text: 'Welcome, alice' });

const suite = r.toSuite('login flow');

console.log('--- JSON suite ---');
console.log(serializeSuite(suite));
console.log('\n--- Playwright ---');
console.log(generate(suite, 'playwright'));
console.log('\n--- Cypress ---');
console.log(generate(suite, 'cypress'));
