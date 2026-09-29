// Hold each cue long enough to read; returning to a passage can trigger it again.
const CUE_DURATION_MS = 2800;
const READING_BAND_PX = 110;
// Leaving a wider band rearms the cue without retriggering on tiny scroll adjustments.
const REARM_BAND_PX = 190;
const SETTLE_MS = 120;
const TOP_SAFE_PX = 80;
// The pencil crosses half the viewport, tilting a little further as the reader reaches the footer.
const TRAVEL = { start: 0.2, distance: 0.5, initialTilt: -12, tiltChange: -12 };
const ARROW = {
  textGap: 5,
  maxTextInset: 26,
  maxLength: 140,
  leadIn: 18,
  bend: 24,
  edgeInset: 6,
  headWidth: 7,
  headHeight: 5,
};

/** Recalculate viewport coordinates so a lingering arrow follows its moving target. */
function pointArrow(pencil, arrow, box) {
  const tip = pencil.querySelector(".pencil-tip").getBoundingClientRect();
  const pencilTip = { x: tip.left + tip.width / 2, y: tip.bottom };
  const end = { x: box.left - ARROW.textGap, y: box.top + Math.min(box.height / 2, ARROW.maxTextInset) };
  // Finish horizontally so the curve cannot crowd either wing of the arrowhead.
  const join = { x: end.x - ARROW.leadIn, y: end.y };
  const control = { x: Math.max(ARROW.edgeInset, join.x - ARROW.bend), y: end.y };
  // A Bezier curve is no longer than its control polygon. Reserve the straight
  // lead-in, then bound the tail's reach; beyond it, the pencil moves independently.
  const reach = ARROW.maxLength - ARROW.leadIn - Math.abs(join.x - control.x);
  const distance = Math.hypot(pencilTip.x - control.x, pencilTip.y - control.y);
  const scale = Math.min(1, reach / (distance || 1));
  const start = {
    x: control.x + (pencilTip.x - control.x) * scale,
    y: control.y + (pencilTip.y - control.y) * scale,
  };
  arrow
    .querySelector(".arrow-stem")
    .setAttribute("d", `M${start.x} ${start.y} Q${control.x} ${control.y} ${join.x} ${join.y} L${end.x} ${end.y}`);
  arrow
    .querySelector(".arrow-head")
    .setAttribute(
      "d",
      `M${end.x - ARROW.headWidth} ${end.y - ARROW.headHeight} L${end.x} ${end.y} L${end.x - ARROW.headWidth} ${end.y + ARROW.headHeight}`,
    );
}

/** Follow scroll position without an idle loop; show a brief cue only once the reader pauses. */
export function initMargin() {
  const pencil = document.querySelector(".reading-pencil");
  const arrow = document.querySelector(".nudge-arrow");
  const toggle = document.querySelector(".motion-toggle");
  const targets = [...document.querySelectorAll("[data-nudge]")];
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const cued = new Set();
  document.documentElement.style.setProperty("--nudge-duration", `${CUE_DURATION_MS}ms`);
  let paused = false;
  let frame;
  let timer;
  let settled;
  let active;

  function clearCue() {
    clearTimeout(timer);
    active?.classList.remove("is-nudging");
    arrow.classList.remove("is-nudging");
    active = undefined;
  }

  function cue(target, box) {
    cued.add(target);
    active = target;
    pointArrow(pencil, arrow, box);
    target.classList.add("is-nudging");
    arrow.classList.add("is-nudging");
    timer = setTimeout(clearCue, CUE_DURATION_MS);
  }

  function update(showCue = false) {
    frame = undefined;
    if (paused || motion.matches || document.hidden) return;
    const travel = document.documentElement.scrollHeight - innerHeight;
    const progress = travel > 0 ? Math.max(0, Math.min(scrollY / travel, 1)) : 0;
    // Travel through the middle half of the viewport, leaving the header and browser chrome clear.
    const y = innerHeight * (TRAVEL.start + progress * TRAVEL.distance);
    pencil.style.transform = `translateY(${y}px) rotate(${TRAVEL.initialTilt + progress * TRAVEL.tiltChange}deg)`;
    for (const target of targets) {
      const box = target.getBoundingClientRect();
      if (Math.abs(box.top - y) > REARM_BAND_PX) cued.delete(target);
      if (target === active) {
        if (box.bottom < TOP_SAFE_PX || box.top > innerHeight) clearCue();
        else pointArrow(pencil, arrow, box);
      }
      const inBand = Math.abs(box.top - y) < READING_BAND_PX && box.top > TOP_SAFE_PX && box.bottom < innerHeight;
      if (showCue && !active && !cued.has(target) && inBand && !target.matches(":hover, :focus-within")) {
        cue(target, box);
      }
    }
  }

  function schedule() {
    if (frame === undefined && !paused && !motion.matches && !document.hidden)
      frame = requestAnimationFrame(() => update());
  }

  function syncMotion() {
    clearCue();
    clearTimeout(settled);
    cancelAnimationFrame(frame);
    frame = undefined;
    const enabled = !paused && !motion.matches && !document.hidden;
    pencil.hidden = !enabled;
    // SVG has no reflected hidden property; toggle the attribute used by the shared CSS rule.
    arrow.toggleAttribute("hidden", !enabled);
    toggle.hidden = motion.matches;
    toggle.textContent = paused ? "Resume motion" : "Pause motion";
    toggle.setAttribute("aria-pressed", String(paused));
    if (enabled) schedule();
  }

  toggle.addEventListener("click", () => {
    paused = !paused;
    syncMotion();
  });
  // Keep existing cues attached while scrolling; start a new one only after a reading pause.
  window.addEventListener(
    "scroll",
    () => {
      schedule();
      clearTimeout(settled);
      // Wait for a brief reading pause; continuously moving targets should not receive a cue.
      settled = setTimeout(() => update(true), SETTLE_MS);
    },
    { passive: true },
  );
  window.addEventListener("resize", () => {
    clearCue();
    schedule();
  });
  document.addEventListener("visibilitychange", syncMotion);
  motion.addEventListener("change", syncMotion);
  // Example selection can change document height without a window resize.
  new ResizeObserver(schedule).observe(document.body);
  syncMotion();
}
