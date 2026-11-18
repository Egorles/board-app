const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const PORT = process.env.PORT || '8787';
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const suites = (process.argv.slice(2).length ? process.argv.slice(2) : ['gestures', 'features', 'views', 'offline', 'polish', 'subtasks', 'update']);
const server = spawn(process.execPath, [path.join(__dirname, 'server.js'), PORT], { stdio: ['ignore', 'pipe', 'inherit'] });
server.stdout.once('data', () => {
  let failed = 0;
  for (const s of suites) {
    console.log(`\n# ${s}`);
    const r = spawnSync(process.execPath, [path.join(__dirname, s + '.js')], { stdio: 'inherit', env: { ...process.env, BASE: `http://localhost:${PORT}/`, OUT } });
    if (r.status !== 0) failed++;
  }
  server.kill();
  console.log(failed ? `\n${failed} suite(s) failed` : '\nAll suites passed');
  process.exit(failed ? 1 : 0);
});
