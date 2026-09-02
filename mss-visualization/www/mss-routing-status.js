// mss-routing-status.js

export function formatMssRoutingReason(reason) {
  switch (reason) {
    case 'conditions':
      return 'Field conditions';

    case 'mss_group':
      return 'MSS source';

    case 'fallback':
      return 'Fallback';

    case 'no_match':
      return 'No automatic rule';

    case 'no_report':
      return 'No report';

    default:
      return reason || 'No automatic rule';
  }
}

export function formatMssRoutingGroup(group) {
  if (!group) {
    return 'Any MSS source';
  }

  if (group === 'MSSReport') {
    return 'MSS Report';
  }

  if (group.startsWith('MSSReport_')) {
    return `MSS Report - ${group.slice('MSSReport_'.length)}`;
  }

  return String(group)
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

export function renderMssRoutingStatus(result) {
  const diagnostics = result?.diagnostics;

  if (!diagnostics) {
    return '';
  }

  const priority = result?.priority;

  const reason = formatMssRoutingReason(result?.reason);

  const source = formatMssRoutingGroup(diagnostics.mssGroup);

  let details = source;

  if (diagnostics.conditionsTotal !== undefined) {
    details =
      `${diagnostics.conditionsMatched} / ` +
      `${diagnostics.conditionsTotal} matched · ` +
      source;
  }

  return `
    <div class="mss-routing-status">

      <div class="mss-routing-status-main">
        Priority ${priority ?? '—'} · ${reason}
      </div>

      <div class="mss-routing-status-details">
        ${details}
      </div>

      ${
        result?.keptCurrent
          ? `
              <div class="mss-routing-status-kept">
                Current View kept
              </div>
            `
          : ''
      }

    </div>
  `;
}
