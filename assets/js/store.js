(() => {
  "use strict";

  const STORAGE_KEY = "study.v3";
  const V2_STORAGE_KEY = "study.v2";
  const LEGACY_STORAGE_KEY = "study.v1";
  const STORAGE_VERSION = 3;
  const V1_STEP_ORDER = ["welcome", "A", "B", "C", "C2", "D", "D2", "E", "F", "G", "H", "thanks"];
  const V2_STEP_ORDER = ["welcome", "A", "A2", "B", "C", "C2", "D", "D2", "E", "E2", "F", "G", "H", "thanks"];
  const STEP_ORDER = ["welcome", "A", "A2", "B", "C", "C2", "D", "E", "D2", "E2", "F", "G", "H", "thanks"];
  const FALLBACK_AI_QUESTIONS = [
    "What's the one recurring meeting you'd delete forever if you could — and what would break, honestly?",
    "Think of a decision from last month that could have been settled without a meeting. What got in the way?",
  ];
  const FALLBACK_DEMO_SCENARIO = {
    summary: "A client asks to add secure sign-in before launch. Instead of automatically booking an hour with eight people, the assistant prepares the evidence, identifies what only people must decide, and recommends the lightest safe way to settle it. People decide and approve. The system records the commitment and checks what happens next.",
    request: "A client asks to add secure sign-in before a 14 August launch, without an agreed owner, price, or delivery plan.",
    meetingPressure: "The default response would be an hour with eight people.",
    evidence: [
      "The signed scope does not include secure sign-in.",
      "The launch plan has no spare capacity.",
      "Current work is still on schedule.",
    ],
    humanQuestion: "Which constraint should move: scope, date, or budget?",
    noMeeting: "Not safe yet—the request changes scope and delivery risk.",
    asyncApproval: "Useful afterwards, once people have chosen the trade-off.",
    smallConversation: "Three decision-makers for nine minutes.",
    recommendationReason: "The evidence is ready, but the scope–date–budget trade-off requires authority from both sides.",
    decision: "People choose which constraint can move, then each side approves the exact words separately.",
    outcome: "The agreed follow-up is checked against the shared record one week later.",
    beforePeople: 8,
    beforeMinutes: 60,
    afterPeople: 3,
    afterMinutes: 9,
    options: [
      { id: "A", title: "Move the feature", summary: "Keep the 14 August launch; secure sign-in arrives 2 September. Price unchanged.", change: "Secure sign-in arrives 2 September", date: "Launch stays on 14 August", price: "Unchanged", owner: "Provider product team" },
      { id: "B", title: "Move the launch", summary: "Keep secure sign-in in scope; launch moves to 28 August. Price unchanged.", change: "Secure sign-in stays in the launch", date: "Launch moves to 28 August", price: "Unchanged", owner: "Provider and client project leads" },
      { id: "C", title: "Add capacity", summary: "Keep both dates; add a small team and get budget approval from both sides.", change: "Extra people join for three weeks", date: "Launch stays on 14 August", price: "Extra budget sign-off needed", owner: "Provider delivery lead and client approver" },
    ],
  };
  const config = window.STUDY_CONFIG || {};
  let flushing = false;
  let aiQuestionRequest = null;
  let scenarioRequest = null;

  const freshAiQuestionState = () => ({
    status: "idle",
    questions: [],
    gen: false,
  });

  const cloneFallbackScenario = () => JSON.parse(JSON.stringify(FALLBACK_DEMO_SCENARIO));

  const freshScenarioState = () => ({
    status: "idle",
    payload: null,
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
    scenario: freshScenarioState(),
  });

  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

  const usableQuestions = (questions) => Array.isArray(questions)
    && questions.filter((question) => typeof question === "string" && question.trim()).length >= 2;

  const cleanText = (value, fallback, limit = 320) => {
    const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
    return (text || fallback).slice(0, limit);
  };

  const cleanNumber = (value, fallback, min, max) => {
    const number = Math.round(Number(value));
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  };

  const normaliseScenarioPayload = (value) => {
    if (!isObject(value) || !Array.isArray(value.options) || value.options.length < 3) {
      return null;
    }
    const fallback = FALLBACK_DEMO_SCENARIO;
    const options = ["A", "B", "C"].map((id, index) => {
      const option = isObject(value.options[index]) ? value.options[index] : {};
      const base = fallback.options[index];
      return {
        id,
        title: cleanText(option.title, base.title, 60),
        summary: cleanText(option.summary, base.summary, 220),
        change: cleanText(option.change, base.change, 140),
        date: cleanText(option.date, base.date, 100),
        price: cleanText(option.price, base.price, 100),
        owner: cleanText(option.owner, base.owner, 120),
      };
    });
    const evidence = Array.isArray(value.evidence) ? value.evidence.slice(0, 3) : [];
    return {
      summary: cleanText(value.summary, fallback.summary, 520),
      request: cleanText(value.request, fallback.request, 260),
      meetingPressure: cleanText(value.meetingPressure, fallback.meetingPressure, 140),
      evidence: fallback.evidence.map((item, index) => cleanText(evidence[index], item, 180)),
      humanQuestion: cleanText(value.humanQuestion, fallback.humanQuestion, 180),
      noMeeting: cleanText(value.noMeeting, fallback.noMeeting, 180),
      asyncApproval: cleanText(value.asyncApproval, fallback.asyncApproval, 180),
      smallConversation: cleanText(value.smallConversation, fallback.smallConversation, 180),
      recommendationReason: cleanText(value.recommendationReason, fallback.recommendationReason, 240),
      decision: cleanText(value.decision, fallback.decision, 220),
      outcome: cleanText(value.outcome, fallback.outcome, 220),
      beforePeople: cleanNumber(value.beforePeople, fallback.beforePeople, 2, 20),
      beforeMinutes: cleanNumber(value.beforeMinutes, fallback.beforeMinutes, 15, 120),
      afterPeople: cleanNumber(value.afterPeople, fallback.afterPeople, 2, 5),
      afterMinutes: cleanNumber(value.afterMinutes, fallback.afterMinutes, 5, 20),
      options,
    };
  };

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

  const normaliseScenarioState = (saved) => {
    if (!isObject(saved)) {
      return freshScenarioState();
    }
    const payload = normaliseScenarioPayload(saved.payload);
    if (saved.status === "ready" && payload) {
      return { status: "ready", payload, gen: true };
    }
    if (saved.status === "fallback") {
      return { status: "fallback", payload: cloneFallbackScenario(), gen: false };
    }
    // Pending network work cannot survive a reload.
    return freshScenarioState();
  };

  const savedStepIndex = (saved, sourceStepOrder) => {
    const rawIndex = Number.isInteger(saved.stepIndex) ? saved.stepIndex : 0;
    if (sourceStepOrder === STEP_ORDER) {
      return Math.min(STEP_ORDER.length - 1, Math.max(0, rawIndex));
    }
    const stepName = sourceStepOrder[Math.min(sourceStepOrder.length - 1, Math.max(0, rawIndex))];
    return Math.max(0, STEP_ORDER.indexOf(stepName));
  };

  const loadState = () => {
    try {
      const currentRaw = localStorage.getItem(STORAGE_KEY);
      const v2Raw = localStorage.getItem(V2_STORAGE_KEY);
      const v1Raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      const saved = JSON.parse(currentRaw || v2Raw || v1Raw);
      if (!isObject(saved) || typeof saved.rid !== "string") {
        return createState();
      }
      const sourceStepOrder = currentRaw ? STEP_ORDER : (v2Raw ? V2_STEP_ORDER : V1_STEP_ORDER);

      return {
        storageVersion: STORAGE_VERSION,
        rid: saved.rid,
        startedAt: Number.isFinite(saved.startedAt) ? saved.startedAt : Date.now(),
        stepIndex: savedStepIndex(saved, sourceStepOrder),
        answers: isObject(saved.answers) ? saved.answers : {},
        timings: isObject(saved.timings) ? saved.timings : {},
        queue: Array.isArray(saved.queue) ? saved.queue.filter(isObject) : [],
        seq: Number.isInteger(saved.seq) && saved.seq >= 0 ? saved.seq : 0,
        aiq: normaliseAiQuestionState(saved.aiq),
        scenario: normaliseScenarioState(saved.scenario),
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
    schema_version: Number(config.SCHEMA_VERSION) || STORAGE_VERSION,
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
    const role = Array.isArray(savedAnswers.a_role)
      ? savedAnswers.a_role.filter(Boolean).join(", ")
      : savedAnswers.a_role || "";

    return {
      role,
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

  const scenarioContext = () => {
    const savedAnswers = state.answers;
    const role = Array.isArray(savedAnswers.a_role)
      ? savedAnswers.a_role.filter(Boolean).join(", ")
      : savedAnswers.a_role || "";
    return {
      role,
      industry: savedAnswers.a_industry || "",
      company_size: savedAnswers.a_company_size || "",
      client_facing: savedAnswers.a_client_facing || "",
      meetings_week: savedAnswers.a_meetings_week || "",
      work_mode: savedAnswers.a_work_mode || "",
      decision_authority: savedAnswers.a_decision_authority || "",
      meeting_platform: savedAnswers.a2_meeting_platform || "",
      notes_followup: savedAnswers.b_notes_followup || "",
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

  const useFallbackScenario = () => {
    if (state.scenario.status === "ready") {
      return state.scenario;
    }
    state.scenario = {
      status: "fallback",
      payload: cloneFallbackScenario(),
      gen: false,
    };
    persist();
    window.dispatchEvent(new CustomEvent("study:scenario", { detail: state.scenario }));
    return state.scenario;
  };

  const requestDemoScenario = () => {
    if (state.scenario.status === "ready" || state.scenario.status === "fallback") {
      return Promise.resolve(state.scenario);
    }
    if (scenarioRequest) {
      return scenarioRequest;
    }
    if (!config.SCRIPT_URL) {
      return Promise.resolve(useFallbackScenario());
    }

    state.scenario = { status: "pending", payload: null, gen: false };
    persist();

    scenarioRequest = (async () => {
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      let timeoutId;
      try {
        const timeout = new Promise((_, reject) => {
          timeoutId = window.setTimeout(() => {
            if (controller) {
              controller.abort();
            }
            reject(new Error("Scenario request timed out"));
          }, 9000);
        });
        const response = await Promise.race([
          fetch(config.SCRIPT_URL, {
            method: "POST",
            body: JSON.stringify({
              token: config.FORM_TOKEN || "",
              rid: state.rid,
              action: "scenario",
              context: scenarioContext(),
            }),
            ...(controller ? { signal: controller.signal } : {}),
          }),
          timeout,
        ]);
        const result = await response.json();
        const payload = normaliseScenarioPayload(result && result.scenario);
        if (!response.ok || !result || result.ok !== true || !payload) {
          throw new Error("A tailored scenario was not available");
        }
        if (state.scenario.status === "pending") {
          state.scenario = { status: "ready", payload, gen: true };
          persist();
          window.dispatchEvent(new CustomEvent("study:scenario", { detail: state.scenario }));
        }
      } catch {
        if (state.scenario.status === "pending") {
          useFallbackScenario();
        }
      } finally {
        window.clearTimeout(timeoutId);
        scenarioRequest = null;
      }
      return state.scenario;
    })();

    return scenarioRequest;
  };

  /** Send anything still queued, then forget this respondent on this device. */
  const reset = async () => {
    await flush();
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(V2_STORAGE_KEY);
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
    getDemoScenario: () => state.scenario.payload || cloneFallbackScenario(),
    getState: () => state,
    getTotalSeconds: totalSeconds,
    persist,
    requestAiQuestions,
    requestDemoScenario,
    removeAnswers,
    reset,
    setAnswers,
    setStep,
    submit,
    useFallbackAiQuestions,
    useFallbackScenario,
  };

  window.addEventListener("pagehide", flushBeacon);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushBeacon();
    }
  });

  void flush();
})();
