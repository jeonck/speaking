export function formatSeconds(seconds) {
  const whole = Math.max(0, Math.round(seconds));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 1초 간격으로 내려가며 onTick(remaining)을 부르고, 0에서 onDone()을 부른다. */
export function startCountdown(seconds, { onTick, onDone }) {
  let remaining = seconds;
  onTick(remaining);
  const timer = setInterval(() => {
    remaining -= 1;
    onTick(Math.max(remaining, 0));
    if (remaining <= 0) {
      clearInterval(timer);
      onDone();
    }
  }, 1000);
  return () => clearInterval(timer);
}

/** performance.now() 기준 스톱워치. onTick(elapsedSeconds)을 100ms마다 부른다. */
export function startStopwatch(onTick) {
  const startedAt = performance.now();
  const timer = setInterval(() => onTick((performance.now() - startedAt) / 1000), 100);
  return {
    stop: () => {
      clearInterval(timer);
      return (performance.now() - startedAt) / 1000;
    },
  };
}
