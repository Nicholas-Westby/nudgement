// Only these marked elements receive a single, three-pixel nudge during a visit.
const CUE_DURATION_MS = 1000;
const READING_BAND_PX = 110;
const SETTLE_MS = 120;
const TOP_SAFE_PX = 80;
// The pencil crosses half the viewport, tilting a little further as the reader reaches the footer.
const TRAVEL = { start: 0.2, distance: 0.5, initialTilt: 12, tiltChange: 12 };
const ARROW = { textGap: 5, maxTextInset: 26, headWidth: 6, headHeight: 4 };

/** Follow scroll position without an idle loop; show a brief cue only once the reader pauses. */
export function initMargin() {
  const pencil = document.querySelector(".reading-pencil");
  const arrow = document.querySelector(".nudge-arrow");
  const toggle = document.querySelector(".motion-toggle");
  const targets = [...document.querySelectorAll("[data-nudge]")];
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const visited = new Set();
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
    visited.add(target);
    active = target;
    const tip = pencil.querySelector(".pencil-tip").getBoundingClientRect();
    const start = { x: tip.left + tip.width / 2, y: tip.bottom };
    const end = { x: box.left - ARROW.textGap, y: box.top + Math.min(box.height / 2, ARROW.maxTextInset) };
    // Both points use viewport coordinates; the arrow bends through the gutter without covering text.
    arrow
      .querySelector("path")
      .setAttribute(
        "d",
        `M${start.x} ${start.y} Q${start.x} ${end.y} ${end.x} ${end.y} m-${ARROW.headWidth} -${ARROW.headHeight} ${ARROW.headWidth} ${ARROW.headHeight} -${ARROW.headWidth} ${ARROW.headHeight}`,
      );
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
    if (active || !showCue) return;
    for (const target of targets) {
      const box = target.getBoundingClientRect();
      const inBand = Math.abs(box.top - y) < READING_BAND_PX && box.top > TOP_SAFE_PX && box.bottom < innerHeight;
      if (!visited.has(target) && inBand && !target.matches(":hover, :focus-within")) {
        cue(target, box);
        break;
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
  // Cancel a cue as scrolling resumes so its arrow never points at a stale element position.
  window.addEventListener(
    "scroll",
    () => {
      clearCue();
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
