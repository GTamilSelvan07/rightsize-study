(() => {
  "use strict";

  const app = document.querySelector("#app");
  if (!app) {
    return;
  }

  const orderedSteps = ["welcome", "A", "B", "C", "C2", "D", "D2", "E", "F", "G", "H", "thanks"];
  const c2FollowUpKeys = ["c2_arrived_where", "c2_resolve_time", "c2_costs", "c2_cost_money", "c2_workaround", "c2_freq"];
  const sections = new Map(
    [...app.querySelectorAll(".survey-step")].map((section) => [section.dataset.step, section]),
  );
  const progressShell = document.querySelector("[data-progress-shell]");
  const progressTrack = document.querySelector(".progress-track");
  const progressFill = document.querySelector(".progress-fill");
  const progressLabel = document.querySelector(".progress-label");
  const answers = () => window.Store.getState().answers;
  let currentIndex = Math.min(
    orderedSteps.length - 1,
    Math.max(0, Number(window.Store.getState().stepIndex) || 0),
  );
  let enteredAt = Date.now();

  const selectedValue = (name) => {
    const selected = document.querySelector(`[name="${name}"]:checked`);
    return selected ? selected.value : "";
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
    field.querySelectorAll("[aria-invalid='true']").forEach((control) => control.removeAttribute("aria-invalid"));
    field.querySelectorAll(".ph-error-text[data-field-error]").forEach((message) => message.remove());
  };

  const markFieldError = (field, message = "This answer is required.") => {
    field.querySelectorAll("input, select, textarea").forEach((control) => control.setAttribute("aria-invalid", "true"));
    const error = document.createElement("p");
    error.className = "ph-error-text";
    error.dataset.fieldError = "true";
    error.textContent = message;
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

  const validateStep = (section) => {
    let valid = true;
    let customMessage = "";
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

    setStatus(section, valid ? "" : (customMessage || "Please answer the highlighted questions"));
    return valid;
  };

  const valueForControl = (control) => {
    if (control.type === "number" || control.type === "range") {
      return control.value === "" ? "" : Number(control.value);
    }
    return control.value;
  };

  const collectStepData = (section) => {
    const data = {};
    const grouped = new Map();
    section.querySelectorAll("[name]").forEach((control) => {
      if (control.name === "website") {
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

    if (section.dataset.step === "A" && data.a_country === "Other") {
      const other = section.querySelector("[data-other-for='a_country']");
      data.a_country = other.value.trim() || "Other";
    }

    if (section.dataset.step === "C2" && selectedValue("c2_incident_when") === "never") {
      c2FollowUpKeys.forEach((key) => delete data[key]);
    }

    if (section.dataset.step === "D2" && window.Calculator) {
      Object.assign(data, window.Calculator.getData());
    }

    if (section.dataset.step === "E" && window.CompactDemo) {
      Object.assign(data, window.CompactDemo.getData());
    }

    if (section.dataset.step === "G") {
      data.g_vw_order_ok = updateVanWestendorp();
    }

    if (section.dataset.step === "H") {
      data.website = document.querySelector("#website").value;
    }

    return data;
  };

  const syncCurrentAnswers = () => {
    const section = currentSection();
    if (section) {
      window.Store.setAnswers(collectStepData(section));
    }
  };

  const showCountryOther = () => {
    const field = document.querySelector("[data-country-other]");
    if (field) {
      field.hidden = document.querySelector('[name="a_country"]').value !== "Other";
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
    progressLabel.textContent = `Step ${now} of ${visible.length}`;
  };

  const updateThanks = () => {
    const minutes = Math.max(1, Math.ceil(window.Store.getTotalSeconds() / 60));
    document.querySelector("[data-thanks-minutes]").textContent = String(minutes);
    const link = `demo.html?r=${encodeURIComponent(window.Store.getState().rid)}`;
    document.querySelector("[data-thanks-demo-link]").href = link;
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

  const showStep = (nextIndex, shouldFocus = true) => {
    currentIndex = findVisibleIndex(nextIndex, 1);
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
    if (shouldFocus) {
      const heading = section.querySelector("h1, h2");
      window.setTimeout(() => {
        window.scrollTo({ top: 0, behavior: "smooth" });
        heading.focus({ preventScroll: true });
      }, 0);
    }
  };

  const goNext = () => {
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
    showStep(currentIndex + 1);
  };

  const goBack = () => {
    if (currentIndex === 0) {
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
        const selected = Array.isArray(value) ? value.map(String) : [];
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

    const country = document.querySelector('[name="a_country"]');
    if (saved.a_country && ![...country.options].some((option) => option.value === saved.a_country)) {
      country.value = "Other";
      document.querySelector("[data-other-for='a_country']").value = saved.a_country;
    }
    showCountryOther();
    updateC2Visibility();
    updatePilotApprover();
    updateVanWestendorp();
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
    }
  });

  app.addEventListener("change", (event) => {
    const { name } = event.target;
    if (name === "a_country") {
      showCountryOther();
    }
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
  setupComparison();

  window.Survey = {
    getCurrentStep: () => orderedSteps[currentIndex],
    syncCurrentAnswers,
  };
})();
