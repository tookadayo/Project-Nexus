// Synthetic lifecycle fixture: never imports NEXUS runtime, DB, Discord, Next or Operator.
import process from 'node:process';
import { setInterval, setTimeout, clearInterval } from 'node:timers';
const mode = process.argv[2] || 'normal';
process.stdout.write('SYNTHETIC_SECRET_NOT_FOR_LOGS\n');
process.stderr.write('SYNTHETIC_SECRET_NOT_FOR_LOGS\n');
const timer = setInterval(() => {}, 50);
if (mode === 'before-ready') process.exit(9);
if (mode !== 'pending') process.send({type:'ready'});
if (mode === 'after-ready') setTimeout(() => process.exit(9), 30);
process.on('message', message => {
  if (message?.type === 'stop' && mode !== 'ignore-stop') {
    clearInterval(timer); process.exit(0);
  }
});
process.on('disconnect', () => { clearInterval(timer); process.exit(0); });