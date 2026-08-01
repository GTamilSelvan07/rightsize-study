(() => {
  "use strict";

  const STORAGE_KEY = "study.v1";
  const config = window.STUDY_CONFIG || {};
  let flushing = false;

  const createState = () => ({
    rid: crypto.randomUUID(),
    startedAt: Date.now(),
    stepIndex: 0,
    answers: {},
    timings: {},
    queue: [],
    seq: 0,
  });

  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

  const loadState = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!isObject(saved) || typeof saved.rid !== "string") {
        return createState();
      }

      return {
        rid: saved.rid,
        startedAt: Number.isFinite(saved.startedAt) ? saved.startedAt : Date.now(),
        stepIndex: Number.isInteger(saved.stepIndex) ? saved.stepIndex : 0,
        answers: isObject(saved.answers) ? saved.answers : {},
        timings: isObject(saved.timings) ? saved.timings : {},
        queue: Array.isArray(saved.queue) ? saved.queue.filter(isObject) : [],
        seq: Number.isInteger(saved.seq) && saved.seq >= 0 ? saved.seq : 0,
      };
    } catch {
      return createState();
    }
  };

  let state = loadState();

  const persist = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      return false;
    }
    return true;
  };

  const makePayload = (section, data) => ({
    token: config.FORM_TOKEN || "",
    rid: state.rid,
    section,
    seq: ++state.seq,
    ua: navigator.userAgent,
    data,
  });

  const addToQueue = (section, data) => {
    const payload = makePayload(section, data);
    state.queue.push(payload);
    return payload;
  };

  const metaData = () => ({
    src: new URL(location.href).searchParams.get("src") || "",
    lang: navigator.language,
    referrer: document.referrer,
    viewport: `${innerWidth}x${innerHeight}`,
    ua: navigator.userAgent,
  });

  const flush = async () => {
    if (flushing || state.queue.length === 0) {
      return;
    }

    flushing = true;
    try {
      if (!config.SCRIPT_URL) {
        while (state.queue.length > 0) {
          const payload = state.queue.shift();
          console.log("[study] would submit", payload);
        }
        persist();
        return;
      }

      while (state.queue.length > 0) {
        const payload = state.queue[0];
        try {
          const response = await fetch(config.SCRIPT_URL, {
            method: "POST",
            body: JSON.stringify(payload),
          });
          const result = await response.json();
          if (!response.ok || !result || result.ok !== true) {
            throw new Error("Response was not accepted");
          }
          state.queue.shift();
          persist();
        } catch {
          persist();
          break;
        }
      }
    } finally {
      flushing = false;
    }
  };

  const flushBeacon = () => {
    if (state.queue.length === 0) {
      return;
    }

    if (!config.SCRIPT_URL) {
      while (state.queue.length > 0) {
        console.log("[study] would submit", state.queue.shift());
      }
      persist();
      return;
    }

    while (state.queue.length > 0) {
      const payload = state.queue[0];
      const sent = navigator.sendBeacon(
        config.SCRIPT_URL,
        new Blob([JSON.stringify(payload)], { type: "text/plain" }),
      );
      if (!sent) {
        break;
      }
      state.queue.shift();
    }
    persist();
  };

  const setAnswers = (data) => {
    if (!isObject(data)) {
      return;
    }
    Object.assign(state.answers, data);
    persist();
  };

  const removeAnswers = (keys) => {
    keys.forEach((key) => {
      delete state.answers[key];
    });
    persist();
  };

  const setStep = (stepIndex) => {
    state.stepIndex = stepIndex;
    persist();
  };

  const addTiming = (section, seconds) => {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    state.timings[section] = (Number(state.timings[section]) || 0) + safeSeconds;
    persist();
  };

  const totalSeconds = () => Object.values(state.timings).reduce((sum, value) => sum + (Number(value) || 0), 0);

  const submit = async (section, data) => {
    if (state.seq === 0) {
      addToQueue("meta", metaData());
    }
    const payload = addToQueue(section, data);
    persist();
    await flush();
    return payload;
  };

  window.Store = {
    addTiming,
    flush,
    flushBeacon,
    getState: () => state,
    getTotalSeconds: totalSeconds,
    persist,
    removeAnswers,
    setAnswers,
    setStep,
    submit,
  };

  window.addEventListener("pagehide", flushBeacon);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushBeacon();
    }
  });

  void flush();
})();
