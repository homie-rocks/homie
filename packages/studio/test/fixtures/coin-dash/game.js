// Coin Dash: a tiny single-player game (a port-skill fixture). Arrow keys move, Space starts.
(function () {
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var W = 800, H = 600;
  var player = { x: 400, y: 300, r: 14, speed: 240 };
  var coins = [];
  var keys = {};
  var score = 0;
  var best = Number(localStorage.getItem('coin-dash-best') || 0);
  var timeLeft = 60;
  var state = 'title';
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function spawnCoin() { return { x: 40 + Math.random() * (W - 80), y: 40 + Math.random() * (H - 80) }; }
  for (var i = 0; i < 8; i++) coins.push(spawnCoin());
  document.addEventListener('keydown', function (e) {
    keys[e.keyCode] = true;
    if (state !== 'play' && e.keyCode === 32) { state = 'play'; score = 0; timeLeft = 60; }
  });
  document.addEventListener('keyup', function (e) { keys[e.keyCode] = false; });
  function update(dt) {
    if (state !== 'play') return;
    var dx = (keys[39] ? 1 : 0) - (keys[37] ? 1 : 0);
    var dy = (keys[40] ? 1 : 0) - (keys[38] ? 1 : 0);
    var len = Math.hypot(dx, dy) || 1;
    player.x = clamp(player.x + (dx / len) * player.speed * dt, player.r, W - player.r);
    player.y = clamp(player.y + (dy / len) * player.speed * dt, player.r, H - player.r);
    for (var i = 0; i < coins.length; i++) {
      if (Math.hypot(coins[i].x - player.x, coins[i].y - player.y) < player.r + 10) { score += 1; coins[i] = spawnCoin(); }
    }
    timeLeft -= dt;
    if (timeLeft <= 0) {
      state = 'over';
      if (score > best) { best = score; localStorage.setItem('coin-dash-best', String(best)); }
    }
  }
  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#ffd166';
    coins.forEach(function (c) { ctx.beginPath(); ctx.arc(c.x, c.y, 10, 0, Math.PI * 2); ctx.fill(); });
    ctx.fillStyle = '#7df0ff';
    ctx.beginPath(); ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '20px sans-serif';
    ctx.fillText('Score ' + score + '   Best ' + best + '   Time ' + Math.ceil(Math.max(0, timeLeft)), 16, 30);
    if (state === 'title') ctx.fillText('Press Space to start', 300, 300);
    if (state === 'over') ctx.fillText('Time! Space to play again', 280, 300);
  }
  var last = performance.now();
  function frame(t) { update(Math.min(0.05, (t - last) / 1000)); last = t; draw(); requestAnimationFrame(frame); }
  requestAnimationFrame(frame);
})();
