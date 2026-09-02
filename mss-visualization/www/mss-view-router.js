// ============================================================
// MSS AUTOMATIC VIEW ROUTER
// ============================================================
//
// Routing priority:
//
//   1. Field conditions
//   2. MSS group / Control Plan
//   3. Fallback
//
// Manual Views are never selected automatically.
//
// Important:
// Conditions are evaluated ONLY against fields belonging to the
// latest MSS message_id. Old values from previous reports cannot
// accidentally activate a View.
// ============================================================

// ============================================================
// ROUTING MODES
// ============================================================

import { resolveMssField } from './mss-field-resolver.js';

export const MSS_VIEW_ROUTING_MODE = {
  MANUAL: 'manual',

  CONDITIONS: 'conditions',

  MSS_GROUP: 'mss_group',

  FALLBACK: 'fallback',
};

// ============================================================
// NORMALIZE VIEW ROUTING
// ============================================================

export function normalizeViewRouting(view) {
  const routing = view?.autoRouting ?? {};

  const conditions = Array.isArray(routing.conditions)
    ? routing.conditions
    : [];

  const mssGroup = routing.mssGroup ?? '';

  // ==========================================================
  // DISABLED = MANUAL
  // ==========================================================

  if (routing.enabled === false) {
    return {
      enabled: false,

      mode: MSS_VIEW_ROUTING_MODE.MANUAL,

      conditionLogic: 'and',

      conditions: [],

      mssGroup: '',
    };
  }

  // ==========================================================
  // PRIORITY 1 = CONDITIONS
  // ==========================================================
  //
  // A)
  // MSS source + conditions
  //
  // B)
  // Any MSS source + conditions
  //
  // Both are Priority 1.
  // ==========================================================

  if (conditions.length > 0) {
    return {
      enabled: routing.enabled !== false,

      mode: MSS_VIEW_ROUTING_MODE.CONDITIONS,

      conditionLogic: routing.conditionLogic === 'or' ? 'or' : 'and',

      conditions,

      mssGroup,
    };
  }

  // ==========================================================
  // PRIORITY 2 = MSS SOURCE ONLY
  // ==========================================================

  if (mssGroup) {
    return {
      enabled: routing.enabled !== false,

      mode: MSS_VIEW_ROUTING_MODE.MSS_GROUP,

      conditionLogic: 'and',

      conditions: [],

      mssGroup,
    };
  }

  // ==========================================================
  // PRIORITY 3 = FALLBACK
  // ==========================================================
  //
  // Enabled
  // No source
  // No conditions
  // ==========================================================

  if (routing.enabled === true) {
    return {
      enabled: true,

      mode: MSS_VIEW_ROUTING_MODE.FALLBACK,

      conditionLogic: 'and',

      conditions: [],

      mssGroup: '',
    };
  }

  return {
    enabled: false,

    mode: MSS_VIEW_ROUTING_MODE.MANUAL,

    conditionLogic: 'and',

    conditions: [],

    mssGroup: '',
  };
}

// ============================================================
// MSS ENTITY GROUP
// ============================================================

function getMssStateGroup(state) {
  const attributes = state?.attributes ?? {};

  if (attributes.mss_group) {
    return String(attributes.mss_group);
  }

  if (attributes.mss_generic === true || attributes.mss_generic === 'true') {
    return 'MSSReport';
  }

  if (attributes.mss_control_plan) {
    return `MSSReport_${attributes.mss_control_plan}`;
  }

  return null;
}

// ============================================================
// LATEST MSS REPORT
// ============================================================

export function getLatestMssReportContext(hass) {
  if (!hass?.states) {
    return null;
  }

  const candidates = [];

  for (const [entityId, state] of Object.entries(hass.states)) {
    const attributes = state?.attributes ?? {};

    const messageId = attributes.mss_message_id;

    const sourcePath = attributes.mss_source_path;

    const group = getMssStateGroup(state);

    if (!messageId || !sourcePath || !group) {
      continue;
    }

    candidates.push({
      entityId,

      state,

      messageId: String(messageId),

      sourcePath: String(sourcePath),

      group: String(group),

      updated: Date.parse(state.last_updated ?? state.last_changed ?? '') || 0,
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  // ==========================================================
  // FIND LATEST REPORT MESSAGE ID
  // ==========================================================

  candidates.sort((a, b) => b.updated - a.updated);

  const latestMessageId = candidates[0].messageId;

  const reportEntities = candidates.filter(
    (item) => item.messageId === latestMessageId
  );

  // ==========================================================
  // GROUPS INVOLVED IN THIS REPORT
  // ==========================================================

  const groups = new Set(reportEntities.map((item) => item.group));

  // ==========================================================
  // SPECIFIC CONTROL PLAN GROUP
  // ==========================================================

  const specificGroups = Array.from(groups).filter(
    (group) => group !== 'MSSReport'
  );

  /*
   * One MQTT report should normally have:
   *
   * MSSReport
   * MSSReport_Test1
   *
   * If a specific group exists, that is the report's actual
   * control-plan source.
   */
  const mssGroup =
    specificGroups[0] ?? (groups.has('MSSReport') ? 'MSSReport' : null);

  // ==========================================================
  // GENERIC REPORT FIELD MAP
  // ==========================================================
  //
  // Priority-1 conditions use MSSReport fields.
  //
  // Because all entries are filtered by the SAME message_id,
  // these are values from the current report only.
  // ==========================================================

  const fields = new Map();

  for (const item of reportEntities) {
    if (item.group !== 'MSSReport') {
      continue;
    }

    fields.set(item.sourcePath, {
      entityId: item.entityId,

      value: item.state.state,

      state: item.state,
    });
  }

  // ==========================================================
  // FALLBACK
  // ==========================================================
  //
  // In case an old/custom MSS setup has no generic entities,
  // build fields from the actual report group.
  // ==========================================================

  if (fields.size === 0) {
    for (const item of reportEntities) {
      if (item.group !== mssGroup) {
        continue;
      }

      fields.set(item.sourcePath, {
        entityId: item.entityId,

        value: item.state.state,

        state: item.state,
      });
    }
  }

  return {
    messageId: latestMessageId,

    mssGroup,

    groups,

    fields,

    reportEntities,
  };
}

// ============================================================
// CONDITION HELPERS
// ============================================================

function normalizeString(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value);
}

function finiteNumber(value) {
  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

// ============================================================
// EVALUATE ONE CONDITION
// ============================================================

export function evaluateViewCondition(condition, report, hass, routing) {
  if (!condition || !report || !hass) {
    return false;
  }

  // ==========================================================
  // MATCH MODE
  // ==========================================================

  const matchMode = condition.matchMode === 'wildcard' ? 'wildcard' : 'exact';

  // Exact:
  // use the concrete selected field.
  //
  // Dynamic:
  // use the generated reusable pattern.
  const field = matchMode === 'wildcard' ? condition.pattern : condition.field;

  if (!field) {
    return false;
  }

  // ==========================================================
  // SOURCE SCOPE
  // ==========================================================
  //
  // Priority 1A:
  //
  // routing.mssGroup exists
  // -> condition is restricted to that MSS source.
  //
  // Priority 1B:
  //
  // routing.mssGroup is empty
  // -> condition follows whatever actual MSS group arrived.
  //
  // condition.exampleMssGroup is NEVER used here.
  // It is editor-only.
  // ==========================================================

  if (routing?.mssGroup && !report.groups?.has(routing.mssGroup)) {
    return false;
  }

  const effectiveGroup = routing?.mssGroup || report.mssGroup;

  if (!effectiveGroup) {
    return false;
  }

  // ==========================================================
  // RESOLVE FIELD
  // ==========================================================

  const resolution = resolveMssField({
    hass,

    field,

    matchMode,

    mssGroup: effectiveGroup,

    messageId: report.messageId,

    context: 'configured',
  });

  const operator = condition.operator ?? 'equals';

  // ==========================================================
  // EXISTS / NOT EXISTS
  // ==========================================================

  if (operator === 'exists') {
    return resolution.status === 'resolved';
  }

  if (operator === 'notExists') {
    return resolution.status === 'unavailable';
  }

  // ==========================================================
  // MUST RESOLVE EXACTLY ONE FIELD
  // ==========================================================

  if (resolution.status !== 'resolved' || !resolution.match) {
    if (resolution.status === 'ambiguous') {
      console.warn('[MSS View Router] Dynamic field is ambiguous', {
        pattern: condition.pattern,

        mssGroup: effectiveGroup,

        matches: resolution.matches.map((match) => match.path),
      });
    }

    return false;
  }

  const currentValue = resolution.match.value;

  const compareValue = condition.value ?? '';

  const currentString = normalizeString(currentValue);

  const compareString = normalizeString(compareValue);

  // ==========================================================
  // OPERATORS
  // ==========================================================

  switch (operator) {
    case 'notEquals':
      return currentString !== compareString;

    case 'contains':
      return currentString.includes(compareString);

    case 'notContains':
      return !currentString.includes(compareString);

    case 'greaterThan': {
      const currentNumber = finiteNumber(currentValue);

      const compareNumber = finiteNumber(compareValue);

      return (
        currentNumber !== null &&
        compareNumber !== null &&
        currentNumber > compareNumber
      );
    }

    case 'lessThan': {
      const currentNumber = finiteNumber(currentValue);

      const compareNumber = finiteNumber(compareValue);

      return (
        currentNumber !== null &&
        compareNumber !== null &&
        currentNumber < compareNumber
      );
    }

    case 'greaterThanOrEqual': {
      const currentNumber = finiteNumber(currentValue);

      const compareNumber = finiteNumber(compareValue);

      return (
        currentNumber !== null &&
        compareNumber !== null &&
        currentNumber >= compareNumber
      );
    }

    case 'lessThanOrEqual': {
      const currentNumber = finiteNumber(currentValue);

      const compareNumber = finiteNumber(compareValue);

      return (
        currentNumber !== null &&
        compareNumber !== null &&
        currentNumber <= compareNumber
      );
    }

    case 'equals':
    default:
      return currentString === compareString;
  }
}

// ============================================================
// CONDITION RULE KEY
// ============================================================
//
// Views with identical conditions receive the same rule key.
//
// That lets us implement:
//
// "If one of several Views with the SAME conditions is already
// active, keep it."
// ============================================================

function createConditionRuleKey(routing) {
  const normalizedConditions = (routing.conditions ?? [])
    .map((condition) => ({
      field: condition.field ?? '',

      matchMode: condition.matchMode ?? 'exact',

      pattern: condition.pattern ?? '',

      operator: condition.operator ?? 'equals',

      value: condition.value ?? '',
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  return JSON.stringify({
    mssGroup: routing.mssGroup ?? '',

    logic: routing.conditionLogic === 'or' ? 'or' : 'and',

    conditions: normalizedConditions,
  });
}

// ============================================================
// DOES CONDITION VIEW MATCH?
// ============================================================

function evaluateConditionView(view, report, hass) {
  const routing = normalizeViewRouting(view);

  if (routing.mode !== MSS_VIEW_ROUTING_MODE.CONDITIONS || !routing.enabled) {
    return null;
  }

  const conditions = routing.conditions.filter((condition) => {
    if (condition?.matchMode === 'wildcard') {
      return Boolean(condition.pattern);
    }

    return Boolean(condition?.field);
  });

  if (conditions.length === 0) {
    return null;
  }

  // ==========================================================
  // SPECIFIC SOURCE + CONDITIONS
  // ==========================================================
  //
  // Do this once for the whole View before evaluating each
  // individual condition.
  // ==========================================================

  if (routing.mssGroup && !report?.groups?.has(routing.mssGroup)) {
    return null;
  }

  const results = conditions.map((condition) =>
    evaluateViewCondition(condition, report, hass, routing)
  );

  const matches =
    routing.conditionLogic === 'or'
      ? results.some(Boolean)
      : results.every(Boolean);

  if (!matches) {
    return null;
  }

  return {
    view,

    routing,

    priority: 1,

    specificity: conditions.length,

    ruleKey: createConditionRuleKey(routing),

    diagnostics: {
      conditionLogic: routing.conditionLogic,

      conditionsTotal: conditions.length,

      conditionsMatched: results.filter(Boolean).length,

      mssGroup: routing.mssGroup || report.mssGroup,

      messageId: report.messageId,
    },
  };
}

// ============================================================
// RESOLVE PRIORITY-1 CONDITIONS
// ============================================================

function resolveConditionViews({ views, currentViewId, report, hass }) {
  const matches = views
    .map((view, index) => {
      const match = evaluateConditionView(view, report, hass);

      return match
        ? {
            ...match,
            index,
          }
        : null;
    })
    .filter(Boolean);

  if (matches.length === 0) {
    return null;
  }

  /*
   * Different Priority-1 rules can all be true at once.
   *
   * More conditions = more specific.
   *
   * Example:
   *
   * Product = A
   *
   * vs
   *
   * Product = A AND Station = 4
   *
   * The second rule wins.
   */
  const highestSpecificity = Math.max(
    ...matches.map((match) => match.specificity)
  );

  const mostSpecific = matches.filter(
    (match) => match.specificity === highestSpecificity
  );

  /*
   * Views are already in deterministic user-defined order.
   *
   * The first distinct rule at this specificity becomes the
   * winning rule.
   */
  const winningRuleKey = mostSpecific[0].ruleKey;

  const winningViews = mostSpecific.filter(
    (match) => match.ruleKey === winningRuleKey
  );

  // ----------------------------------------------------------
  // CURRENT VIEW HAS SAME CONDITIONS
  // ----------------------------------------------------------

  const currentMatch = winningViews.find(
    (match) => String(match.view.id) === String(currentViewId)
  );

  if (currentMatch) {
    return {
      view: currentMatch.view,

      priority: 1,

      reason: 'conditions',

      ruleKey: winningRuleKey,

      keptCurrent: true,

      diagnostics: currentMatch.diagnostics,
    };
  }

  const winner = winningViews[0];

  return {
    view: winner.view,

    priority: 1,

    reason: 'conditions',

    ruleKey: winningRuleKey,

    keptCurrent: false,

    diagnostics: winner.diagnostics,
  };
}

// ============================================================
// RESOLVE PRIORITY-2 MSS GROUP
// ============================================================

function resolveMssGroupViews({ views, currentViewId, report }) {
  if (!report) {
    return null;
  }

  const matches = views
    .map((view, index) => {
      const routing = normalizeViewRouting(view);

      if (
        !routing.enabled ||
        routing.mode !== MSS_VIEW_ROUTING_MODE.MSS_GROUP ||
        !routing.mssGroup
      ) {
        return null;
      }

      if (!report.groups.has(routing.mssGroup)) {
        return null;
      }

      /*
       * Exact control-plan group outranks generic MSSReport
       * inside Priority 2.
       */
      const specificity = routing.mssGroup === report.mssGroup ? 2 : 1;

      return {
        view,

        routing,

        index,

        priority: 2,

        specificity,

        ruleKey: routing.mssGroup,
      };
    })
    .filter(Boolean);

  if (matches.length === 0) {
    return null;
  }

  const highestSpecificity = Math.max(
    ...matches.map((match) => match.specificity)
  );

  const mostSpecific = matches.filter(
    (match) => match.specificity === highestSpecificity
  );

  const winningGroup = mostSpecific[0].ruleKey;

  const winningViews = mostSpecific.filter(
    (match) => match.ruleKey === winningGroup
  );

  const currentMatch = winningViews.find(
    (match) => String(match.view.id) === String(currentViewId)
  );

  const diagnostics = {
    mssGroup: winningGroup,

    messageId: report.messageId,
  };

  if (currentMatch) {
    return {
      view: currentMatch.view,

      priority: 2,

      reason: 'mss_group',

      ruleKey: winningGroup,

      keptCurrent: true,

      diagnostics,
    };
  }

  return {
    view: winningViews[0].view,

    priority: 2,

    reason: 'mss_group',

    ruleKey: winningGroup,

    keptCurrent: false,

    diagnostics,
  };
}

// ============================================================
// RESOLVE PRIORITY-3 FALLBACK
// ============================================================

function resolveFallbackViews({ views, currentViewId, report }) {
  const fallbackViews = views.filter((view) => {
    const routing = normalizeViewRouting(view);

    return routing.enabled && routing.mode === MSS_VIEW_ROUTING_MODE.FALLBACK;
  });

  if (fallbackViews.length === 0) {
    return null;
  }

  const current = fallbackViews.find(
    (view) => String(view.id) === String(currentViewId)
  );

  const diagnostics = {
    mssGroup: report?.mssGroup ?? null,

    messageId: report?.messageId ?? null,
  };

  if (current) {
    return {
      view: current,

      priority: 3,

      reason: 'fallback',

      ruleKey: 'fallback',

      keptCurrent: true,

      diagnostics,
    };
  }

  return {
    view: fallbackViews[0],

    priority: 3,

    reason: 'fallback',

    ruleKey: 'fallback',

    keptCurrent: false,

    diagnostics,
  };
}
// ============================================================
// MAIN VIEW RESOLVER
// ============================================================

export function resolveAutomaticView({
  views,
  currentViewId,
  hass,
  report = null,
}) {
  if (!Array.isArray(views) || views.length === 0) {
    return {
      viewId: currentViewId ?? null,

      view: null,

      changed: false,

      priority: null,

      reason: 'no_views',

      report: null,
    };
  }

  const reportContext = report ?? getLatestMssReportContext(hass);

  /*
   * No complete live report exists yet.
   *
   * Do not automatically move away from the user's current
   * View merely because restored MSS entities exist.
   */
  if (!reportContext) {
    return {
      viewId: currentViewId,

      view:
        views.find((view) => String(view.id) === String(currentViewId)) ?? null,

      changed: false,

      priority: null,

      reason: 'no_report',

      report: null,
    };
  }

  // ==========================================================
  // PRIORITY 1
  // ==========================================================

  const conditionResult = resolveConditionViews({
    views,
    currentViewId,
    report: reportContext,
    hass,
  });

  if (conditionResult) {
    return finalizeResult(conditionResult, currentViewId, reportContext);
  }

  // ==========================================================
  // PRIORITY 2
  // ==========================================================

  const groupResult = resolveMssGroupViews({
    views,

    currentViewId,

    report: reportContext,
  });

  if (groupResult) {
    return finalizeResult(groupResult, currentViewId, reportContext);
  }

  // ==========================================================
  // PRIORITY 3
  // ==========================================================

  const fallbackResult = resolveFallbackViews({
    views,

    currentViewId,
    report: reportContext,
  });

  if (fallbackResult) {
    return finalizeResult(fallbackResult, currentViewId, reportContext);
  }

  // ==========================================================
  // NOTHING MATCHED
  // ==========================================================
  //
  // This is important:
  //
  // if the user is currently on a manual View and no automatic
  // rule applies, DO NOT change it.
  // ==========================================================

  const current =
    views.find((view) => String(view.id) === String(currentViewId)) ?? null;

  return {
    viewId: currentViewId,

    view: current,

    changed: false,

    priority: null,

    reason: 'no_match',

    report: reportContext,
  };
}

// ============================================================
// FINAL RESULT
// ============================================================

function finalizeResult(result, currentViewId, report) {
  const nextId = result.view?.id ?? currentViewId;

  return {
    ...result,

    viewId: nextId,

    changed: String(nextId) !== String(currentViewId),

    report,
  };
}
