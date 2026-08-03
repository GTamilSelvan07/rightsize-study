(() => {
  "use strict";

  const app = document.querySelector("#app");
  if (!app) {
    return;
  }

  const orderedSteps = ["welcome", "A", "A2", "B", "C", "C2", "D", "E", "D2", "E2", "F", "G", "H", "thanks"];
  const stepDisplayNames = {
    welcome: "Welcome",
    A: "About you",
    A2: "Your toolkit",
    B: "AI at work",
    C: "The annoying parts",
    C2: "When the client changes the plan",
    D: "See the idea",
    E: "Try the decision",
    D2: "Your numbers",
    E2: "About your world",
    F: "Straight answers",
    G: "What it's worth",
    H: "Last page",
  };
  const c2FollowUpKeys = ["c2_arrived_where", "c2_resolve_time", "c2_costs", "c2_cost_money", "c2_workaround", "c2_freq"];
  const sections = new Map(
    [...app.querySelectorAll(".survey-step")].map((section) => [section.dataset.step, section]),
  );
  const progressShell = document.querySelector("[data-progress-shell]");
  const progressTrack = document.querySelector(".progress-track");
  const progressFill = document.querySelector(".progress-fill");
  const progressLabel = document.querySelector(".progress-label");
  const savedIndicator = document.querySelector("[data-saved-indicator]");
  const answers = () => window.Store.getState().answers;
  let currentIndex = Math.min(
    orderedSteps.length - 1,
    Math.max(0, Number(window.Store.getState().stepIndex) || 0),
  );
  let enteredAt = Date.now();
  let aiQuestionFallbackTimer = null;
  let savedIndicatorTimer = null;
  let isTransitioning = false;

  const selectedValue = (name) => {
    const selected = document.querySelector(`[name="${name}"]:checked`);
    return selected ? selected.value : "";
  };

  const motionIsAllowed = () => typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: no-preference)").matches;

  const syncSelectedCardStates = (scope = app) => {
    scope.querySelectorAll(".ph-check-row, .likert label").forEach((row) => {
      row.classList.toggle("is-checked", Boolean(row.querySelector("input:checked")));
    });
  };

  const isClientBranchVisible = () => selectedValue("a_client_facing") !== "no";

  const visibleSurveySteps = () => orderedSteps.filter((step) => {
    if (step === "thanks") {
      return false;
    }
    return step !== "C2" || isClientBranchVisible();
  });

  const currentSection = () => sections.get(orderedSteps[currentIndex]);

  const isHidden = (element) => Boolean(element.closest("[hidden]"));

  const setStatus = (section, message) => {
    const status = section.querySelector("[data-status]");
    if (status) {
      status.textContent = message;
    }
  };

  const clearFieldError = (field) => {
    field.querySelectorAll("[aria-invalid='true']").forEach((control) => {
      control.removeAttribute("aria-invalid");
      const describedBy = (control.getAttribute("aria-describedby") || "")
        .split(/\s+/)
        .filter((id) => id && !id.startsWith("field-error-"));
      if (describedBy.length > 0) {
        control.setAttribute("aria-describedby", describedBy.join(" "));
      } else {
        control.removeAttribute("aria-describedby");
      }
    });
    field.querySelectorAll(".ph-error-text[data-field-error]").forEach((message) => message.remove());
  };

  let fieldErrorId = 0;

  const markFieldError = (field, message = "This answer is required.") => {
    const error = document.createElement("p");
    error.className = "ph-error-text";
    error.dataset.fieldError = "true";
    error.id = `field-error-${++fieldErrorId}`;
    error.textContent = message;
    field.querySelectorAll("input, select, textarea").forEach((control) => {
      const describedBy = new Set(
        (control.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean),
      );
      describedBy.add(error.id);
      control.setAttribute("aria-invalid", "true");
      control.setAttribute("aria-describedby", [...describedBy].join(" "));
    });
    field.append(error);
  };

  const controlHasValue = (field) => {
    const controls = [...field.querySelectorAll("input, select, textarea")];
    if (controls.length === 0) {
      return true;
    }
    if (controls[0].type === "checkbox") {
      return controls.some((control) => control.checked);
    }
    if (controls[0].type === "radio") {
      return controls.some((control) => control.checked);
    }
    const control = controls[0];
    return control.value.trim() !== "" && control.validity.valid;
  };

  // A missed question can sit two screens above the Continue button, so the
  // first one always gets brought into view rather than silently flagged.
  // Plain focus() does the scrolling natively, which works even where an
  // animated scroll would not; scrollIntoView only recentres afterwards.
  const revealFirstError = (section) => {
    const field = section.querySelector("[aria-invalid='true']");
    if (!field) {
      return;
    }
    field.focus();
    field.scrollIntoView({ block: "center", behavior: "auto" });
  };

  const validateStep = (section) => {
    let valid = true;
    let customMessage = "";
    const demoIncomplete = section.dataset.step === "E"
      && window.CompactDemo
      && window.CompactDemo.getData().e_demo_completed !== true;
    section.querySelectorAll("[data-required]").forEach((field) => {
      clearFieldError(field);
      if (isHidden(field)) {
        return;
      }
      if (field.hasAttribute("data-optional-when-tools-none") && selectedValue("b_tools") === "none") {
        return;
      }
      if (!controlHasValue(field)) {
        valid = false;
        markFieldError(field);
      }
    });

    if (demoIncomplete) {
      valid = false;
      customMessage = "Please finish the four-step example before continuing.";
    }

    if (section.dataset.step === "H") {
      const email = section.querySelector('[name="h_email"]');
      const emailField = email.closest("[data-key]");
      clearFieldError(emailField);
      const emailIsMissingForCall = selectedValue("h_interview") === "Yes" && !email.value.trim();
      if (emailIsMissingForCall) {
        valid = false;
        customMessage = "We need an email to arrange the call.";
        markFieldError(emailField, customMessage);
      } else if (email.value && !email.validity.valid) {
        valid = false;
        markFieldError(emailField, "Please enter a valid email address.");
      }
    }

    setStatus(section, valid ? "" : (customMessage || "Please answer the highlighted questions."));
    if (!valid) {
      if (demoIncomplete) {
        const demo = section.querySelector("#compact-demo");
        demo.setAttribute("tabindex", "-1");
        demo.focus();
        demo.scrollIntoView({ block: "start", behavior: "auto" });
      } else {
        revealFirstError(section);
      }
    }
    return valid;
  };

  const valueForControl = (control) => {
    if (control.type === "number" || control.type === "range") {
      return control.value === "" ? "" : Number(control.value);
    }
    return control.value;
  };

  const selectedValues = (value) => {
    if (Array.isArray(value)) {
      return value.map(String);
    }
    if (value === "" || value === null || value === undefined) {
      return [];
    }
    return [String(value)];
  };

  const collectStepData = (section) => {
    const data = {};
    const grouped = new Map();
    section.querySelectorAll("[name]").forEach((control) => {
      if (control.name === "fld_7x") {
        return;
      }
      if (!grouped.has(control.name)) {
        grouped.set(control.name, []);
      }
      grouped.get(control.name).push(control);
    });

    grouped.forEach((controls, name) => {
      const first = controls[0];
      if (first.type === "checkbox") {
        data[name] = controls.filter((control) => control.checked).map((control) => valueForControl(control));
      } else if (first.type === "radio") {
        const checked = controls.find((control) => control.checked);
        data[name] = checked ? valueForControl(checked) : "";
      } else {
        data[name] = valueForControl(first);
      }
    });

    if (section.dataset.step === "A" && data.a_client_facing === "no") {
      // The C2 step is skipped for this branch; blank out anything a previous
      // pass through C2 may already have written to the sheet.
      data.c2_incident_when = "";
      c2FollowUpKeys.forEach((key) => {
        data[key] = "";
      });
    }

    if (section.dataset.step === "C2" && selectedValue("c2_incident_when") === "never") {
      // Send empty strings, not deletions — the backend upsert only writes
      // keys present in the payload, so deletions leave stale answers behind.
      c2FollowUpKeys.forEach((key) => {
        data[key] = "";
      });
    }

    if (section.dataset.step === "D2" && window.Calculator) {
      Object.assign(data, window.Calculator.getData());
    }

    if (section.dataset.step === "E" && window.CompactDemo) {
      Object.assign(data, window.CompactDemo.getData());
    }

    if (section.dataset.step === "E2") {
      const aiq = window.Store.getState().aiq.status === "ready" || window.Store.getState().aiq.status === "fallback"
        ? window.Store.getState().aiq
        : window.Store.useFallbackAiQuestions();
      data.ai_q1 = aiq.questions[0];
      data.ai_a1 = section.querySelector('[name="ai_a1"]').value;
      data.ai_q2 = aiq.questions[1];
      data.ai_a2 = section.querySelector('[name="ai_a2"]').value;
      data.ai_gen_ok = aiq.gen === true;
    }

    if (section.dataset.step === "G") {
      data.g_vw_order_ok = updateVanWestendorp();
    }

    if (section.dataset.step === "H") {
      // Payload key stays "website" (the deployed backend's honeypot check);
      // the field itself is named fld_7x so browser autofill never matches it.
      data.website = document.querySelector("#fld-7x").value;
    }

    return data;
  };

  const syncCurrentAnswers = () => {
    const section = currentSection();
    if (section) {
      window.Store.setAnswers(collectStepData(section));
    }
  };

  const clearC2FollowUp = () => {
    const followUp = document.querySelector("[data-c2-follow-up]");
    followUp.querySelectorAll("input, textarea").forEach((control) => {
      if (control.type === "checkbox" || control.type === "radio") {
        control.checked = false;
      } else {
        control.value = "";
      }
    });
    window.Store.removeAnswers(c2FollowUpKeys);
  };

  const updateC2Visibility = () => {
    const followUp = document.querySelector("[data-c2-follow-up]");
    const hideFollowUp = selectedValue("c2_incident_when") === "never";
    followUp.hidden = hideFollowUp;
    if (hideFollowUp) {
      clearC2FollowUp();
    }
    syncSelectedCardStates(followUp);
  };

  const updateBUsesVisibility = () => {
    const usesField = document.querySelector('[data-key="b_uses"]');
    const none = document.querySelector('[name="b_tools"][value="none"]');
    if (usesField && none) {
      usesField.hidden = none.checked;
    }
  };

  const updateC2CostsExclusivity = (event) => {
    const nothing = document.querySelector('[name="c2_costs"][value="Nothing much"]');
    if (!nothing || !event.target.checked) {
      return;
    }
    if (event.target.value === "Nothing much") {
      document.querySelectorAll('[name="c2_costs"]').forEach((control) => {
        if (control !== nothing) {
          control.checked = false;
        }
      });
    } else {
      nothing.checked = false;
    }
  };

  const updateToolkitTools = (event) => {
    const none = document.querySelector('[name="a2_pm_tools"][value="none"]');
    if (!none) {
      return;
    }
    if (event.target.value === "none" && event.target.checked) {
      document.querySelectorAll('[name="a2_pm_tools"]').forEach((control) => {
        if (control !== none) {
          control.checked = false;
        }
      });
    } else if (event.target.value !== "none" && event.target.checked) {
      none.checked = false;
    }
  };

  const updatePilotApprover = () => {
    const field = document.querySelector("[data-pilot-approver]");
    const needsApproval = selectedValue("g_pilot_500") === "Maybe — I'd need someone's approval";
    field.hidden = !needsApproval;
    if (!needsApproval) {
      field.querySelector("input").value = "";
      window.Store.removeAnswers(["g_pilot_approver"]);
    }
  };

  const updateVanWestendorp = () => {
    const names = ["g_vw_too_cheap", "g_vw_bargain", "g_vw_expensive", "g_vw_too_expensive"];
    const values = names.map((name) => document.querySelector(`[name="${name}"]`).value.trim());
    const complete = values.every((value) => value !== "") && values.every((value) => Number.isFinite(Number(value)));
    const numericValues = values.map(Number);
    const inOrder = complete && numericValues.every((value, index) => index === 0 || numericValues[index - 1] < value);
    const warning = document.querySelector("[data-vw-warning]");
    warning.textContent = complete && !inOrder
      ? "These usually go from cheapest to most expensive — happy to keep your answers as they are though."
      : "";
    if (complete) {
      window.Store.setAnswers({ g_vw_order_ok: inOrder });
    }
    return inOrder;
  };

  const updateProgress = () => {
    const stepName = orderedSteps[currentIndex];
    const isThanks = stepName === "thanks";
    progressShell.hidden = isThanks;
    if (isThanks) {
      return;
    }

    const visible = visibleSurveySteps();
    const visibleIndex = Math.max(0, visible.indexOf(stepName));
    const now = visibleIndex + 1;
    progressTrack.setAttribute("aria-valuemax", String(visible.length));
    progressTrack.setAttribute("aria-valuenow", String(now));
    progressFill.style.width = `${(now / visible.length) * 100}%`;
    progressLabel.textContent = `${stepDisplayNames[stepName]} · Step ${now} of ${visible.length}`;
  };

  const updateThanks = () => {
    const minutes = Math.max(1, Math.ceil(window.Store.getTotalSeconds() / 60));
    document.querySelector("[data-thanks-minutes]").textContent = String(minutes);
    const link = `demo.html?r=${encodeURIComponent(window.Store.getState().rid)}`;
    document.querySelector("[data-thanks-demo-link]").href = link;
    document.querySelector("[data-thanks-walkthrough-link]").href = `walkthrough.html?r=${encodeURIComponent(window.Store.getState().rid)}`;
  };

  const recordTime = () => {
    const step = orderedSteps[currentIndex];
    if (step !== "thanks") {
      window.Store.addTiming(step, Math.round((Date.now() - enteredAt) / 1000));
    }
  };

  const findVisibleIndex = (fromIndex, direction) => {
    let candidate = fromIndex;
    while (candidate >= 0 && candidate < orderedSteps.length) {
      const name = orderedSteps[candidate];
      if (name !== "C2" || isClientBranchVisible()) {
        return candidate;
      }
      candidate += direction;
    }
    return currentIndex;
  };

  const clearAiQuestionFallbackTimer = () => {
    if (aiQuestionFallbackTimer !== null) {
      window.clearTimeout(aiQuestionFallbackTimer);
      aiQuestionFallbackTimer = null;
    }
  };

  const renderAiQuestions = () => {
    const section = sections.get("E2");
    const aiq = window.Store.getState().aiq;
    if (!section || (aiq.status !== "ready" && aiq.status !== "fallback")) {
      return false;
    }

    clearAiQuestionFallbackTimer();
    section.querySelector("[data-aiq-loading]").hidden = true;
    section.querySelector("[data-aiq-form]").hidden = false;
    section.querySelectorAll("[data-aiq-label]").forEach((label, index) => {
      label.textContent = aiq.questions[index] || "";
    });
    section.querySelector("[data-aiq-tailored]").hidden = !aiq.gen;
    section.querySelector("[data-next]").disabled = false;
    return true;
  };

  const prepareAiQuestions = () => {
    const section = sections.get("E2");
    if (!section) {
      return;
    }
    if (renderAiQuestions()) {
      return;
    }

    // Nobody should be able to continue past questions that have not been
    // shown yet; the fallback timer below guarantees this resolves within 6s.
    section.querySelector("[data-next]").disabled = true;
    section.querySelector("[data-aiq-loading]").hidden = false;
    section.querySelector("[data-aiq-form]").hidden = true;
    const request = window.Store.requestAiQuestions();
    if (renderAiQuestions()) {
      return;
    }
    void request.then(() => {
      if (currentSection().dataset.step === "E2") {
        renderAiQuestions();
      }
    });
    clearAiQuestionFallbackTimer();
    aiQuestionFallbackTimer = window.setTimeout(() => {
      if (currentSection().dataset.step === "E2" && !renderAiQuestions()) {
        window.Store.useFallbackAiQuestions();
        renderAiQuestions();
      }
    }, 6000);
  };

  const prefetchAiQuestions = (step) => {
    if ((step === "C" && !isClientBranchVisible()) || step === "C2") {
      void window.Store.requestAiQuestions();
    }
  };

  const prefetchScenario = (step) => {
    if (step === "B") {
      void window.Store.requestDemoScenario();
    }
  };

  const activateStep = (nextIndex, shouldFocus) => {
    currentIndex = nextIndex;
    sections.forEach((section) => section.classList.remove("active"));
    const section = currentSection();
    section.classList.add("active");
    window.Store.setStep(currentIndex);
    enteredAt = Date.now();
    updateProgress();
    if (section.dataset.step === "thanks") {
      updateThanks();
    }
    if (section.dataset.step === "D2" && window.Calculator) {
      window.Calculator.setMeetingDefaultFromBand();
    }
    if (section.dataset.step === "E" && window.CompactDemo) {
      window.CompactDemo.start();
    }
    if (section.dataset.step === "E2") {
      prepareAiQuestions();
    } else {
      clearAiQuestionFallbackTimer();
    }
    if (shouldFocus) {
      const heading = section.querySelector("h1, h2");
      window.setTimeout(() => {
        window.scrollTo({ top: 0, behavior: motionIsAllowed() ? "smooth" : "auto" });
        heading.focus({ preventScroll: true });
      }, 0);
    }
  };

  const showStep = (nextIndex, shouldFocus = true) => {
    const resolvedIndex = findVisibleIndex(nextIndex, 1);
    const outgoing = currentSection();
    const incoming = sections.get(orderedSteps[resolvedIndex]);
    const shouldAnimate = shouldFocus && outgoing && outgoing !== incoming && motionIsAllowed();

    if (!shouldAnimate) {
      activateStep(resolvedIndex, shouldFocus);
      return;
    }

    isTransitioning = true;
    outgoing.classList.add("is-leaving");
    window.setTimeout(() => {
      outgoing.classList.remove("is-leaving");
      isTransitioning = false;
      activateStep(resolvedIndex, shouldFocus);
    }, 150);
  };

  const goNext = () => {
    if (isTransitioning) {
      return;
    }
    const section = currentSection();
    if (!validateStep(section)) {
      return;
    }

    recordTime();
    if (section.dataset.step === "E" && window.CompactDemo) {
      window.CompactDemo.pause();
    }
    const data = collectStepData(section);
    if (section.dataset.step === "H") {
      data.t_seconds_total = window.Store.getTotalSeconds();
      data.t_sections_json = JSON.stringify(window.Store.getState().timings);
    }
    window.Store.setAnswers(data);
    void window.Store.submit(section.dataset.step, data);
    prefetchAiQuestions(section.dataset.step);
    prefetchScenario(section.dataset.step);
    showStep(currentIndex + 1);
  };

  const goBack = () => {
    if (currentIndex === 0 || isTransitioning) {
      return;
    }
    recordTime();
    if (currentSection().dataset.step === "E" && window.CompactDemo) {
      window.CompactDemo.pause();
    }
    showStep(findVisibleIndex(currentIndex - 1, -1));
  };

  const hydrate = () => {
    const saved = answers();
    Object.entries(saved).forEach(([name, value]) => {
      const controls = [...document.getElementsByName(name)];
      if (controls.length === 0) {
        return;
      }
      if (controls[0].type === "checkbox") {
        const selected = selectedValues(value);
        controls.forEach((control) => {
          control.checked = selected.includes(control.value);
        });
      } else if (controls[0].type === "radio") {
        controls.forEach((control) => {
          control.checked = String(value) === control.value;
        });
      } else {
        controls[0].value = String(value);
      }
    });

    updateC2Visibility();
    updateBUsesVisibility();
    updatePilotApprover();
    updateVanWestendorp();
    syncSelectedCardStates();
  };

  const resumeAiQuestionPrefetch = () => {
    const saved = answers();
    const completedC = Boolean(saved.c_email_meetings);
    const completedC2 = Object.prototype.hasOwnProperty.call(saved, "c2_incident_when");
    if (completedC && (saved.a_client_facing === "no" || completedC2)) {
      void window.Store.requestAiQuestions();
    }
  };

  const resumeScenarioPrefetch = () => {
    const saved = answers();
    if (Object.prototype.hasOwnProperty.call(saved, "b_notes_followup")) {
      void window.Store.requestDemoScenario();
    }
  };

  const setupComparison = () => {
    const comparison = document.querySelector("[data-comparison]");
    if (!comparison) {
      return;
    }
    if (!("IntersectionObserver" in window)) {
      comparison.classList.add("is-visible");
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          comparison.classList.add("is-visible");
          observer.unobserve(comparison);
        }
      });
    }, { threshold: 0.25 });
    observer.observe(comparison);
  };

  const copyStudyLink = async () => {
    const status = document.querySelector("[data-thanks-status]");
    const link = location.href.split("#")[0];
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        const helper = document.createElement("textarea");
        helper.value = link;
        helper.setAttribute("readonly", "");
        helper.style.position = "fixed";
        helper.style.opacity = "0";
        document.body.append(helper);
        helper.select();
        const copied = document.execCommand("copy");
        helper.remove();
        if (!copied) {
          throw new Error("Copy command was unavailable");
        }
      }
      status.textContent = "Study link copied.";
    } catch {
      status.textContent = "Copy did not work here. You can copy the page address instead.";
    }
  };

  // Someone who already finished lands straight back on the thank-you page,
  // so they need a way out if they want to answer again.
  const restartStudy = async () => {
    const status = document.querySelector("[data-thanks-status]");
    status.textContent = "Sending anything still queued, then starting fresh…";
    await window.Store.reset();
    location.replace(location.href.split("#")[0]);
  };

  const pulseSavedIndicator = () => {
    if (!savedIndicator) {
      return;
    }
    // Only claim something is saved once an answer actually exists.
    if (Object.keys(answers()).length === 0) {
      return;
    }
    savedIndicator.hidden = false;
    savedIndicator.classList.remove("is-pulsing");
    void savedIndicator.offsetWidth;
    savedIndicator.classList.add("is-pulsing");
    if (savedIndicatorTimer !== null) {
      window.clearTimeout(savedIndicatorTimer);
    }
    savedIndicatorTimer = window.setTimeout(() => {
      savedIndicator.classList.remove("is-pulsing");
      savedIndicatorTimer = null;
    }, 900);
  };

  app.addEventListener("click", (event) => {
    if (event.target.closest("[data-next]")) {
      goNext();
      return;
    }
    if (event.target.closest("[data-back]")) {
      goBack();
      return;
    }
    if (event.target.closest("[data-copy-link]")) {
      void copyStudyLink();
      return;
    }
    if (event.target.closest("[data-restart-study]")) {
      void restartStudy();
    }
  });

  app.addEventListener("change", (event) => {
    const { name } = event.target;
    if (name === "b_tools") {
      const none = document.querySelector('[name="b_tools"][value="none"]');
      if (event.target.value === "none" && event.target.checked) {
        document.querySelectorAll('[name="b_tools"]').forEach((control) => {
          if (control !== none) {
            control.checked = false;
          }
        });
        document.querySelectorAll('[name="b_uses"]').forEach((control) => {
          control.checked = false;
        });
        window.Store.removeAnswers(["b_uses"]);
      } else if (event.target.value !== "none" && event.target.checked) {
        none.checked = false;
      }
      updateBUsesVisibility();
    }
    if (name === "a2_pm_tools") {
      updateToolkitTools(event);
    }
    if (name === "c2_costs") {
      updateC2CostsExclusivity(event);
    }
    if (name === "c2_incident_when") {
      updateC2Visibility();
    }
    if (name === "g_pilot_500") {
      updatePilotApprover();
    }
    if (name === "h_interview") {
      clearFieldError(document.querySelector('[name="h_email"]').closest("[data-key]"));
    }
    if (name && name.startsWith("g_vw_")) {
      updateVanWestendorp();
    }
    syncCurrentAnswers();
    if (name === "a_client_facing") {
      updateProgress();
    }
    syncSelectedCardStates();
    const field = event.target.closest("[data-required], [data-key]");
    if (field) {
      clearFieldError(field);
      setStatus(currentSection(), "");
    }
  });

  app.addEventListener("input", (event) => {
    const { name } = event.target;
    if (name && name.startsWith("g_vw_")) {
      updateVanWestendorp();
    }
    if (event.target.matches("input, textarea, select")) {
      syncCurrentAnswers();
    }
    const field = event.target.closest("[data-required], [data-key]");
    if (field) {
      clearFieldError(field);
    }
  });

  hydrate();
  if (orderedSteps[currentIndex] === "C2" && !isClientBranchVisible()) {
    currentIndex = orderedSteps.indexOf("D");
  }
  showStep(currentIndex, false);
  resumeAiQuestionPrefetch();
  resumeScenarioPrefetch();
  setupComparison();
  window.addEventListener("study:persisted", pulseSavedIndicator);

  window.Survey = {
    getCurrentStep: () => orderedSteps[currentIndex],
    syncCurrentAnswers,
  };
})();
