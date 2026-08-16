import fs from 'fs';

const lines = ['Initialize engine version: 2022.3.12f1'];
for (let i = 0; i < 5000; i++) {
  const h = String(Math.floor(i / 3600)).padStart(2, '0');
  const m = String(Math.floor((i % 3600) / 60)).padStart(2, '0');
  const s = String(i % 60).padStart(2, '0');
  const ts = `${h}:${m}:${s}.100`;

  if (i === 10) {
    lines.push(`${ts} [SceneLoader] Loaded Scene: Level01`);
  } else if (i === 100) {
    lines.push(`${ts} [WARNING] NULL target in tween callback`);
  } else if (i === 500) {
    lines.push(`${ts} NullReferenceException: Object reference not set to an instance of an object`);
  } else if (i === 501) {
    lines.push(`${ts} NullReferenceException: Object reference not set to an instance of an object`);
  } else if (i === 2000) {
    lines.push(`${ts} [SceneLoader] Loaded Scene: Level02`);
  } else if (i === 2500) {
    lines.push(`${ts} Cannot throw a kinematic rigidbody without disabling isKinematic first.`);
  } else {
    lines.push(`${ts} [LogSys] Update tick #${i} player position ${(i * 0.1).toFixed(1)}, 0, 0`);
  }
}

fs.writeFileSync('tests/fixtures/large_session.txt', lines.join('\n'));
console.log('Created large_session.txt with', lines.length, 'lines');
