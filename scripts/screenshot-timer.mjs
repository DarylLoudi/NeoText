// The small web project the screenshot script has the model write, for the preview panel.
export const TIMER_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Study timer</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<main>
  <p class="mode">Focus</p>
  <h1 id="clock">25:00</h1>
  <div class="actions">
    <button id="start">Start</button>
    <button id="reset" class="quiet">Reset</button>
  </div>
  <section>
    <h2>Today</h2>
    <ol id="log"></ol>
  </section>
</main>
<script src="app.js"></script>
</body>
</html>`;
export const TIMER_CSS = `* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center;
  font: 16px/1.5 system-ui, sans-serif; background: #f3efe6; color: #2b2a27; }
main { width: min(340px, 90vw); text-align: center; }
.mode { margin: 0; color: #b4532a; font-weight: 600; letter-spacing: .02em; }
#clock { margin: .1em 0 .3em; font-size: 88px; font-weight: 700;
  font-variant-numeric: tabular-nums; line-height: 1; }
.actions { display: flex; gap: 10px; justify-content: center; }
button { font: inherit; padding: 10px 26px; border-radius: 999px; cursor: pointer;
  border: 2px solid #2b2a27; background: #2b2a27; color: #f3efe6; }
button.quiet { background: transparent; color: #2b2a27; }
section { margin-top: 32px; text-align: left; border-top: 1px solid #d8d0c0; padding-top: 12px; }
h2 { font-size: 14px; margin: 0 0 6px; color: #6d675c; font-weight: 600; }
ol { margin: 0; padding-left: 20px; }
li { padding: 2px 0; }
@media (prefers-color-scheme: dark) {
  body { background: #1f1d1a; color: #efe9dd; }
  button { border-color: #efe9dd; background: #efe9dd; color: #1f1d1a; }
  button.quiet { background: transparent; color: #efe9dd; }
  section { border-color: #3d3a34; }
  h2 { color: #a39c8e; }
}`;
export const TIMER_JS = `const clock = document.getElementById('clock');
const log = document.getElementById('log');
const sessions = JSON.parse(localStorage.getItem('sessions') || '[]');
let left = 25 * 60;
let timer = null;
const show = () => {
  clock.textContent = String(Math.floor(left / 60)).padStart(2, '0') + ':' +
    String(left % 60).padStart(2, '0');
};
const render = () => {
  log.innerHTML = '';
  for (const s of sessions) {
    const item = document.createElement('li');
    item.textContent = s;
    log.append(item);
  }
};
document.getElementById('start').addEventListener('click', () => {
  if (timer) return;
  timer = setInterval(() => {
    left -= 1;
    show();
    if (left === 0) {
      clearInterval(timer);
      timer = null;
      sessions.push('Focus, 25 min');
      localStorage.setItem('sessions', JSON.stringify(sessions));
      render();
    }
  }, 1000);
});
document.getElementById('reset').addEventListener('click', () => {
  clearInterval(timer);
  timer = null;
  left = 25 * 60;
  show();
});
if (sessions.length === 0) {
  sessions.push('Focus, 25 min', 'Focus, 25 min', 'Focus, 25 min');
  localStorage.setItem('sessions', JSON.stringify(sessions));
}
render();
console.log('Timer ready with ' + sessions.length + ' sessions today');`;
