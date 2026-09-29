const PALETTE = { path: "#d8f36a", ghost: "#81978b", ink: "#163c35" };
const DRAWING = { width: 600, height: 420, durationMs: 450, maxPixelRatio: 2 };

// Coordinates are in a 600 × 420 design space, matching the SVG fallback and HTML labels.
const PATH = {
  start: { x: 55, y: 350 },
  control: { x: 275, y: 350 },
  bend: { x: 260, y: 115 },
  target: { x: 485, y: 185 },
  uncorrectedY: 60,
  markerPositions: [0.38, 0.58, 0.77],
};

// Cubic Bézier interpolation puts the small markers on the same curve canvas draws.
function pointAt(t, endY) {
  const remaining = 1 - t;
  const { start, control, bend, target } = PATH;
  return {
    x:
      remaining ** 3 * start.x +
      3 * remaining ** 2 * t * control.x +
      3 * remaining * t ** 2 * bend.x +
      t ** 3 * target.x,
    y: remaining ** 3 * start.y + 3 * remaining ** 2 * t * control.y + 3 * remaining * t ** 2 * bend.y + t ** 3 * endY,
  };
}

function curve(ctx, endY) {
  const { start, control, bend, target } = PATH;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.bezierCurveTo(control.x, control.y, bend.x, bend.y, target.x, endY);
  ctx.stroke();
}

function dot(ctx, x, y, radius, fill) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

function draw(ctx, amount) {
  ctx.clearRect(0, 0, DRAWING.width, DRAWING.height);
  ctx.strokeStyle = PALETTE.ghost;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 8]);
  curve(ctx, PATH.uncorrectedY);
  ctx.setLineDash([]);

  // Ring radii and stroke widths are decorative pixels in the design space, not model scores.
  ctx.strokeStyle = PALETTE.path;
  for (const radius of [29, 42]) {
    ctx.globalAlpha = radius === 29 ? 0.8 : 0.25;
    ctx.beginPath();
    ctx.arc(PATH.target.x, PATH.target.y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  dot(ctx, PATH.target.x, PATH.target.y, 4, PALETTE.path);
  const endY = PATH.uncorrectedY + ((PATH.target.y - PATH.uncorrectedY) * amount) / 100;
  ctx.lineWidth = 2.6;
  curve(ctx, endY);
  dot(ctx, PATH.start.x, PATH.start.y, 6, PALETTE.path);
  dot(ctx, PATH.target.x, endY, 7, PALETTE.path);
  dot(ctx, PATH.target.x, endY, 3, PALETTE.ink);
  for (const position of PATH.markerPositions) {
    const point = pointAt(position, endY);
    dot(ctx, point.x, point.y, 3, PALETTE.path);
  }
}

export function initTrajectory() {
  const canvas = document.querySelector("#trajectory");
  const ctx = canvas.getContext("2d");
  if (!ctx) return; // Keep the SVG fallback when canvas is unavailable.
  const slider = document.querySelector("#nudge");
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let amount = Number(slider.value);
  let animation;

  function resize() {
    cancelAnimationFrame(animation);
    const { width, height } = canvas.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio || 1, DRAWING.maxPixelRatio);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(canvas.width / DRAWING.width, 0, 0, canvas.height / DRAWING.height, 0, 0);
    amount = Number(slider.value);
    draw(ctx, amount);
  }

  function update() {
    cancelAnimationFrame(animation);
    const target = Number(slider.value);
    slider.setAttribute("aria-valuetext", `${target} percent toward the intended direction`);
    if (motion.matches || document.hidden) {
      amount = target;
      draw(ctx, amount);
      return;
    }
    const start = performance.now();
    const initial = amount;
    function frame(now) {
      const progress = Math.min((now - start) / DRAWING.durationMs, 1);
      amount = initial + (target - initial) * (1 - (1 - progress) ** 3);
      draw(ctx, amount);
      if (progress < 1) animation = requestAnimationFrame(frame);
    }
    animation = requestAnimationFrame(frame);
  }

  // Draw only on input or resize: no idle animation and no offscreen render loop.
  slider.addEventListener("input", update);
  motion.addEventListener("change", update);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelAnimationFrame(animation);
      amount = Number(slider.value);
    } else resize();
  });
  new ResizeObserver(resize).observe(canvas);
  document.querySelector(".trajectory-controls").hidden = false;
  canvas.parentElement.classList.add("canvas-ready");
  slider.setAttribute("aria-valuetext", `${amount} percent toward the intended direction`);
  resize();
}
