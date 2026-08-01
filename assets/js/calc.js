(() => {
  "use strict";

  const meetingsInput = document.querySelector('[name="calc_meetings"]');
  if (!meetingsInput) {
    return;
  }

  const shareInput = document.querySelector('[name="calc_share"]');
  const shareOutput = document.querySelector("[data-calc-share-output]");
  const hoursOutput = document.querySelector("[data-calc-hours]");
  const moneyOutput = document.querySelector("[data-calc-money]");
  const answers = window.Store.getState().answers;
  let meetingsSetByRespondent = answers.calc_meetings !== undefined && answers.calc_meetings !== "";
  const midpoints = {
    "0–2": 1,
    "3–5": 4,
    "6–10": 8,
    "11–20": 15,
    "More than 20": 22,
  };

  const numberValue = (name) => {
    const control = document.querySelector(`[name="${name}"]:checked`) || document.querySelector(`[name="${name}"]`);
    const value = Number(control && control.value);
    return Number.isFinite(value) ? value : 0;
  };

  const defaultMeetingsFromBand = () => midpoints[window.Store.getState().answers.a_meetings_week] || 1;

  const restore = () => {
    const savedMeetings = Number(answers.calc_meetings);
    meetingsInput.value = meetingsSetByRespondent && Number.isFinite(savedMeetings) && savedMeetings >= 0
      ? String(savedMeetings)
      : String(defaultMeetingsFromBand());

    ["calc_attendees", "calc_length", "calc_cost_band"].forEach((name) => {
      const saved = answers[name];
      if (saved === undefined || saved === "") {
        return;
      }
      const control = document.querySelector(`[name="${name}"][value="${saved}"]`);
      if (control) {
        control.checked = true;
      }
    });

    const savedShare = Number(answers.calc_share);
    if (Number.isFinite(savedShare) && savedShare >= 10 && savedShare <= 70) {
      shareInput.value = String(savedShare);
    }
  };

  const readData = () => {
    const meetings = Math.min(40, Math.max(0, numberValue("calc_meetings")));
    const attendees = numberValue("calc_attendees");
    const length = numberValue("calc_length");
    const costBand = numberValue("calc_cost_band");
    const share = numberValue("calc_share");
    const hours = meetings * 4.3 * attendees * (length / 60) * (share / 100) * 0.85;
    const money = hours * costBand;

    return {
      calc_meetings: meetings,
      calc_attendees: attendees,
      calc_length: length,
      calc_cost_band: costBand,
      calc_share: share,
      calc_hours_month: Math.round(hours),
      calc_money_month: Math.round(money),
    };
  };

  const recompute = (saveValues = true) => {
    const values = readData();
    shareOutput.textContent = `${values.calc_share}%`;
    hoursOutput.textContent = `${values.calc_hours_month.toLocaleString()} hours`;
    moneyOutput.textContent = `$${values.calc_money_month.toLocaleString()}`;
    if (saveValues) {
      window.Store.setAnswers(values);
    }
    return values;
  };

  const setMeetingDefaultFromBand = () => {
    if (!meetingsSetByRespondent) {
      meetingsInput.value = String(defaultMeetingsFromBand());
      recompute(false);
    }
  };

  restore();
  document.querySelectorAll('[name^="calc_"]').forEach((control) => {
    const update = () => {
      if (control.name === "calc_meetings") {
        meetingsSetByRespondent = true;
      }
      recompute();
    };
    control.addEventListener("input", update);
    control.addEventListener("change", update);
  });
  recompute(false);

  window.Calculator = {
    getData: readData,
    recompute,
    setMeetingDefaultFromBand,
  };
})();
