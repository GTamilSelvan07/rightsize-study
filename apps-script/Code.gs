/**
 * Right-Size Meetings Study — response collector.
 *
 * One-time setup:
 *   1. Create a Google Sheet (any name). Extensions -> Apps Script. Paste this file.
 *   2. In the editor, run initSheets() once (grant permissions when asked).
 *   3. Deploy -> New deployment -> Web app -> Execute as: Me -> Who has access: Anyone.
 *   4. Copy the /exec URL into assets/js/config.js on the site.
 *   5. For AI-tailored questions and the fictional scenario: Project Settings
 *      (gear icon) -> Script Properties ->
 *      Add property: GEMINI_API_KEY = <your Gemini API key>. Without it the survey
 *      quietly falls back to fixed questions and a fixed scenario. Optional:
 *      GEMINI_MODEL = gemini-3.6-flash.
 *   6. After ANY later edit to this file: Deploy -> Manage deployments -> Edit -> New version.
 *      (Saving alone does NOT update the live URL.)
 */

var TOKEN = "rs-2026-08"; // must match FORM_TOKEN in config.js (anti-spam, not a secret)

var HEADERS = [
  "rid", "created_at", "updated_at", "last_section", "src", "lang", "referrer", "viewport", "ua",
  "a_consent", "a_country", "a_role", "a_company_size", "a_industry", "a_client_facing", "a_meetings_week",
  "a_experience_years", "a_work_mode",
  "a_team_size", "a_decision_authority", "a2_pm_tools", "a2_meeting_platform", "a2_who_runs_meetings",
  "b_tools", "b_freq", "b_uses", "b_notes_followup",
  "c_email_meetings", "c_decision_misremember", "c_lost_actions", "c_worst_meeting",
  "c2_incident_when", "c2_arrived_where", "c2_resolve_time", "c2_costs", "c2_cost_money", "c2_workaround", "c2_freq",
  "d_looks_like_you", "calc_meetings", "calc_attendees", "calc_length", "calc_cost_band", "calc_share",
  "calc_hours_month", "calc_money_month",
  "e_demo_option", "e_demo_seconds", "e_demo_steps_done", "e_demo_completed", "e_full_demo_clicked", "e_clarity",
  "ai_q1", "ai_a1", "ai_q2", "ai_a2", "ai_gen_ok",
  "f_value", "f_most_valuable", "f_least_valuable", "f_concern", "f_solves_problem", "f_blocker",
  "g_vw_too_cheap", "g_vw_bargain", "g_vw_expensive", "g_vw_too_expensive", "g_vw_order_ok",
  "g_pilot_500", "g_pilot_approver",
  "h_email", "h_interview", "h_pilot", "h_referral",
  "demo_full_opened", "demo_full_route", "demo_full_option", "demo_full_completed",
  "story_opened", "story_role", "story_act1_choice1", "story_act1_choice2",
  "story_limits_set", "story_option", "story_edit_loop_seen", "story_notmine_seen",
  "story_completed", "story_replay_clicked", "story_replay_role",
  "story_walkthrough_clicked", "story_seconds",
  "story_meeting_reply1", "story_meeting_reply2", "story_meeting_completed",
  "t_seconds_total", "t_sections_json",
  // Version 2 fields are appended so existing response columns never shift.
  "schema_version", "e_scenario_generated", "e_scenario_route", "e_understanding"
];
// demo_full_* now refers to the step-by-step walkthrough page; story_* is the
// playable-episode demo; ai_* holds the AI-tailored follow-up questions and answers;
// e_scenario_* records whether the compact fictional scenario was generated or fixed.

/** Run once from the editor to create/repair the two tabs with header rows. */
function initSheets() {
  var ss = SpreadsheetApp.getActive();
  var events = ss.getSheetByName("events") || ss.insertSheet("events");
  var responses = ss.getSheetByName("responses") || ss.insertSheet("responses");
  ensureColumns(events, 6);
  ensureColumns(responses, HEADERS.length);
  events.getRange(1, 1, 1, 6).setValues([["ts", "rid", "section", "seq", "payload_json", "ua"]]);
  responses.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  events.setFrozenRows(1);
  responses.setFrozenRows(1);
}

function doGet() {
  return out({
    ok: true,
    ping: true,
    schemaVersion: 2,
    features: { aiq: true, scenario: true },
  });
}

function doPost(e) {
  try {
    var p = JSON.parse(e.postData.contents);
    // Honeypot: bots fill the hidden "website" field. Answer ok so they move on,
    // but log the drop to the events tab so real losses would be visible.
    if (p.data && p.data.website) {
      try {
        SpreadsheetApp.getActive().getSheetByName("events").appendRow([
          new Date(), String(p.rid || "").slice(0, 40), "honeypot-drop", p.seq || 0,
          JSON.stringify(p.data).slice(0, 2000), String(p.ua || "").slice(0, 300)
        ]);
      } catch (ignored) {}
      return out({ ok: true });
    }
    if (p.token !== TOKEN) return out({ ok: false, err: "bad token" });
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(p.rid || ""))) {
      return out({ ok: false, err: "bad rid" });
    }
    if (p.action === "aiq") return handleAiq(p);
    if (p.action === "scenario") return handleScenario(p);
    if (typeof p.section !== "string" || typeof p.data !== "object" || p.data === null) {
      return out({ ok: false, err: "bad payload" });
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var ss = SpreadsheetApp.getActive();
      ss.getSheetByName("events").appendRow([
        new Date(), p.rid, p.section, p.seq || 0,
        JSON.stringify(p.data).slice(0, 30000), String(p.ua || "").slice(0, 300)
      ]);
      upsert(ss.getSheetByName("responses"), p);
    } finally {
      lock.releaseLock();
    }
    return out({ ok: true });
  } catch (err) {
    return out({ ok: false, err: String(err) });
  }
}

function upsert(sheet, p) {
  ensureResponseSheet(sheet);
  var found = sheet.getRange("A:A").createTextFinder(p.rid).matchEntireCell(true).findNext();
  var row;
  if (found) {
    row = found.getRow();
  } else {
    row = sheet.getLastRow() + 1;
    sheet.getRange(row, 1).setValue(p.rid);
    sheet.getRange(row, HEADERS.indexOf("created_at") + 1).setValue(new Date());
  }
  sheet.getRange(row, HEADERS.indexOf("updated_at") + 1).setValue(new Date());
  sheet.getRange(row, HEADERS.indexOf("last_section") + 1).setValue(p.section);
  for (var key in p.data) {
    var col = HEADERS.indexOf(key);
    if (col < 1) continue; // unknown keys ignored; col 0 (rid) never overwritten
    var val = p.data[key];
    if (Array.isArray(val)) val = val.join(";");
    sheet.getRange(row, col + 1).setValue(typeof val === "string" ? val.slice(0, 5000) : val);
  }
}

function ensureColumns(sheet, required) {
  var current = sheet.getMaxColumns();
  if (current < required) sheet.insertColumnsAfter(current, required - current);
}

function ensureResponseSheet(sheet) {
  ensureColumns(sheet, HEADERS.length);
  if (sheet.getLastColumn() < HEADERS.length) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }
}

/**
 * AI features require GEMINI_API_KEY in Script Properties. The key stays here;
 * it is never returned to the browser or committed with the survey.
 */
function callGeminiJson(prompt, schema, temperature, maxOutputTokens) {
  var properties = PropertiesService.getScriptProperties();
  var key = properties.getProperty("GEMINI_API_KEY");
  if (!key) throw new Error("no key configured");

  var configured = properties.getProperty("GEMINI_MODEL") || "gemini-3.6-flash";
  configured = String(configured).replace(/^models\//, "");
  var models = [configured];
  if (configured !== "gemini-2.5-flash") models.push("gemini-2.5-flash");
  var responseCodes = [];

  for (var i = 0; i < models.length; i++) {
    var model = models[i];
    var generationConfig = {
      maxOutputTokens: maxOutputTokens,
      responseMimeType: "application/json",
      responseJsonSchema: schema,
    };
    if (model.indexOf("gemini-2.5") === 0) {
      generationConfig.temperature = temperature;
      generationConfig.thinkingConfig = { thinkingBudget: 0 };
    } else if (model.indexOf("gemini-3") === 0) {
      generationConfig.thinkingConfig = { thinkingLevel: "LOW" };
    } else {
      generationConfig.temperature = temperature;
    }

    var res = UrlFetchApp.fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent",
      {
        method: "post",
        contentType: "application/json",
        headers: { "x-goog-api-key": key },
        payload: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: generationConfig,
        }),
        muteHttpExceptions: true,
      }
    );
    responseCodes.push(res.getResponseCode());
    if (res.getResponseCode() !== 200) continue;

    var body = JSON.parse(res.getContentText());
    var parts = (((body.candidates || [])[0] || {}).content || {}).parts || [];
    var text = parts.map(function (part) { return part.text || ""; }).join("\n");
    text = text.replace(/```(?:json)?/g, "").trim();
    return JSON.parse(text);
  }

  throw new Error("Gemini request failed with HTTP " + responseCodes.join(", "));
}

function recordGeneratedResult(p, section, eventData, responseData) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = SpreadsheetApp.getActive();
    var events = ss.getSheetByName("events");
    ensureColumns(events, 6);
    events.appendRow([
      new Date(), p.rid, section, 0,
      JSON.stringify(eventData).slice(0, 30000), String(p.ua || "").slice(0, 300)
    ]);
    upsert(ss.getSheetByName("responses"),
      { rid: p.rid, section: section, data: responseData });
  } finally {
    lock.releaseLock();
  }
}

function cappedText(value, maxLength) {
  var text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) throw new Error("empty generated field");
  return text.slice(0, maxLength);
}

function boundedInteger(value, min, max) {
  var number = Math.round(Number(value));
  if (!isFinite(number)) throw new Error("invalid generated number");
  return Math.min(max, Math.max(min, number));
}

function handleAiq(p) {
  var ctx = p.context && typeof p.context === "object" ? p.context : {};
  var brief = JSON.stringify(ctx).slice(0, 2000);
  var schema = {
    type: "object",
    properties: {
      questions: {
        type: "array",
        minItems: 2,
        maxItems: 2,
        items: { type: "string" },
      },
    },
    required: ["questions"],
    additionalProperties: false,
  };
  var prompt =
    "You help run an anonymous workplace research survey about meetings and decisions. " +
    "Based only on the bounded category data below, write exactly two warm, open-ended " +
    "follow-up questions. Each must be under 160 characters. Do not ask about health, " +
    "protected characteristics, named people, employer identity, salary, or other " +
    "sensitive information. Do not imply that category data is a verified fact.\n\n" +
    "Bounded survey context:\n" + brief;

  try {
    var generated = callGeminiJson(prompt, schema, 0.7, 512);
    if (!generated || !Array.isArray(generated.questions) || generated.questions.length !== 2) {
      throw new Error("bad question output");
    }
    var questions = generated.questions.map(function (question) {
      return cappedText(question, 200);
    });
    recordGeneratedResult(
      p,
      "aiq",
      { questions: questions },
      { ai_q1: questions[0], ai_q2: questions[1], ai_gen_ok: true }
    );
    return out({ ok: true, questions: questions });
  } catch (err) {
    return out({ ok: false, err: String(err) });
  }
}

function normaliseScenario(generated) {
  if (!generated || !Array.isArray(generated.evidence) || generated.evidence.length !== 3 ||
      !Array.isArray(generated.options) || generated.options.length !== 3) {
    throw new Error("bad scenario output");
  }
  var ids = ["A", "B", "C"];
  return {
    summary: cappedText(generated.summary, 520),
    request: cappedText(generated.request, 260),
    meetingPressure: cappedText(generated.meetingPressure, 140),
    evidence: generated.evidence.map(function (item) { return cappedText(item, 180); }),
    humanQuestion: cappedText(generated.humanQuestion, 180),
    noMeeting: cappedText(generated.noMeeting, 180),
    asyncApproval: cappedText(generated.asyncApproval, 180),
    smallConversation: cappedText(generated.smallConversation, 180),
    recommendationReason: cappedText(generated.recommendationReason, 240),
    decision: cappedText(generated.decision, 220),
    outcome: cappedText(generated.outcome, 220),
    beforePeople: boundedInteger(generated.beforePeople, 5, 12),
    beforeMinutes: boundedInteger(generated.beforeMinutes, 30, 90),
    afterPeople: boundedInteger(generated.afterPeople, 2, 3),
    afterMinutes: boundedInteger(generated.afterMinutes, 5, 15),
    options: generated.options.map(function (option, index) {
      return {
        id: ids[index],
        title: cappedText(option.title, 60),
        summary: cappedText(option.summary, 220),
        change: cappedText(option.change, 140),
        date: cappedText(option.date, 100),
        price: cappedText(option.price, 100),
        owner: cappedText(option.owner, 120),
      };
    }),
  };
}

function handleScenario(p) {
  var ctx = p.context && typeof p.context === "object" ? p.context : {};
  var brief = JSON.stringify(ctx).slice(0, 2400);
  var stringProperty = { type: "string" };
  var optionSchema = {
    type: "object",
    properties: {
      title: stringProperty,
      summary: stringProperty,
      change: stringProperty,
      date: stringProperty,
      price: stringProperty,
      owner: stringProperty,
    },
    required: ["title", "summary", "change", "date", "price", "owner"],
    additionalProperties: false,
  };
  var schema = {
    type: "object",
    properties: {
      summary: stringProperty,
      request: stringProperty,
      meetingPressure: stringProperty,
      evidence: { type: "array", minItems: 3, maxItems: 3, items: stringProperty },
      humanQuestion: stringProperty,
      noMeeting: stringProperty,
      asyncApproval: stringProperty,
      smallConversation: stringProperty,
      recommendationReason: stringProperty,
      decision: stringProperty,
      outcome: stringProperty,
      beforePeople: { type: "integer", minimum: 5, maximum: 12 },
      beforeMinutes: { type: "integer", minimum: 30, maximum: 90 },
      afterPeople: { type: "integer", minimum: 2, maximum: 3 },
      afterMinutes: { type: "integer", minimum: 5, maximum: 15 },
      options: { type: "array", minItems: 3, maxItems: 3, items: optionSchema },
    },
    required: [
      "summary", "request", "meetingPressure", "evidence", "humanQuestion",
      "noMeeting", "asyncApproval", "smallConversation", "recommendationReason",
      "decision", "outcome", "beforePeople", "beforeMinutes", "afterPeople",
      "afterMinutes", "options"
    ],
    additionalProperties: false,
  };
  var prompt =
    "Create one entirely fictional, low-stakes workplace scenario for an anonymous " +
    "research survey about reducing unnecessary meetings. Use the bounded category " +
    "data only to choose a plausible setting; never copy a real incident or mention a " +
    "person, company, exact location, email, or any sensitive trait. The scenario must " +
    "start with an unclear client request. Permitted project evidence can clarify facts " +
    "but cannot settle one genuine scope, date, budget, or responsibility trade-off. " +
    "Compare three routes: no meeting, written approval, and a recommended 2-3 person " +
    "conversation lasting 5-15 minutes. Make it explicit that the assistant prepares " +
    "evidence and recommendations while people decide and approve separately. Provide " +
    "three realistic options with complete shared-record fields. End with a modest, " +
    "checkable follow-up. The time comparison is illustrative, not a measured claim. " +
    "Use plain English, short sentences, and no product names.\n\n" +
    "Bounded survey context:\n" + brief;

  try {
    var scenario = normaliseScenario(callGeminiJson(prompt, schema, 0.55, 1600));
    recordGeneratedResult(
      p,
      "scenario",
      { scenario: scenario },
      { e_scenario_generated: true, e_scenario_route: "smallest_conversation" }
    );
    return out({ ok: true, scenario: scenario });
  } catch (err) {
    return out({ ok: false, err: String(err) });
  }
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}
