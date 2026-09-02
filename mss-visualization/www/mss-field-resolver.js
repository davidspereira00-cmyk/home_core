// ============================================================
// MSS FIELD RESOLVER
// ============================================================
//
// Resolves MSS fields by exact path or wildcard.
//
// Core rule:
//
//   Resolution happens inside ONE MSS group.
//
//   0 matches  -> unavailable
//   1 match    -> resolved
//   2+ matches -> ambiguous
//
// Visualization wildcard mode can additionally use:
//
//   context: 'latest'
//
// which means:
//
//   latest mss_message_id
//        ↓
//   latest specific MSS group
//        ↓
//   fields belonging to that message only
//        ↓
//   wildcard resolution
//
// ============================================================

// ============================================================
// MSS GROUP
// ============================================================

export function getMssStateGroup(state) {
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
// WILDCARD → REGEX
// ============================================================

export function wildcardToRegex(pattern) {
  const escaped = String(pattern ?? '')
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');

  return new RegExp(`^${escaped}$`, 'i');
}

// ============================================================
// ALL LIVE MSS FIELDS
// ============================================================

export function getMssFields(hass) {
  if (!hass?.states) {
    return [];
  }

  const fields = [];

  for (const [entityId, state] of Object.entries(hass.states)) {
    const attributes = state?.attributes ?? {};

    const path = attributes.mss_source_path;

    const group = getMssStateGroup(state);

    if (!path || !group) {
      continue;
    }

    fields.push({
      entityId,

      path: String(path),

      mssGroup: String(group),

      messageId: attributes.mss_message_id
        ? String(attributes.mss_message_id)
        : null,

      controlPlan: attributes.mss_control_plan ?? null,

      generic:
        attributes.mss_generic === true || attributes.mss_generic === 'true',

      value: state.state,

      updated: Date.parse(state.last_updated ?? state.last_changed ?? '') || 0,

      state,
    });
  }

  return fields;
}

// ============================================================
// LATEST REPORT CONTEXT
// ============================================================

export function getLatestMssReportContext(hass) {
  const fields = getMssFields(hass).filter((field) => field.messageId);

  if (fields.length === 0) {
    return null;
  }

  // ==========================================================
  // FIND NEWEST MESSAGE
  // ==========================================================

  fields.sort((a, b) => b.updated - a.updated);

  const messageId = fields[0].messageId;

  const reportFields = fields.filter((field) => field.messageId === messageId);

  // ==========================================================
  // DETERMINE ACTUAL REPORT GROUP
  // ==========================================================
  //
  // A Test1 report can update:
  //
  // MSSReport
  // MSSReport_Test1
  //
  // For visualization we always prefer the specific group.
  // ==========================================================

  const specificGroups = [
    ...new Set(
      reportFields
        .map((field) => field.mssGroup)
        .filter((group) => group && group !== 'MSSReport')
    ),
  ];

  const mssGroup =
    specificGroups[0] ??
    (reportFields.some((field) => field.mssGroup === 'MSSReport')
      ? 'MSSReport'
      : null);

  if (!mssGroup) {
    return null;
  }

  // ==========================================================
  // ONLY THIS REPORT + THIS GROUP
  // ==========================================================

  const groupFields = reportFields.filter(
    (field) => field.mssGroup === mssGroup
  );

  return {
    messageId,

    mssGroup,

    controlPlan:
      groupFields.find((field) => field.controlPlan)?.controlPlan ?? null,

    fields: groupFields,

    allReportFields: reportFields,
  };
}

// ============================================================
// GROUP-SCOPED FIELDS
// ============================================================

export function getMssFieldsForGroup({ hass, mssGroup, messageId = null }) {
  if (!mssGroup) {
    return [];
  }

  return getMssFields(hass).filter((field) => {
    if (field.mssGroup !== mssGroup) {
      return false;
    }

    if (messageId !== null && field.messageId !== String(messageId)) {
      return false;
    }

    return true;
  });
}

// ============================================================
// RESOLVE MSS FIELD
// ============================================================

export function resolveMssField({
  hass,

  field,

  matchMode = 'exact',

  mssGroup = null,

  messageId = null,

  context = 'configured',
}) {
  if (!field) {
    return {
      status: 'unavailable',

      match: null,

      matches: [],

      mssGroup: null,

      messageId: null,
    };
  }

  let effectiveGroup = mssGroup;

  let effectiveMessageId = messageId;

  // ==========================================================
  // LATEST VISUALIZATION CONTEXT
  // ==========================================================

  if (context === 'latest') {
    const latest = getLatestMssReportContext(hass);

    if (!latest) {
      return {
        status: 'unavailable',

        match: null,

        matches: [],

        mssGroup: null,

        messageId: null,
      };
    }

    effectiveGroup = latest.mssGroup;

    effectiveMessageId = latest.messageId;
  }

  if (!effectiveGroup) {
    return {
      status: 'unavailable',

      match: null,

      matches: [],

      mssGroup: null,

      messageId: effectiveMessageId,
    };
  }

  const candidates = getMssFieldsForGroup({
    hass,

    mssGroup: effectiveGroup,

    messageId: effectiveMessageId,
  });

  let matches = [];

  // ==========================================================
  // EXACT
  // ==========================================================

  if (matchMode === 'exact') {
    matches = candidates.filter((candidate) => candidate.path === field);
  }

  // ==========================================================
  // WILDCARD
  // ==========================================================
  else if (matchMode === 'wildcard') {
    const regex = wildcardToRegex(field);

    matches = candidates.filter((candidate) => regex.test(candidate.path));
  }

  // ==========================================================
  // NO MATCH
  // ==========================================================

  if (matches.length === 0) {
    return {
      status: 'unavailable',

      match: null,

      matches: [],

      mssGroup: effectiveGroup,

      messageId: effectiveMessageId,
    };
  }

  // ==========================================================
  // AMBIGUOUS
  // ==========================================================

  if (matches.length > 1) {
    return {
      status: 'ambiguous',

      match: null,

      matches,

      mssGroup: effectiveGroup,

      messageId: effectiveMessageId,
    };
  }

  // ==========================================================
  // RESOLVED
  // ==========================================================

  return {
    status: 'resolved',

    match: matches[0],

    matches,

    mssGroup: effectiveGroup,

    messageId: effectiveMessageId,
  };
}

// ============================================================
// MSS SMART / COMPOSITE FIELD DEFINITIONS
// ============================================================
//
// Smart fields provide higher-level visualization bindings
// without creating additional Home Assistant entities.
//
// Supported:
//
//   Position 2D
//     X + Y
//
//   Size
//     Width + Height
//
//   Measurement
//     entity state + unit_of_measurement
//
// ============================================================

export const MSS_COMPOSITE_DEFINITIONS = [
  {
    type: 'position2d',
    label: 'Position 2D',
    components: {
      x: '_X',
      y: '_Y',
    },
    format: 'X: {x} · Y: {y}',
  },

  {
    type: 'size2d',
    label: 'Size',
    components: {
      width: '_Width',
      height: '_Height',
    },
    format: '{width} × {height}',
  },
];

// ============================================================
// DETECT COMPOSITE FIELDS
// ============================================================

export function getMssCompositeFieldsForGroup({
  hass,
  mssGroup,
  messageId = null,
}) {
  if (!mssGroup) {
    return [];
  }

  const fields = getMssFieldsForGroup({
    hass,
    mssGroup,
    messageId,
  });

  if (fields.length === 0) {
    return [];
  }

  const composites = [];

  for (const definition of MSS_COMPOSITE_DEFINITIONS) {
    const entries = Object.entries(definition.components);

    if (entries.length === 0) {
      continue;
    }

    const [firstKey, firstSuffix] = entries[0];

    // Use the first component to discover possible base paths.
    const candidates = fields.filter((field) =>
      field.path.endsWith(firstSuffix)
    );

    for (const candidate of candidates) {
      const basePath = candidate.path.slice(0, -firstSuffix.length);

      const components = {};
      let complete = true;

      for (const [key, suffix] of entries) {
        const expectedPath = `${basePath}${suffix}`;

        const matches = fields.filter((field) => field.path === expectedPath);

        // Same rule as the normal resolver:
        //
        // 0 -> unavailable
        // 1 -> valid
        // 2+ -> ambiguous
        if (matches.length !== 1) {
          complete = false;
          break;
        }

        const match = matches[0];

        components[key] = {
          dataEntity: match.entityId,
          dataPath: match.path,
        };
      }

      if (!complete) {
        continue;
      }

      composites.push({
        bindingType: 'composite',
        compositeType: definition.type,
        label: definition.label,
        basePath,
        mssGroup,
        components,
        format: definition.format,
      });
    }
  }

  return composites;
}

// ============================================================
// DETECT MEASUREMENT FIELDS
// ============================================================

export function getMssMeasurementFieldsForGroup({
  hass,
  mssGroup,
  messageId = null,
}) {
  if (!mssGroup) {
    return [];
  }

  const fields = getMssFieldsForGroup({
    hass,
    mssGroup,
    messageId,
  });

  return fields
    .filter((field) => {
      const unit = field.state?.attributes?.unit_of_measurement;

      return unit !== undefined && unit !== null && String(unit).trim() !== '';
    })
    .map((field) => ({
      bindingType: 'measurement',

      label: getMssSmartFieldLabel(field.path),

      mssGroup,

      dataEntity: field.entityId,
      dataPath: field.path,

      unit: String(field.state.attributes.unit_of_measurement),

      value: field.value,
    }));
}

// ============================================================
// SMART FIELD LABEL
// ============================================================

export function getMssSmartFieldLabel(path) {
  if (!path) {
    return '';
  }

  const parts = String(path).split('.');

  // Remove #text because it is an implementation detail,
  // not something useful to the visualization user.
  const cleaned = parts.filter((part) => part !== '#text');

  const rawLabel = cleaned[cleaned.length - 1] ?? '';

  return rawLabel
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
}

// ============================================================
// RESOLVE COMPOSITE FIELD
// ============================================================

export function resolveMssCompositeField({
  hass,
  composite,
  mssGroup = null,
  messageId = null,
  context = 'configured',
}) {
  if (!composite?.components) {
    return {
      status: 'unavailable',
      values: {},
      matches: {},
    };
  }

  const values = {};
  const matches = {};

  for (const [key, component] of Object.entries(composite.components)) {
    if (!component?.dataPath) {
      return {
        status: 'unavailable',
        values: {},
        matches: {},
        failedComponent: key,
      };
    }

    const result = resolveMssField({
      hass,
      field: component.dataPath,
      matchMode: 'exact',
      mssGroup: mssGroup ?? composite.mssGroup,
      messageId,
      context,
    });

    if (result.status !== 'resolved') {
      return {
        status: result.status,
        values: {},
        matches: {},
        failedComponent: key,
      };
    }

    values[key] = result.match.value;
    matches[key] = result.match;
  }

  return {
    status: 'resolved',
    values,
    matches,
  };
}

// ============================================================
// FORMAT COMPOSITE VALUE
// ============================================================

export function formatMssCompositeValue({ values, format, decimals = null }) {
  if (!values) {
    return '';
  }

  return String(format ?? '').replace(/\{([^}]+)\}/g, (_, key) => {
    let value = values[key];

    if (value === undefined || value === null) {
      return '';
    }

    if (decimals !== null && value !== '' && Number.isFinite(Number(value))) {
      value = Number(value).toFixed(decimals);
    }

    return String(value);
  });
}

// ============================================================
// FORMAT MEASUREMENT VALUE
// ============================================================

export function formatMssMeasurementValue({ value, unit, decimals = null }) {
  if (value === undefined || value === null) {
    return '';
  }

  let displayValue = value;

  if (decimals !== null && value !== '' && Number.isFinite(Number(value))) {
    displayValue = Number(value).toFixed(decimals);
  }

  return unit ? `${displayValue} ${unit}` : String(displayValue);
}
