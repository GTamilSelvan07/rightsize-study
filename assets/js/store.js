(() => {
  "use strict";

  const STORAGE_KEY = "study.v2";
  const LEGACY_STORAGE_KEY = "study.v1";
  const STORAGE_VERSION = 2;
  const LEGACY_STEP_ORDER = ["welcome", "A", "B", "C", "C2", "D", "D2", "E", "F", "G", "H", "thanks"];
  const STEP_ORDER = ["welcome", "A", "A2", "B", "C", "C2", "D", "D2", "E", "E2", "F", "G", "H", "thanks"];
  const FALLBACK_AI_QUESTIONS = [
    "What's the one recurring meeting you'd delete forever if you could — and what would break, honestly?",
    "Think of a decision from last month that could have been settled without a meeting. What got in the way?",
  ];
  const config = window.STUDY_CONFIG || {};
  let flushing = false;
  let aiQuestionRequest = null;

  const freshAiQuestionState = () => ({
    status: "idle",
    questions: [],
    gen: false,
  });

  const createState = () => ({
    storageVersion: STORAGE_VERSION,
    rid: crypto.randomUUID(),
    startedAt: Date.now(),
    stepIndex: 0,
    answers: {},
    timings: {},
    queue: [],
    seq: 0,
    aiq: freshAiQuestionState(),
  });

  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

  const usableQuestions = (questions) => Array.isArray(questions)
    && questions.filter((question) => typeof question === "string" && question.trim()).length >= 2;

  const normaliseAiQuestionState = (saved) => {
    if (!isObject(saved)) {
      return freshAiQuestionState();
    }

    const questions = Array.isArray(saved.questions)
      ? saved.questions
        .filter((question) => typeof question === "string" && question.trim())
        .map((question) => question.trim())
        .slice(0, 2)
      : [];

    if (saved.status === "ready" && usableQuestions(questions)) {
      return { status: "ready", questions, gen: true };
    }
    if (saved.status === "fallback") {
      return { status: "fallback", questions: FALLBACK_AI_QUESTIONS, gen: false };
    }

    // A pending request cannot survive a reload, so it is safe to request again.
    return freshAiQuestionState();
  };

  const savedStepIndex = (saved, isLegacy) => {
    const rawIndex = Number.isInteger(saved.stepIndex) ? saved.stepIndex : 0;
    if (!isLegacy) {
      return Math.min(STEP_ORDER.length - 1, Math.max(0, rawIndex));
    }
    const stepName = LEGACY_STEP_ORDER[Math.min(LEGACY_STEP_ORDER.length - 1, Math.max(0, rawIndex))];
    return Math.max(0, STEP_ORDER.indexOf(stepName));
  };

  const loadState = () => {
    try {
      const savedFromCurrentSchema = localStorage.getItem(STORAGE_KEY);
      const saved = JSON.parse(savedFromCurrentSchema || localStorage.getItem(LEGACY_STORAGE_KEY));
      if (!isObject(saved) || typeof saved.rid !== "string") {
        return createState();
      }

      const isLegacy = !savedFromCurrentSchema || Number(saved.storageVersion) !== STORAGE_VERSION;

      return {
        storageVersion: STORAGE_VERSION,
        rid: saved.rid,
        startedAt: Number.isFinite(saved.startedAt) ? saved.startedAt : Date.now(),
        stepIndex: savedStepIndex(saved, isLegacy),
        answers: isObject(saved.answers) ? saved.answers : {},
        timings: isObject(saved.timings) ? saved.timings : {},
        queue: Array.isArray(saved.queue) ? saved.queue.filter(isObject) : [],
        seq: Number.isInteger(saved.seq) && saved.seq >= 0 ? saved.seq : 0,
        aiq: normaliseAiQuestionState(saved.aiq),
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
    window.dispatchEvent(new CustomEvent("study:persisted"));
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

  const aiQuestionContext = () => {
    const savedAnswers = state.answers;
    const hasIncident = savedAnswers.c2_incident_when && savedAnswers.c2_incident_when !== "never";

    return {
      role: savedAnswers.a_role || "",
      industry: savedAnswers.a_industry || "",
      company_size: savedAnswers.a_company_size || "",
      client_facing: savedAnswers.a_client_facing || "",
      meetings_week: savedAnswers.a_meetings_week || "",
      notes_followup: savedAnswers.b_notes_followup || "",
      email_meetings: savedAnswers.c_email_meetings || "",
      lost_actions: savedAnswers.c_lost_actions || "",
      incident: hasIncident
        ? {
          when: savedAnswers.c2_incident_when,
          where: savedAnswers.c2_arrived_where || "",
          costs: Array.isArray(savedAnswers.c2_costs) ? savedAnswers.c2_costs : [],
          money: savedAnswers.c2_cost_money || "",
          freq: savedAnswers.c2_freq || "",
        }
        : null,
    };
  };

  const useFallbackAiQuestions = () => {
    if (state.aiq.status === "ready") {
      return state.aiq;
    }
    state.aiq = {
      status: "fallback",
      questions: FALLBACK_AI_QUESTIONS,
      gen: false,
    };
    persist();
    return state.aiq;
  };

  const requestAiQuestions = () => {
    if (state.aiq.status === "ready" || state.aiq.status === "fallback") {
      return Promise.resolve(state.aiq);
    }
    if (aiQuestionRequest) {
      return aiQuestionRequest;
    }
    if (!config.SCRIPT_URL) {
      return Promise.resolve(useFallbackAiQuestions());
    }

    state.aiq = { status: "pending", questions: [], gen: false };
    persist();

    aiQuestionRequest = (async () => {
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      let timeoutId;
      try {
        const timeout = new Promise((_, reject) => {
          timeoutId = window.setTimeout(() => {
            if (controller) {
              controller.abort();
            }
            reject(new Error("AI question request timed out"));
          }, 10000);
        });
        const response = await Promise.race([
          fetch(config.SCRIPT_URL, {
            method: "POST",
            body: JSON.stringify({
              token: config.FORM_TOKEN || "",
              rid: state.rid,
              action: "aiq",
              context: aiQuestionContext(),
            }),
            ...(controller ? { signal: controller.signal } : {}),
          }),
          timeout,
        ]);
        const result = await response.json();
        const questions = result && Array.isArray(result.questions)
          ? result.questions
            .filter((question) => typeof question === "string" && question.trim())
            .map((question) => question.trim())
            .slice(0, 2)
          : [];

        if (!response.ok || !result || result.ok !== true || !usableQuestions(questions)) {
          throw new Error("AI questions were not available");
        }
        if (state.aiq.status === "pending") {
          state.aiq = { status: "ready", questions, gen: true };
          persist();
        }
      } catch {
        if (state.aiq.status === "pending") {
          useFallbackAiQuestions();
        }
      } finally {
        window.clearTimeout(timeoutId);
        aiQuestionRequest = null;
      }
      return state.aiq;
    })();

    return aiQuestionRequest;
  };

  /** Send anything still queued, then forget this respondent on this device. */
  const reset = async () => {
    await flush();
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // Private browsing can refuse writes; the reload still starts clean.
    }
    state = createState();
  };

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
    requestAiQuestions,
    removeAnswers,
    reset,
    setAnswers,
    setStep,
    submit,
    useFallbackAiQuestions,
  };

  window.addEventListener("pagehide", flushBeacon);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushBeacon();
    }
  });

  void flush();
})();
