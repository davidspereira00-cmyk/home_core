// ============================================================
// MSS MEASUREMENTS CARD
// ============================================================

function createMssMeasurementsStorageId() {
  return (
    'mss_table_' +
    (globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}_${Math.random().toString(36).slice(2)}`)
  );
}

class MSSMeasurementsCard extends HTMLElement {
  constructor() {
    super();

    this.attachShadow({
      mode: 'open',
    });

    this._hass = null;

    this._config = {
      type: 'custom:mss-measurements-card',

      title: 'MSS Measurements',

      entities: [],

      // Selected MSS source.
      //
      // Examples:
      // MSSReport
      // MSSReport_Test1
      // MSSReport_Test2
      mss_group: '',

      max_rows: 50,

      history_mode: 'recorder',

      history_hours: 24,

      storage_id: '',
    };

    // ========================================================
    // TABLE STATE
    // ========================================================

    this.rows = [];

    this.lastMessageId = null;

    this.initialized = false;

    this.snapshotTimer = null;

    this._trackingKey = '';

    // ========================================================
    // RECORDER
    // ========================================================

    this._historyLoading = false;

    this._historyLoadedKey = '';

    this._historyError = null;

    // ========================================================
    // LOCAL STORAGE
    // ========================================================

    this._localStorageKey = null;

    this._localStorageLoaded = false;
  }

  // ============================================================
  // HOME ASSISTANT CARD API
  // ============================================================

  static getConfigElement() {
    return document.createElement('mss-measurements-card-editor');
  }

  static getStubConfig() {
    return {
      title: 'MSS Measurements',

      entities: [],

      mss_group: '',

      max_rows: 50,

      history_mode: 'recorder',

      history_hours: 24,

      storage_id: createMssMeasurementsStorageId(),
    };
  }

  setConfig(config) {
    if (!config) {
      throw new Error('MSS Measurements Card configuration is required.');
    }

    const entities = this.normalizeEntities(config.entities ?? []);

    if (entities.length > 6) {
      throw new Error(
        'MSS Measurements Card supports a maximum of 6 entities.'
      );
    }

    const historyMode =
      config.history_mode === 'session' ? 'session' : 'recorder';

    const newConfig = {
      ...config,

      type: config.type ?? 'custom:mss-measurements-card',

      title: config.title ?? 'MSS Measurements',

      entities,

      mss_group: config.mss_group ?? '',

      max_rows: Math.max(1, Number(config.max_rows) || 50),

      history_mode: historyMode,

      history_hours: this.normalizeHistoryHours(config.history_hours),

      storage_id: config.storage_id ?? '',
    };

    // ========================================================
    // ENTITY SELECTION CHANGED
    // ========================================================
    //
    // IMPORTANT:
    //
    // We DO NOT clear rows anymore.
    //
    // Adding/removing/reordering columns only resets the
    // live-message baseline and Recorder query.
    //
    // ========================================================

    const newTrackingKey = JSON.stringify(entities.map((item) => item.entity));

    if (this._trackingKey && this._trackingKey !== newTrackingKey) {
      this.resetLiveTracking();
    }

    this._trackingKey = newTrackingKey;

    // ========================================================
    // RECORDER QUERY KEY
    // ========================================================

    const oldHistoryKey = this.getHistoryConfigKey(this._config);

    const oldStorageKey = this.getLocalStorageKeyForConfig(this._config);

    const newHistoryKey = this.getHistoryConfigKey(newConfig);

    this._config = newConfig;

    const newStorageKey = this.getLocalStorageKey();

    /*
     * storage_id may have just been introduced to an existing
     * card. Allow local storage to be loaded again using the
     * new stable ID.
     */
    if (oldStorageKey !== newStorageKey) {
      this.clearLoadedLocalStorageState();
    }

    // Restore persisted rows.
    this.loadLocalRows();

    // Recorder settings or selected entities changed.
    if (oldHistoryKey !== newHistoryKey) {
      this._historyLoadedKey = '';

      this._historyError = null;

      if (newConfig.history_mode === 'session') {
        this.rows = this.rows.filter((row) => row.source !== 'recorder');
      }
    }

    if (this.rows.length > this._config.max_rows) {
      this.rows.length = this._config.max_rows;

      this.saveLocalRows();
    }

    this.render();

    this.ensureHistoryLoaded();
  }

  // ============================================================
  // HASS
  // ============================================================

  set hass(hass) {
    this._hass = hass;

    const entities = this.configuredEntities;

    if (!hass || entities.length === 0) {
      this.render();

      return;
    }

    // Load local storage first.
    this.loadLocalRows();

    // Then allow Recorder to fill/restore historical fields.
    this.ensureHistoryLoaded();

    const messageId = this.getCurrentMessageId();

    if (messageId === null) {
      this.render();

      return;
    }

    // ========================================================
    // INITIAL LIVE BASELINE
    // ========================================================

    if (!this.initialized) {
      this.lastMessageId = messageId;

      this.initialized = true;

      this.render();

      return;
    }

    // ========================================================
    // NEW MSS REPORT
    // ========================================================

    if (!this.sameMessageId(messageId, this.lastMessageId)) {
      this.lastMessageId = messageId;

      this.scheduleSnapshot(messageId);
    }

    this.render();
  }

  // ============================================================
  // ENTITY CONFIGURATION
  // ============================================================

  get configuredEntities() {
    return this.normalizeEntities(this._config?.entities ?? []);
  }

  normalizeEntities(entities) {
    if (!Array.isArray(entities)) {
      return [];
    }

    return entities
      .map((entry) => {
        // ======================================================
        // LEGACY STRING CONFIG
        // ======================================================

        if (typeof entry === 'string') {
          return {
            entity: entry,

            data_path: '',

            name: '',

            font_size: 12,
          };
        }

        // ======================================================
        // NEW MSS COLUMN CONFIG
        // ======================================================

        if (entry && typeof entry === 'object') {
          return {
            entity: entry.entity ?? '',

            data_path: entry.data_path ?? '',

            name: entry.name ?? '',

            font_size: this.normalizeFontSize(entry.font_size),
          };
        }

        return null;
      })
      .filter((entry) => entry?.entity)
      .slice(0, 6);
  }

  normalizeFontSize(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
      return 12;
    }

    return Math.max(8, Math.min(32, Math.round(number)));
  }

  normalizeHistoryHours(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
      return 24;
    }

    return Math.max(1, Math.min(8760, Math.round(number)));
  }

  // ============================================================
  // MSS MESSAGE ID
  // ============================================================

  getEntityMessageId(entityId) {
    const state = this._hass?.states?.[entityId];

    if (!state) {
      return null;
    }

    const messageId = state.attributes?.mss_message_id;

    if (messageId === undefined || messageId === null || messageId === '') {
      return null;
    }

    return String(messageId);
  }

  getCurrentMessageId() {
    /*
     * HA updates individual entities separately.
     *
     * Use the selected entity with the newest last_updated
     * timestamp as the current report reference.
     */

    let newest = null;

    for (const config of this.configuredEntities) {
      const state = this._hass?.states?.[config.entity];

      if (!state) {
        continue;
      }

      const messageId = state.attributes?.mss_message_id;

      if (messageId === undefined || messageId === null || messageId === '') {
        continue;
      }

      const parsed = Date.parse(state.last_updated ?? state.last_changed ?? '');

      const timestamp = Number.isFinite(parsed) ? parsed : 0;

      if (!newest || timestamp > newest.timestamp) {
        newest = {
          messageId: String(messageId),

          timestamp,
        };
      }
    }

    return newest?.messageId ?? null;
  }

  sameMessageId(a, b) {
    if (a === null || b === null) {
      return a === b;
    }

    return String(a) === String(b);
  }

  // ============================================================
  // TRACKING
  // ============================================================

  resetLiveTracking() {
    /*
     * Changing columns should NOT clear table history.
     *
     * We only establish a fresh live-MQTT baseline.
     */

    this.lastMessageId = null;

    this.initialized = false;

    this._historyLoadedKey = '';

    this._historyError = null;

    if (this.snapshotTimer) {
      window.clearTimeout(this.snapshotTimer);

      this.snapshotTimer = null;
    }
  }

  resetTracking() {
    /*
     * Full reset retained in case we explicitly need it later.
     */

    this.rows = [];

    this.resetLiveTracking();

    this.clearLoadedLocalStorageState();
  }

  // ============================================================
  // LIVE SNAPSHOT
  // ============================================================

  scheduleSnapshot(messageId) {
    if (this.snapshotTimer) {
      window.clearTimeout(this.snapshotTimer);
    }

    this.snapshotTimer = window.setTimeout(() => {
      this.snapshotTimer = null;

      this.captureSnapshot(messageId);
    }, 150);
  }

  captureSnapshot(messageId) {
    if (!this._hass || this.configuredEntities.length === 0) {
      return;
    }

    const values = {};

    let hasAvailableValue = false;

    for (const config of this.configuredEntities) {
      const entityId = config.entity;

      const state = this._hass.states?.[entityId];

      if (!state) {
        values[entityId] = '—';

        continue;
      }

      const entityMessageId = this.getEntityMessageId(entityId);

      /*
       * Don't copy an old value from a field that wasn't
       * updated by this MSS report.
       */
      if (
        entityMessageId !== null &&
        !this.sameMessageId(entityMessageId, messageId)
      ) {
        values[entityId] = '—';

        continue;
      }

      values[entityId] = this.formatEntityValue(state);

      if (!this.isUnavailableState(state.state)) {
        hasAvailableValue = true;
      }
    }

    if (!hasAvailableValue) {
      return;
    }

    const row = {
      id: `mss-${messageId}`,

      messageId: String(messageId),

      receivedAt: new Date().toISOString(),

      timestamp: Date.now(),

      values,

      source: 'live',
    };

    this.upsertRow(row, true);

    this.render();
  }

  // ============================================================
  // LOCAL STORAGE
  // ============================================================

  getLocalStorageKeyForConfig(config) {
    /*
     * New stable storage format.
     *
     * Column changes do NOT change this key.
     */

    if (config?.storage_id) {
      return 'mss-measurements-card:' + config.storage_id;
    }

    /*
     * Legacy fallback for cards created before storage_id.
     *
     * This preserves the rows you've already saved.
     */

    const entities = Array.isArray(config?.entities)
      ? config.entities
          .map((entry) => (typeof entry === 'string' ? entry : entry?.entity))
          .filter(Boolean)
          .sort()
      : [];

    if (entities.length === 0) {
      return null;
    }

    return 'mss-measurements-card:' + entities.join('|');
  }

  getLocalStorageKey() {
    return this.getLocalStorageKeyForConfig(this._config);
  }

  getLegacyLocalStorageKey() {
    const entityIds = this.configuredEntities
      .map((config) => config.entity)
      .filter(Boolean)
      .sort();

    if (entityIds.length === 0) {
      return null;
    }

    return 'mss-measurements-card:' + entityIds.join('|');
  }

  loadLocalRows() {
    const key = this.getLocalStorageKey();

    if (!key) {
      return;
    }

    if (this._localStorageLoaded && this._localStorageKey === key) {
      return;
    }

    this._localStorageKey = key;

    this._localStorageLoaded = true;

    try {
      let raw = window.localStorage.getItem(key);

      // ======================================================
      // LEGACY MIGRATION
      // ======================================================
      //
      // If this card now has storage_id but its new storage
      // location is empty, attempt to import the previous
      // entity-list-based storage once.
      //
      // ======================================================

      if (!raw && this._config.storage_id) {
        const legacyKey = this.getLegacyLocalStorageKey();

        if (legacyKey && legacyKey !== key) {
          raw = window.localStorage.getItem(legacyKey);
        }
      }

      if (!raw) {
        return;
      }

      const stored = JSON.parse(raw);

      if (!Array.isArray(stored)) {
        return;
      }

      for (const row of stored) {
        if (
          !row ||
          row.messageId === undefined ||
          row.messageId === null ||
          typeof row.values !== 'object'
        ) {
          continue;
        }

        this.upsertRow(
          {
            id: row.id ?? `mss-${row.messageId}`,

            messageId: String(row.messageId),

            receivedAt: row.receivedAt ?? '',

            timestamp: Number(row.timestamp) || 0,

            values: row.values ?? {},

            source: row.source ?? 'local',
          },

          false,

          false
        );
      }

      this.sortAndTrimRows();

      /*
       * If we loaded old legacy data and this card now has a
       * stable storage_id, save it immediately under the new
       * key.
       */
      if (this._config.storage_id) {
        this.saveLocalRows();
      }
    } catch (error) {
      console.error(
        'MSS Measurements Card: failed to load local history',
        error
      );
    }
  }

  saveLocalRows() {
    const key = this.getLocalStorageKey();

    if (!key) {
      return;
    }

    try {
      const rows = this.rows.slice(0, this._config.max_rows).map((row) => ({
        id: row.id,

        messageId: row.messageId,

        receivedAt: row.receivedAt,

        timestamp: row.timestamp,

        values: row.values,

        source: row.source,
      }));

      window.localStorage.setItem(key, JSON.stringify(rows));
    } catch (error) {
      console.error(
        'MSS Measurements Card: failed to save local history',
        error
      );
    }
  }

  clearLoadedLocalStorageState() {
    this._localStorageKey = null;

    this._localStorageLoaded = false;
  }

  // ============================================================
  // RECORDER HISTORY
  // ============================================================

  getHistoryConfigKey(config = this._config) {
    const entities = Array.isArray(config?.entities)
      ? config.entities
          .map((entry) => (typeof entry === 'string' ? entry : entry?.entity))
          .filter(Boolean)
      : [];

    return JSON.stringify({
      entities,

      mode: config?.history_mode ?? 'recorder',

      hours: Number(config?.history_hours ?? 24),
    });
  }

  async ensureHistoryLoaded() {
    if (
      !this._hass ||
      this._config.history_mode !== 'recorder' ||
      this.configuredEntities.length === 0
    ) {
      return;
    }

    const key = this.getHistoryConfigKey();

    if (this._historyLoading || this._historyLoadedKey === key) {
      return;
    }

    this._historyLoading = true;

    this._historyError = null;

    this.render();

    try {
      await this.loadRecorderHistory();

      this._historyLoadedKey = key;
    } catch (error) {
      console.error(
        'MSS Measurements Card: failed to load Recorder history',
        error
      );

      this._historyError = error?.message ?? String(error);
    } finally {
      this._historyLoading = false;

      this.render();
    }
  }

  async loadRecorderHistory() {
    const entityIds = this.configuredEntities
      .map((config) => config.entity)
      .filter(Boolean);

    if (entityIds.length === 0) {
      return;
    }

    const historyHours = this.normalizeHistoryHours(this._config.history_hours);

    const startTime = new Date(
      Date.now() - historyHours * 60 * 60 * 1000
    ).toISOString();

    const history = await this._hass.callWS({
      type: 'history/history_during_period',

      start_time: startTime,

      entity_ids: entityIds,

      include_start_time_state: false,

      significant_changes_only: false,

      minimal_response: false,

      no_attributes: false,
    });

    this.rebuildRowsFromHistory(history);
  }

  rebuildRowsFromHistory(history) {
    if (!history || typeof history !== 'object') {
      return;
    }

    const reportRows = new Map();

    for (const config of this.configuredEntities) {
      const entityId = config.entity;

      const states = history[entityId];

      if (!Array.isArray(states)) {
        continue;
      }

      for (const state of states) {
        const messageId = state?.attributes?.mss_message_id;

        if (messageId === undefined || messageId === null || messageId === '') {
          continue;
        }

        const key = String(messageId);

        const timestamp = this.getHistoryStateTimestamp(state);

        let row = reportRows.get(key);

        if (!row) {
          row = {
            id: `mss-${key}`,

            messageId: key,

            receivedAt: timestamp ? new Date(timestamp).toISOString() : '',

            timestamp,

            values: {},

            source: 'recorder',
          };

          reportRows.set(key, row);
        }

        if (timestamp > row.timestamp) {
          row.timestamp = timestamp;

          row.receivedAt = new Date(timestamp).toISOString();
        }

        row.values[entityId] = this.formatHistoryValue(state);
      }
    }

    const historicalRows = Array.from(reportRows.values());

    /*
     * Do NOT overwrite old row values from localStorage.
     *
     * Missing configured fields simply become —.
     */

    for (const row of historicalRows) {
      for (const config of this.configuredEntities) {
        if (!Object.prototype.hasOwnProperty.call(row.values, config.entity)) {
          row.values[config.entity] = '—';
        }
      }
    }

    historicalRows.sort((a, b) => a.timestamp - b.timestamp);

    for (const row of historicalRows) {
      this.upsertRow(row, false);
    }

    this.sortAndTrimRows();

    this.saveLocalRows();
  }

  getHistoryStateTimestamp(state) {
    const raw = state?.last_updated ?? state?.last_changed;

    if (!raw) {
      return 0;
    }

    if (typeof raw === 'number') {
      return raw > 100000000000 ? raw : raw * 1000;
    }

    const parsed = Date.parse(raw);

    return Number.isFinite(parsed) ? parsed : 0;
  }

  formatHistoryValue(state) {
    if (!state) {
      return '—';
    }

    if (this.isUnavailableState(state.state)) {
      return '—';
    }

    const unit = state.attributes?.unit_of_measurement;

    if (unit) {
      return `${state.state} ${unit}`;
    }

    return String(state.state);
  }

  // ============================================================
  // ROW MANAGEMENT
  // ============================================================

  upsertRow(incoming, preferIncoming = true, persist = true) {
    const index = this.rows.findIndex((row) =>
      this.sameMessageId(row.messageId, incoming.messageId)
    );

    if (index === -1) {
      this.rows.push(incoming);

      this.sortAndTrimRows();

      if (persist) {
        this.saveLocalRows();
      }

      return;
    }

    const existing = this.rows[index];

    /*
     * When adding a new column, Recorder may later provide
     * values missing from the local row.
     *
     * Avoid replacing useful values with —.
     */

    const mergedValues = {
      ...existing.values,
    };

    for (const [entityId, value] of Object.entries(incoming.values ?? {})) {
      const existingValue = mergedValues[entityId];

      if (
        value === '—' &&
        existingValue !== undefined &&
        existingValue !== '—'
      ) {
        continue;
      }

      if (
        preferIncoming ||
        existingValue === undefined ||
        existingValue === '—'
      ) {
        mergedValues[entityId] = value;
      }
    }

    this.rows[index] = {
      ...existing,

      ...incoming,

      values: mergedValues,

      source:
        existing.source === 'live' || incoming.source === 'live'
          ? 'live'
          : existing.source === 'recorder' || incoming.source === 'recorder'
            ? 'recorder'
            : 'local',

      timestamp: Math.max(
        Number(existing.timestamp) || 0,

        Number(incoming.timestamp) || 0
      ),
    };

    this.sortAndTrimRows();

    if (persist) {
      this.saveLocalRows();
    }
  }

  sortAndTrimRows() {
    this.rows.sort(
      (a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0)
    );

    const maxRows = Math.max(1, Number(this._config.max_rows) || 50);

    if (this.rows.length > maxRows) {
      this.rows.length = maxRows;
    }
  }

  // ============================================================
  // VALUES
  // ============================================================

  isUnavailableState(value) {
    const normalized = String(value ?? '')
      .trim()
      .toLowerCase();

    return (
      normalized === '' ||
      normalized === 'unknown' ||
      normalized === 'unavailable'
    );
  }

  formatEntityValue(state) {
    if (!state) {
      return '—';
    }

    if (this.isUnavailableState(state.state)) {
      return '—';
    }

    const unit = state.attributes?.unit_of_measurement;

    if (unit) {
      return `${state.state} ${unit}`;
    }

    return String(state.state);
  }

  getEntityName(config) {
    if (config.name && String(config.name).trim()) {
      return String(config.name).trim();
    }

    const state = this._hass?.states?.[config.entity];

    const friendlyName = state?.attributes?.friendly_name;

    if (friendlyName) {
      return friendlyName;
    }

    const raw = config.entity.split('.').slice(1).join('.');

    return raw
      .replaceAll('_', ' ')
      .replace(/\b\w/g, (character) => character.toUpperCase());
  }

  // ============================================================
  // HTML
  // ============================================================

  escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  // ============================================================
  // TABLE
  // ============================================================

  renderHeader() {
    return this.configuredEntities
      .map((config) => {
        const fontSize = this.normalizeFontSize(config.font_size);

        return `
            <th
              title="${this.escapeHtml(config.entity)}"
              style="
                font-size:
                  ${fontSize}px;
              "
            >
              ${this.escapeHtml(this.getEntityName(config))}
            </th>
          `;
      })
      .join('');
  }

  renderRows() {
    const entities = this.configuredEntities;

    if (this.rows.length === 0) {
      let message = 'Waiting for new MSS messages...';

      if (this._historyLoading) {
        message = 'Loading Recorder history...';
      } else if (this._historyError) {
        message = 'Recorder history could not be loaded.';
      }

      return `
        <tr>

          <td
            class="empty"
            colspan="${entities.length}"
          >
            ${this.escapeHtml(message)}
          </td>

        </tr>
      `;
    }

    return this.rows
      .map(
        (row) => `
          <tr>

            ${entities
              .map((config) => {
                const value = row.values[config.entity] ?? '—';

                const fontSize = this.normalizeFontSize(config.font_size);

                return `
                    <td
                      title="${this.escapeHtml(value)}"
                      style="
                        font-size:
                          ${fontSize}px;
                      "
                    >
                      ${this.escapeHtml(value)}
                    </td>
                  `;
              })
              .join('')}

          </tr>
        `
      )
      .join('');
  }

  // ============================================================
  // RENDER CARD
  // ============================================================

  render() {
    if (!this.shadowRoot) {
      return;
    }

    const entities = this.configuredEntities;

    this.shadowRoot.innerHTML = `
      <ha-card>

        <div
          class="card-root"
        >

          <header
            class="card-header"
          >

            <div
              class="title-area"
            >

              <h2>
                ${this.escapeHtml(this._config.title ?? 'MSS Measurements')}
              </h2>


              <p>

                ${entities.length}

                ${entities.length === 1 ? 'entity' : 'entities'}

                selected

                ${
                  this._config.history_mode === 'recorder'
                    ? ` · ${this._config.history_hours}h history`
                    : ' · session only'
                }

              </p>

            </div>


            <div
              class="header-right"
            >

              ${
                this._historyLoading
                  ? `
                    <span
                      class="history-status"
                    >
                      Loading history…
                    </span>
                  `
                  : ''
              }


              <div
                class="measurement-count"
              >

                <strong>
                  ${this.rows.length}
                </strong>

                <span>
                  ${this.rows.length === 1 ? 'measurement' : 'measurements'}
                </span>

              </div>

            </div>

          </header>


          ${
            entities.length === 0
              ? `
                <div
                  class="configuration-empty"
                >

                  <strong>
                    No entities configured
                  </strong>

                  <span>
                    Select between 1 and 6 Home Assistant entities.
                  </span>

                </div>
              `
              : `
                <div
                  class="table-scroll"
                >

                  <table>

                    <thead>
                      <tr>
                        ${this.renderHeader()}
                      </tr>
                    </thead>

                    <tbody>
                      ${this.renderRows()}
                    </tbody>

                  </table>

                </div>
              `
          }

        </div>

      </ha-card>


      <style>

        :host {
          display:
            block;

          height:
            100%;

          --mss-primary:
            #00a586;

          --mss-border:
            var(
              --divider-color,
              rgba(
                127,
                127,
                127,
                0.22
              )
            );

          --mss-soft:
            var(
              --secondary-background-color,
              rgba(
                127,
                127,
                127,
                0.08
              )
            );

          --mss-text:
            var(
              --primary-text-color,
              #111827
            );

          --mss-muted:
            var(
              --secondary-text-color,
              #6b7280
            );
        }


        ha-card {
          height:
            100%;

          overflow:
            hidden;
        }


        .card-root {
          display:
            flex;

          flex-direction:
            column;

          box-sizing:
            border-box;

          width:
            100%;

          height:
            100%;

          min-width:
            0;

          min-height:
            0;
        }


        .card-header {
          display:
            flex;

          align-items:
            center;

          justify-content:
            space-between;

          gap:
            16px;

          flex-shrink:
            0;

          padding:
            14px
            16px
            12px;

          border-bottom:
            1px solid
            var(--mss-border);
        }


        .title-area {
          min-width:
            0;
        }


        .title-area h2 {
          margin:
            0;

          color:
            var(--mss-text);

          font-size:
            18px;

          line-height:
            1.2;
        }


        .title-area p {
          margin:
            4px
            0
            0;

          color:
            var(--mss-muted);

          font-size:
            11px;
        }


        .header-right {
          display:
            flex;

          align-items:
            center;

          gap:
            10px;

          flex-shrink:
            0;
        }


        .history-status {
          color:
            var(--mss-muted);

          font-size:
            10px;
        }


        .measurement-count {
          display:
            flex;

          align-items:
            baseline;

          gap:
            5px;
        }


        .measurement-count strong {
          color:
            var(--mss-primary);

          font-size:
            18px;

          font-weight:
            700;
        }


        .measurement-count span {
          color:
            var(--mss-muted);

          font-size:
            11px;
        }


        .table-scroll {
          flex:
            1;

          width:
            100%;

          min-width:
            0;

          min-height:
            0;

          overflow:
            auto;
        }


        table {
          width:
            100%;

          min-width:
            100%;

          table-layout:
            fixed;

          border-collapse:
            collapse;
        }


        th,
        td {
          box-sizing:
            border-box;

          padding:
            9px
            10px;

          border-right:
            1px solid
            var(--mss-border);

          border-bottom:
            1px solid
            var(--mss-border);

          overflow:
            hidden;

          text-overflow:
            ellipsis;

          white-space:
            nowrap;

          text-align:
            left;

          vertical-align:
            middle;
        }


        th:last-child,
        td:last-child {
          border-right:
            none;
        }


        th {
          position:
            sticky;

          top:
            0;

          z-index:
            2;

          background:
            var(--mss-soft);

          color:
            var(--mss-primary);

          font-weight:
            700;
        }


        td {
          color:
            var(--mss-text);
        }


        tbody tr:hover td {
          background:
            color-mix(
              in srgb,
              var(--mss-primary)
                7%,
              transparent
            );
        }


        .empty {
          height:
            80px;

          color:
            var(--mss-muted);

          text-align:
            center;

          white-space:
            normal;

          font-size:
            12px !important;
        }


        .configuration-empty {
          display:
            flex;

          flex:
            1;

          flex-direction:
            column;

          align-items:
            center;

          justify-content:
            center;

          gap:
            5px;

          min-height:
            120px;

          padding:
            20px;

          text-align:
            center;
        }


        .configuration-empty strong {
          color:
            var(--mss-text);

          font-size:
            14px;
        }


        .configuration-empty span {
          color:
            var(--mss-muted);

          font-size:
            12px;
        }

      </style>
    `;
  }

  // ============================================================
  // GRID
  // ============================================================

  getCardSize() {
    return 5;
  }

  getGridOptions() {
    return {
      columns: 20,

      rows: 6,

      min_columns: 6,

      min_rows: 3,

      max_columns: 20,

      max_rows: 12,
    };
  }
}

// ============================================================
// MSS MEASUREMENTS CARD EDITOR
// ============================================================

class MSSMeasurementsCardEditor extends HTMLElement {
  constructor() {
    super();

    this._hass = null;

    this._generatedStorageId = null;

    this._config = {
      type: 'custom:mss-measurements-card',

      title: 'MSS Measurements',

      // ======================================================
      // MSS SOURCE
      // ======================================================

      mss_group: '',

      // ======================================================
      // TABLE COLUMNS
      // ======================================================

      entities: [],

      // ======================================================
      // TABLE SETTINGS
      // ======================================================

      max_rows: 50,

      history_mode: 'recorder',

      history_hours: 24,

      storage_id: '',
    };
  }

  // ============================================================
  // HASS
  // ============================================================

  set hass(hass) {
    this._hass = hass;

    /*
     * Legacy cards do not yet have mss_group.
     *
     * If one of their existing entities belongs to MSS,
     * automatically determine its source.
     */

    if (!this._config.mss_group) {
      const inferredGroup = this.inferConfiguredMssGroup();

      if (inferredGroup) {
        this._config = {
          ...this._config,

          mss_group: inferredGroup,
        };
      }
    }

    this.render();
  }

  // ============================================================
  // CONFIG
  // ============================================================

  setConfig(config) {
    const storageId =
      config?.storage_id ||
      this._generatedStorageId ||
      createMssMeasurementsStorageId();

    this._generatedStorageId = storageId;

    this._config = {
      ...config,

      type: config?.type ?? 'custom:mss-measurements-card',

      title: config?.title ?? 'MSS Measurements',

      mss_group: config?.mss_group ?? '',

      entities: this.normalizeEntities(config?.entities ?? []),

      max_rows: Math.max(1, Number(config?.max_rows) || 50),

      history_mode: config?.history_mode === 'session' ? 'session' : 'recorder',

      history_hours: this.normalizeHistoryHours(config?.history_hours),

      storage_id: storageId,
    };

    /*
     * Legacy migration.
     */

    if (!this._config.mss_group) {
      const inferredGroup = this.inferConfiguredMssGroup();

      if (inferredGroup) {
        this._config.mss_group = inferredGroup;
      }
    }

    this.render();
  }

  // ============================================================
  // NORMALIZATION
  // ============================================================

  normalizeFontSize(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
      return 12;
    }

    return Math.max(8, Math.min(32, Math.round(number)));
  }

  normalizeHistoryHours(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
      return 24;
    }

    return Math.max(1, Math.min(8760, Math.round(number)));
  }

  normalizeEntities(entities) {
    if (!Array.isArray(entities)) {
      return [];
    }

    return entities
      .map((entry) => {
        // ==================================================
        // LEGACY STRING
        // ==================================================

        if (typeof entry === 'string') {
          return {
            entity: entry,

            data_path: '',

            name: '',

            font_size: 12,
          };
        }

        // ==================================================
        // OBJECT CONFIG
        // ==================================================

        return {
          entity: entry?.entity ?? '',

          data_path: entry?.data_path ?? '',

          name: entry?.name ?? '',

          font_size: this.normalizeFontSize(entry?.font_size),
        };
      })
      .filter(
        (entry) => entry && (entry.entity || entry.data_path || entry.name)
      )
      .slice(0, 6);
  }

  // ============================================================
  // CONFIG EVENT
  // ============================================================

  fireConfigChanged() {
    const entities = (this._config.entities ?? [])
      .filter((entry) => entry?.entity && String(entry.entity).trim())
      .slice(0, 6)
      .map((entry) => {
        const result = {
          entity: entry.entity,

          font_size: this.normalizeFontSize(entry.font_size),
        };

        // ================================================
        // MSS SOURCE PATH
        // ================================================

        if (entry.data_path && String(entry.data_path).trim()) {
          result.data_path = String(entry.data_path).trim();
        }

        // ================================================
        // CUSTOM COLUMN LABEL
        // ================================================

        if (entry.name && String(entry.name).trim()) {
          result.name = String(entry.name).trim();
        }

        return result;
      });

    const config = {
      ...this._config,

      type: this._config.type ?? 'custom:mss-measurements-card',

      title: this._config.title ?? 'MSS Measurements',

      mss_group: this._config.mss_group ?? '',

      entities,

      max_rows: Math.max(1, Number(this._config.max_rows) || 50),

      history_mode:
        this._config.history_mode === 'session' ? 'session' : 'recorder',

      history_hours: this.normalizeHistoryHours(this._config.history_hours),

      storage_id:
        this._config.storage_id ||
        this._generatedStorageId ||
        createMssMeasurementsStorageId(),
    };

    /*
     * Old configuration property.
     */

    delete config.trigger_entity;

    this.dispatchEvent(
      new CustomEvent('config-changed', {
        detail: {
          config,
        },

        bubbles: true,

        composed: true,
      })
    );
  }

  // ============================================================
  // MSS STATE GROUP
  // ============================================================

  getMssStateGroup(state) {
    const attributes = state?.attributes ?? {};

    // ========================================================
    // PREFERRED MSS METADATA
    // ========================================================

    if (attributes.mss_group) {
      return String(attributes.mss_group);
    }

    // ========================================================
    // GENERIC FALLBACK
    // ========================================================

    if (attributes.mss_generic === true || attributes.mss_generic === 'true') {
      return 'MSSReport';
    }

    // ========================================================
    // CONTROL PLAN FALLBACK
    // ========================================================

    if (attributes.mss_control_plan) {
      return `MSSReport_${attributes.mss_control_plan}`;
    }

    return null;
  }

  // ============================================================
  // LEGACY SOURCE INFERENCE
  // ============================================================

  inferConfiguredMssGroup() {
    if (!this._hass?.states) {
      return '';
    }

    for (const config of this._config.entities ?? []) {
      if (!config?.entity) {
        continue;
      }

      const group = this.getMssStateGroup(this._hass.states?.[config.entity]);

      if (group) {
        return group;
      }
    }

    return '';
  }

  // ============================================================
  // AVAILABLE MSS SOURCES
  // ============================================================

  getAvailableMssGroups() {
    if (!this._hass?.states) {
      return [];
    }

    const groups = new Map();

    for (const state of Object.values(this._hass.states)) {
      const attributes = state?.attributes ?? {};

      /*
       * Every dynamic MSS entity contains this structural
       * metadata.
       */

      if (!attributes.mss_source_path) {
        continue;
      }

      const group = this.getMssStateGroup(state);

      if (!group) {
        continue;
      }

      if (groups.has(group)) {
        continue;
      }

      const controlPlan = attributes.mss_control_plan ?? null;

      const generic =
        group === 'MSSReport' ||
        attributes.mss_generic === true ||
        attributes.mss_generic === 'true';

      groups.set(group, {
        id: group,

        label: generic
          ? 'MSS Report'
          : controlPlan
            ? `MSS Report - ${controlPlan}`
            : this.formatMssGroupLabel(group),

        controlPlan,

        generic,
      });
    }

    return Array.from(groups.values()).sort((a, b) => {
      // Generic report first.

      if (a.generic && !b.generic) {
        return -1;
      }

      if (b.generic && !a.generic) {
        return 1;
      }

      return a.label.localeCompare(b.label);
    });
  }

  // ============================================================
  // MSS SOURCE LABEL
  // ============================================================

  formatMssGroupLabel(group) {
    if (!group) {
      return 'MSS Report';
    }

    if (group === 'MSSReport') {
      return 'MSS Report';
    }

    if (group.startsWith('MSSReport_')) {
      return 'MSS Report - ' + group.slice('MSSReport_'.length);
    }

    return String(group)
      .replace(/_/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  }

  // ============================================================
  // MSS DATA FIELD OPTIONS
  // ============================================================

  getMssDataFieldOptions() {
    if (!this._hass?.states || !this._config.mss_group) {
      return [];
    }

    const selectedGroup = this._config.mss_group;

    const options = [];

    for (const [entityId, state] of Object.entries(this._hass.states)) {
      const attributes = state?.attributes ?? {};

      const entityGroup = this.getMssStateGroup(state);

      if (entityGroup !== selectedGroup) {
        continue;
      }

      const sourcePath = attributes.mss_source_path;

      if (!sourcePath) {
        continue;
      }

      const labelParts = this.createMssDataFieldLabelParts(sourcePath, state);

      if (labelParts.length === 0) {
        continue;
      }

      options.push({
        entityId,

        path: sourcePath,

        label: labelParts.join(' › '),

        group: labelParts[0] ?? 'Other',
      });
    }

    // ========================================================
    // REMOVE DUPLICATES
    // ========================================================

    const unique = new Map();

    for (const option of options) {
      if (!unique.has(option.entityId)) {
        unique.set(option.entityId, option);
      }
    }

    return Array.from(unique.values()).sort((a, b) => {
      const groupCompare = a.group.localeCompare(b.group);

      if (groupCompare !== 0) {
        return groupCompare;
      }

      return a.label.localeCompare(b.label);
    });
  }

  // ============================================================
  // GROUP MSS FIELDS
  // ============================================================

  getGroupedMssDataFields() {
    const groups = new Map();

    for (const option of this.getMssDataFieldOptions()) {
      if (!groups.has(option.group)) {
        groups.set(option.group, []);
      }

      groups.get(option.group).push(option);
    }

    return Array.from(groups.entries()).map(([name, options]) => ({
      name,
      options,
    }));
  }

  // ============================================================
  // CREATE FIELD LABEL
  // ============================================================

  createMssDataFieldLabelParts(sourcePath, state = null) {
    if (!sourcePath) {
      return [];
    }

    const controlPlan = state?.attributes?.mss_control_plan ?? null;

    return String(sourcePath)
      .split('.')
      .filter(Boolean)
      .filter((part) => part.toLowerCase() !== 'rootnode')
      .map((part) => this.formatMssFieldLabel(part, controlPlan));
  }

  // ============================================================
  // FORMAT FIELD LABEL
  // ============================================================

  formatMssFieldLabel(key, controlPlan = null) {
    if (key === '#text') {
      return 'Value';
    }

    if (key === '@Unit') {
      return 'Unit';
    }

    let displayKey = String(key);

    // ========================================================
    // REMOVE CURRENT CONTROL PLAN SUFFIX
    // ========================================================

    if (controlPlan) {
      const suffix = `_${controlPlan}`;

      if (displayKey.toLowerCase().endsWith(suffix.toLowerCase())) {
        displayKey = displayKey.slice(0, -suffix.length);
      }
    }

    // ========================================================
    // FRIENDLY NAMES
    // ========================================================

    const knownLabels = {
      ProductId: 'Product ID',

      StationId: 'Station ID',

      ControlPlan: 'Control Plan',

      SerialNumber: 'Serial Number',

      SystemHealthPC: 'System Health PC',

      SystemHealthMSS: 'System Health MSS',

      ControlPlanOverview: 'Control Plan Overview',

      LastMeasurement: 'Last Measurement',

      StatisticsEvaluation: 'Statistics Evaluation',

      Identification: 'Identification',
    };

    if (knownLabels[displayKey]) {
      return knownLabels[displayKey];
    }

    // ========================================================
    // GENERIC FALLBACK
    // ========================================================

    return displayKey
      .replace(/__/g, ' ')
      .replace(/_/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ============================================================
  // COLUMN EXISTS
  // ============================================================

  isEntitySelected(entityId) {
    return (this._config.entities ?? []).some(
      (entry) => entry?.entity === entityId
    );
  }

  // ============================================================
  // ADD MSS FIELD
  // ============================================================

  addMssField(option) {
    if (!option?.entityId) {
      return;
    }

    if (this.isEntitySelected(option.entityId)) {
      return;
    }

    const entities = [...(this._config.entities ?? [])];

    if (entities.length >= 6) {
      return;
    }

    entities.push({
      entity: option.entityId,

      data_path: option.path ?? '',

      name: '',

      font_size: 12,
    });

    this._config = {
      ...this._config,

      entities,
    };

    this.fireConfigChanged();

    this.render();
  }

  // ============================================================
  // REMOVE FIELD
  // ============================================================

  removeEntity(index) {
    const entities = [...(this._config.entities ?? [])];

    entities.splice(index, 1);

    this._config = {
      ...this._config,

      entities,
    };

    this.fireConfigChanged();

    this.render();
  }

  // ============================================================
  // UPDATE COLUMN NAME
  // ============================================================

  updateEntityName(index, name) {
    const entities = [...(this._config.entities ?? [])];

    entities[index] = {
      ...(entities[index] ?? {}),

      name: name ?? '',
    };

    this._config = {
      ...this._config,

      entities,
    };

    this.fireConfigChanged();
  }

  // ============================================================
  // UPDATE FONT SIZE
  // ============================================================

  updateEntityFontSize(index, fontSize) {
    const entities = [...(this._config.entities ?? [])];

    entities[index] = {
      ...(entities[index] ?? {}),

      font_size: this.normalizeFontSize(fontSize),
    };

    this._config = {
      ...this._config,

      entities,
    };

    this.fireConfigChanged();
  }

  // ============================================================
  // CHANGE MSS SOURCE
  // ============================================================

  changeMssGroup(group) {
    const normalizedGroup = group ?? '';

    if (normalizedGroup === this._config.mss_group) {
      return;
    }

    /*
     * Columns belong to one source.
     *
     * We clear the previous columns so a Test1 entity cannot
     * accidentally remain configured in a Test2 table.
     */

    this._config = {
      ...this._config,

      mss_group: normalizedGroup,

      entities: [],
    };

    this.fireConfigChanged();

    this.render();
  }

  // ============================================================
  // HTML ESCAPE
  // ============================================================

  escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  // ============================================================
  // DISABLE HA SHORTCUTS WHILE TYPING
  // ============================================================

  stopKeyboardShortcuts(input) {
    if (!input) {
      return;
    }

    input.onkeydown = (event) => {
      event.stopPropagation();

      if (event.key === 'Enter') {
        input.blur();
      }
    };

    input.onkeyup = (event) => {
      event.stopPropagation();
    };

    input.onkeypress = (event) => {
      event.stopPropagation();
    };
  }

  // ============================================================
  // SEARCH NORMALIZATION
  // ============================================================

  normalizeSearchText(value) {
    return String(value ?? '')
      .toLowerCase()
      .replace(/[_./\\›\-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ============================================================
  // SELECTED FIELD DESCRIPTION
  // ============================================================

  getConfiguredEntityDescription(config) {
    if (!config?.entity) {
      return '';
    }

    const state = this._hass?.states?.[config.entity];

    const sourcePath =
      config.data_path || state?.attributes?.mss_source_path || '';

    if (sourcePath) {
      return sourcePath;
    }

    return config.entity;
  }

  // ============================================================
  // RENDER
  // ============================================================

  render() {
    const entities = Array.isArray(this._config.entities)
      ? this._config.entities
      : [];

    const recorderMode = this._config.history_mode !== 'session';

    const groups = this.getAvailableMssGroups();

    const selectedGroup = this._config.mss_group ?? '';

    const groupedFields = this.getGroupedMssDataFields();

    this.innerHTML = `

      <div
        class="mss-measurements-editor"
      >


        <!-- ==================================================
             TITLE
             ================================================== -->

        <label
          class="editor-field"
        >

          <span
            class="editor-label"
          >
            Title
          </span>


          <input
            id="mssTableTitle"

            type="text"

            autocomplete="off"

            spellcheck="false"

            value="${this.escapeHtml(this._config.title ?? '')}"
          >

        </label>


        <!-- ==================================================
             MSS SOURCE
             ================================================== -->

        <label
          class="editor-field"
        >

          <span
            class="editor-label"
          >
            MSS source
          </span>


          <span
            class="editor-description"
          >
            Choose the generic MSS Report or a specific control plan.
          </span>


          <select
            id="mssTableSource"
          >

            <option
              value=""
            >
              Select MSS source...
            </option>


            ${groups
              .map(
                (group) => `

                  <option

                    value="${this.escapeHtml(group.id)}"

                    ${group.id === selectedGroup ? 'selected' : ''}

                  >

                    ${this.escapeHtml(group.label)}

                  </option>

                `
              )
              .join('')}

          </select>

        </label>


        <!-- ==================================================
             FIELD PICKER
             ================================================== -->

        <div
          class="field-picker-section"
        >


          <div
            class="entities-header"
          >


            <div>

              <span
                class="editor-label"
              >
                Add data field
              </span>


              <span
                class="editor-description"
              >
                Select up to 6 fields from the chosen MSS source.
              </span>

            </div>


            <span
              class="column-count"
            >
              ${entities.length}/6
            </span>


          </div>


          ${
            !selectedGroup
              ? `

                <div
                  class="field-picker-empty"
                >
                  Select an MSS source first.
                </div>

              `
              : `

                <input

                  id="mssFieldSearch"

                  class="field-search"

                  type="text"

                  autocomplete="off"

                  spellcheck="false"

                  placeholder="Search data fields..."

                >


                <div
                  id="mssFieldList"

                  class="mss-data-field-list"
                >


                  ${
                    groupedFields.length === 0
                      ? `

                        <div
                          class="field-picker-empty"
                        >
                          No MSS fields found for this source.
                        </div>

                      `
                      : groupedFields
                          .map(
                            (group) => `

                              <div

                                class="
                                  mss-data-field-group
                                "

                                data-data-group

                              >


                                <div
                                  class="
                                    mss-data-field-group-title
                                  "
                                >

                                  ${this.escapeHtml(group.name)}

                                </div>


                                ${group.options
                                  .map((option) => {
                                    const selected = this.isEntitySelected(
                                      option.entityId
                                    );

                                    return `

                                        <button

                                          class="
                                            mss-data-field-option

                                            ${selected ? 'selected' : ''}
                                          "


                                          data-data-entity="${this.escapeHtml(
                                            option.entityId
                                          )}"


                                          data-data-path="${this.escapeHtml(
                                            option.path
                                          )}"


                                          data-data-label="${this.escapeHtml(
                                            [
                                              option.label,

                                              option.path,

                                              option.entityId,
                                            ]
                                              .filter(Boolean)
                                              .join(' ')
                                              .toLowerCase()
                                          )}"


                                          title="${this.escapeHtml(
                                            option.path
                                          )}"


                                          type="button"


                                          ${
                                            selected || entities.length >= 6
                                              ? 'disabled'
                                              : ''
                                          }

                                        >


                                          <span
                                            class="
                                              mss-data-field-option-label
                                            "
                                          >

                                            ${this.escapeHtml(
                                              option.label
                                                .split(' › ')
                                                .slice(1)
                                                .join(' › ') || option.label
                                            )}

                                          </span>


                                          ${
                                            selected
                                              ? `

                                                <span
                                                  class="
                                                    field-selected-badge
                                                  "
                                                >
                                                  Added
                                                </span>

                                              `
                                              : ''
                                          }


                                        </button>

                                      `;
                                  })
                                  .join('')}


                              </div>

                            `
                          )
                          .join('')
                  }


                </div>

              `
          }


        </div>


        <!-- ==================================================
             SELECTED COLUMNS
             ================================================== -->

        <div
          class="selected-columns-section"
        >


          <div
            class="entities-header"
          >


            <div>

              <span
                class="editor-label"
              >
                Table columns
              </span>


              <span
                class="editor-description"
              >
                Rename each column and choose its text size.
              </span>

            </div>


          </div>


          <div
            id="mssEntityList"

            class="entity-list"
          >


            ${
              entities.length === 0
                ? `

                  <div
                    class="selected-columns-empty"
                  >
                    No data fields selected.
                  </div>

                `
                : entities
                    .map(
                      (config, index) => `

                        <div

                          class="
                            entity-row
                          "

                          data-entity-index="${index}"

                        >


                          <div
                            class="
                              selected-field-info
                            "
                          >


                            <strong>

                              ${this.escapeHtml(
                                this._hass?.states?.[config.entity]?.attributes
                                  ?.friendly_name ?? config.entity
                              )}

                            </strong>


                            <span

                              title="${this.escapeHtml(
                                this.getConfiguredEntityDescription(config)
                              )}"

                            >

                              ${this.escapeHtml(
                                this.getConfiguredEntityDescription(config)
                              )}

                            </span>


                          </div>


                          <input

                            class="
                              entity-name
                            "

                            data-column-name="${index}"

                            type="text"

                            autocomplete="off"

                            spellcheck="false"

                            placeholder="
                              Column name
                            "

                            value="${this.escapeHtml(config.name ?? '')}"

                          >


                          <div
                            class="
                              font-size-wrapper
                            "
                          >


                            <input

                              class="
                                font-size-input
                              "

                              data-column-font="${index}"

                              type="number"

                              min="8"

                              max="32"

                              step="1"

                              value="${this.normalizeFontSize(
                                config.font_size
                              )}"

                            >


                            <span
                              class="
                                font-size-unit
                              "
                            >
                              px
                            </span>


                          </div>


                          <button

                            class="
                              entity-remove
                            "

                            data-column-remove="${index}"

                            type="button"

                            title="
                              Remove field
                            "

                          >
                            ×
                          </button>


                        </div>

                      `
                    )
                    .join('')
            }


          </div>


        </div>


        <!-- ==================================================
             HISTORY
             ================================================== -->

        <label
          class="editor-field"
        >


          <span
            class="editor-label"
          >
            History
          </span>


          <select
            id="mssHistoryMode"
          >


            <option

              value="
                recorder
              "

              ${recorderMode ? 'selected' : ''}

            >
              Recorder
            </option>


            <option

              value="
                session
              "

              ${!recorderMode ? 'selected' : ''}

            >
              Session only
            </option>


          </select>


        </label>


        ${
          recorderMode
            ? `

              <label
                class="
                  editor-field
                "
              >


                <span
                  class="
                    editor-label
                  "
                >
                  History period
                </span>


                <div
                  class="
                    history-hours-wrapper
                  "
                >


                  <input

                    id="
                      mssHistoryHours
                    "

                    type="
                      number
                    "

                    min="
                      1
                    "

                    max="
                      8760
                    "

                    value="${Number(this._config.history_hours) || 24}"

                  >


                  <span>
                    hours
                  </span>


                </div>


              </label>

            `
            : ''
        }


        <!-- ==================================================
             MAX ROWS
             ================================================== -->

        <label
          class="
            editor-field
          "
        >


          <span
            class="
              editor-label
            "
          >
            Maximum measurements
          </span>


          <input

            id="
              mssMaxRows
            "

            type="
              number
            "

            min="
              1
            "

            max="
              500
            "

            value="${Number(this._config.max_rows) || 50}"

          >


        </label>


      </div>


      <style>


        .mss-measurements-editor {

          display:
            flex;


          flex-direction:
            column;


          gap:
            18px;


          width:
            100%;


          box-sizing:
            border-box;

        }


        .editor-field {

          display:
            flex;


          flex-direction:
            column;


          gap:
            6px;

        }


        .editor-label {

          display:
            block;


          color:
            var(
              --primary-text-color
            );


          font-size:
            13px;


          font-weight:
            600;

        }


        .editor-description {

          display:
            block;


          color:
            var(
              --secondary-text-color
            );


          font-size:
            11px;


          line-height:
            1.4;

        }


        .entities-header {

          display:
            flex;


          align-items:
            center;


          justify-content:
            space-between;


          gap:
            12px;

        }


        .entities-header > div {

          display:
            flex;


          flex-direction:
            column;


          gap:
            3px;

        }


        .column-count {

          flex-shrink:
            0;


          color:
            var(
              --secondary-text-color
            );


          font-size:
            11px;


          font-weight:
            600;

        }


        .field-picker-section,
        .selected-columns-section {

          display:
            flex;


          flex-direction:
            column;


          gap:
            10px;

        }


        .field-search {

          width:
            100%;

        }


        .mss-data-field-list {

          display:
            flex;


          flex-direction:
            column;


          gap:
            4px;


          max-height:
            360px;


          padding-right:
            4px;


          overflow-y:
            auto;


          overflow-x:
            hidden;


          scrollbar-width:
            thin;

        }


        .mss-data-field-group {

          display:
            flex;


          flex-direction:
            column;


          gap:
            3px;

        }


        .mss-data-field-group
        + .mss-data-field-group {

          margin-top:
            12px;

        }


        .mss-data-field-group-title {

          position:
            sticky;


          top:
            0;


          z-index:
            2;


          padding:
            7px
            9px;


          color:
            var(
              --primary-color,
              #00a586
            );


          background:
            var(
              --card-background-color
            );


          border-bottom:
            1px solid
            var(
              --divider-color
            );


          font-size:
            10px;


          font-weight:
            800;


          text-transform:
            uppercase;


          letter-spacing:
            0.05em;

        }


        .mss-data-field-option {

          display:
            flex;


          align-items:
            center;


          justify-content:
            space-between;


          gap:
            10px;


          width:
            100%;


          min-height:
            36px;


          box-sizing:
            border-box;


          padding:
            8px
            10px
            !important;


          color:
            var(
              --primary-text-color
            );


          background:
            transparent
            !important;


          border:
            1px solid
            transparent
            !important;


          border-radius:
            7px;


          font-size:
            12px;


          line-height:
            1.35;


          text-align:
            left;


          cursor:
            pointer;

        }


        .mss-data-field-option:hover:not(:disabled) {

          background:
            color-mix(
              in srgb,
              var(
                --primary-color,
                #00a586
              )
              8%,
              transparent
            )
            !important;

        }


        .mss-data-field-option.selected {

          border-color:
            var(
              --primary-color,
              #00a586
            )
            !important;


          background:
            color-mix(
              in srgb,
              var(
                --primary-color,
                #00a586
              )
              12%,
              transparent
            )
            !important;

        }


        .mss-data-field-option:disabled {

          opacity:
            0.65;


          cursor:
            default;

        }


        .mss-data-field-option-label {

          display:
            block;


          min-width:
            0;


          white-space:
            normal;


          overflow-wrap:
            anywhere;

        }


        .field-selected-badge {

          flex-shrink:
            0;


          color:
            var(
              --primary-color,
              #00a586
            );


          font-size:
            10px;


          font-weight:
            700;

        }


        .field-picker-empty,
        .selected-columns-empty {

          padding:
            13px
            10px;


          color:
            var(
              --secondary-text-color
            );


          border:
            1px dashed
            var(
              --divider-color
            );


          border-radius:
            8px;


          font-size:
            11px;


          text-align:
            center;

        }


        .entity-list {

          display:
            flex;


          flex-direction:
            column;


          gap:
            12px;

        }


        .entity-row {

          display:
            grid;


          grid-template-columns:
            minmax(
              0,
              1fr
            )
            82px
            36px;


          align-items:
            center;


          gap:
            8px;


          padding-bottom:
            10px;


          border-bottom:
            1px solid
            var(
              --divider-color
            );

        }


        .selected-field-info {

          grid-column:
            1 / -1;


          display:
            flex;


          flex-direction:
            column;


          gap:
            3px;


          min-width:
            0;

        }


        .selected-field-info strong {

          color:
            var(
              --primary-text-color
            );


          font-size:
            12px;


          overflow-wrap:
            anywhere;

        }


        .selected-field-info span {

          color:
            var(
              --secondary-text-color
            );


          font-family:
            var(
              --code-font-family,
              monospace
            );


          font-size:
            9px;


          line-height:
            1.35;


          overflow-wrap:
            anywhere;

        }


        .entity-name {

          min-width:
            0;

        }


        .font-size-wrapper,
        .history-hours-wrapper {

          position:
            relative;


          min-width:
            0;

        }


        .font-size-input {

          padding-right:
            26px
            !important;

        }


        .font-size-unit {

          position:
            absolute;


          top:
            50%;


          right:
            9px;


          transform:
            translateY(
              -50%
            );


          color:
            var(
              --secondary-text-color
            );


          font-size:
            11px;


          pointer-events:
            none;

        }


        .history-hours-wrapper {

          display:
            flex;


          align-items:
            center;


          gap:
            8px;

        }


        .history-hours-wrapper input {

          max-width:
            120px;

        }


        .history-hours-wrapper span {

          color:
            var(
              --secondary-text-color
            );


          font-size:
            12px;

        }


        .mss-measurements-editor input,
        .mss-measurements-editor select {

          width:
            100%;


          min-width:
            0;


          box-sizing:
            border-box;


          padding:
            10px
            11px;


          border:
            1px solid
            var(
              --divider-color
            );


          border-radius:
            8px;


          color:
            var(
              --primary-text-color
            );


          background:
            var(
              --card-background-color
            );


          outline:
            none;

        }


        .mss-measurements-editor input:focus,
        .mss-measurements-editor select:focus {

          border-color:
            var(
              --primary-color
            );

        }


        .mss-measurements-editor button {

          min-height:
            36px;


          padding:
            7px
            11px;


          border:
            1px solid
            var(
              --divider-color
            );


          border-radius:
            8px;


          color:
            var(
              --primary-text-color
            );


          background:
            var(
              --secondary-background-color
            );


          cursor:
            pointer;

        }


        .mss-measurements-editor button:disabled {

          opacity:
            0.5;

        }


        .entity-remove {

          padding:
            0
            !important;


          font-size:
            18px;

        }


        @media (
          max-width:
          500px
        ) {

          .entity-row {

            grid-template-columns:
              minmax(
                0,
                1fr
              )
              70px
              36px;

          }

        }


      </style>
    `;

    // ==========================================================
    // TITLE EVENT
    // ==========================================================

    const title = this.querySelector('#mssTableTitle');

    if (title) {
      title.onchange = () => {
        this._config = {
          ...this._config,

          title: title.value,
        };

        this.fireConfigChanged();
      };

      this.stopKeyboardShortcuts(title);
    }

    // ==========================================================
    // MSS SOURCE EVENT
    // ==========================================================

    const source = this.querySelector('#mssTableSource');

    if (source) {
      source.onchange = () => {
        this.changeMssGroup(source.value);
      };
    }

    // ==========================================================
    // FIELD SEARCH
    // ==========================================================

    const search = this.querySelector('#mssFieldSearch');

    const fieldOptions = Array.from(
      this.querySelectorAll('.mss-data-field-option')
    );

    const fieldGroups = Array.from(this.querySelectorAll('[data-data-group]'));

    const updateFiltering = () => {
      const query = this.normalizeSearchText(search?.value);

      const tokens = query ? query.split(' ') : [];

      // ====================================================
      // FILTER INDIVIDUAL FIELDS
      // ====================================================

      fieldOptions.forEach((option) => {
        const searchable = this.normalizeSearchText(
          option.dataset.dataLabel ?? option.textContent ?? ''
        );

        const matches =
          tokens.length === 0 ||
          tokens.every((token) => searchable.includes(token));

        /*
         * Use style.display instead of hidden.
         *
         * HA CSS may override the default browser
         * [hidden] rule.
         */

        option.style.display = matches ? '' : 'none';
      });

      // ====================================================
      // FILTER GROUPS
      // ====================================================

      fieldGroups.forEach((group) => {
        const groupTitle = this.normalizeSearchText(
          group.querySelector('.mss-data-field-group-title')?.textContent
        );

        const groupOptions = Array.from(
          group.querySelectorAll('.mss-data-field-option')
        );

        const groupMatches =
          tokens.length > 0 &&
          tokens.every((token) => groupTitle.includes(token));

        /*
         * Searching the group name itself shows the whole
         * section.
         *
         * Example:
         *
         * "statistics"
         */

        if (groupMatches) {
          groupOptions.forEach((option) => {
            option.style.display = '';
          });

          group.style.display = '';

          return;
        }

        const hasVisibleOption = groupOptions.some(
          (option) => option.style.display !== 'none'
        );

        group.style.display = hasVisibleOption ? '' : 'none';
      });
    };

    if (search) {
      search.oninput = updateFiltering;

      this.stopKeyboardShortcuts(search);

      updateFiltering();
    }

    // ==========================================================
    // ADD MSS FIELD
    // ==========================================================

    fieldOptions.forEach((button) => {
      button.onclick = () => {
        if (button.disabled) {
          return;
        }

        const entityId = button.dataset.dataEntity ?? '';

        const path = button.dataset.dataPath ?? '';

        const option = this.getMssDataFieldOptions().find(
          (item) => item.entityId === entityId
        );

        if (!option) {
          return;
        }

        this.addMssField({
          ...option,

          path,
        });
      };
    });

    // ==========================================================
    // COLUMN NAME EVENTS
    // ==========================================================

    this.querySelectorAll('[data-column-name]').forEach((input) => {
      const index = Number(input.dataset.columnName);

      input.onchange = () => {
        this.updateEntityName(index, input.value);
      };

      this.stopKeyboardShortcuts(input);
    });

    // ==========================================================
    // FONT SIZE EVENTS
    // ==========================================================

    this.querySelectorAll('[data-column-font]').forEach((input) => {
      const index = Number(input.dataset.columnFont);

      input.onchange = () => {
        const value = this.normalizeFontSize(input.value);

        input.value = String(value);

        this.updateEntityFontSize(index, value);
      };

      this.stopKeyboardShortcuts(input);
    });

    // ==========================================================
    // REMOVE COLUMN EVENTS
    // ==========================================================

    this.querySelectorAll('[data-column-remove]').forEach((button) => {
      const index = Number(button.dataset.columnRemove);

      button.onclick = () => {
        this.removeEntity(index);
      };
    });

    // ==========================================================
    // HISTORY MODE EVENT
    // ==========================================================

    const historyMode = this.querySelector('#mssHistoryMode');

    if (historyMode) {
      historyMode.onchange = () => {
        this._config = {
          ...this._config,

          history_mode:
            historyMode.value === 'session' ? 'session' : 'recorder',
        };

        this.fireConfigChanged();

        this.render();
      };
    }

    // ==========================================================
    // HISTORY HOURS EVENT
    // ==========================================================

    const historyHours = this.querySelector('#mssHistoryHours');

    if (historyHours) {
      historyHours.onchange = () => {
        const value = this.normalizeHistoryHours(historyHours.value);

        historyHours.value = String(value);

        this._config = {
          ...this._config,

          history_hours: value,
        };

        this.fireConfigChanged();
      };

      this.stopKeyboardShortcuts(historyHours);
    }

    // ==========================================================
    // MAX ROWS EVENT
    // ==========================================================

    const maxRows = this.querySelector('#mssMaxRows');

    if (maxRows) {
      maxRows.onchange = () => {
        this._config = {
          ...this._config,

          max_rows: Math.max(1, Number(maxRows.value) || 50),
        };

        this.fireConfigChanged();
      };

      this.stopKeyboardShortcuts(maxRows);
    }
  }
}

// ============================================================
// REGISTRATION
// ============================================================

if (!customElements.get('mss-measurements-card')) {
  customElements.define('mss-measurements-card', MSSMeasurementsCard);
}

if (!customElements.get('mss-measurements-card-editor')) {
  customElements.define(
    'mss-measurements-card-editor',
    MSSMeasurementsCardEditor
  );
}

// ============================================================
// HOME ASSISTANT CARD PICKER
// ============================================================

window.customCards = window.customCards ?? [];

if (!window.customCards.some((card) => card.type === 'mss-measurements-card')) {
  window.customCards.push({
    type: 'mss-measurements-card',

    name: 'MSS Measurements Card',

    description:
      'Displays and restores MSSReport measurements using Home Assistant Recorder.',

    preview: true,
  });
}
