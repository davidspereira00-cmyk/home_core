import { overlayRenderMethods } from './mss-overlay-renderer.js';

import { defaultViews } from './mss-default-views.js';

import { viewRenderMethods } from './mss-view-renderer.js';

import { panelStyles } from './mss-panel-styles.js';

import { renderMssRoutingStatus } from './mss-routing-status.js';

import { hydrateMssViewImages } from './mss-value-decoder.js';

import {
  getLatestMssReportContext,
  resolveAutomaticView,
} from './mss-view-router.js';

import './mss-view-dialog.js';

import { mssIcon } from './mss-icons.js';

class MSSViewCard extends HTMLElement {
  constructor() {
    super();

    this.attachShadow({
      mode: 'open',
    });

    this._hass = null;
    this._config = {};
    // Keeps a reference to the currently open fullscreen Viewer.
    this.activeViewer = null;
    // Keeps a reference to an Editor opened directly from the card.
    this.activeEditor = null;

    this.selectedOverlay = null;
    this.selectedViewMeasurementIndex = 0;
    this.viewMeasurements = [];
    this.lastRoutingResult = null;
    this.view = {
      id: 'mss-card-test-view',
      name: 'MSS Test View',
      imageUrl: '/local/views/body.jpg',

      overlays: [
        {
          id: 'mss-card-overlay-product',
          name: 'Identification',
          pointerVisible: true,

          position: {
            x: 35,
            y: 30,
          },

          pointer: {
            x: 48,
            y: 43,
          },

          elements: [
            {
              id: 'mss-card-element-product',
              name: 'Product ID',
              path: 'sensor.mss_report_mss_product_id',
              fontSize: 14,
              elementType: 0,
            },

            {
              id: 'mss-card-element-station',
              name: 'Station ID',
              path: 'sensor.mss_report_mss_station_id',
              fontSize: 14,
              elementType: 0,
            },

            {
              id: 'mss-card-element-status',
              name: 'Station A',
              path: 'sensor.mss_report_mss_station_id',
              fontSize: 14,
              elementType: 1,
              operator: 'equals',
              compareValue: 'A',
              trueText: 'OK',
              falseText: 'NOK',
            },
          ],
        },
        {
          id: 'mss-card-overlay-status',
          name: 'Machine Status',
          pointerVisible: true,

          position: {
            x: 65,
            y: 55,
          },

          pointer: {
            x: 58,
            y: 48,
          },

          elements: [
            {
              id: 'mss-card-element-machine-status',
              name: 'Status',
              path: 'sensor.mss_report_mss_station_id',
              fontSize: 14,
              elementType: 0,
            },
          ],
        },
      ],
    };

    // Stores all Views available in the current browser session.
    this.views = [this.view];

    // Stores the currently selected View ID.
    this.selectedViewId = this.view.id;

    // Prevents browser storage from being loaded more than once.
    this.viewsLoadedFromStorage = false;

    // Last MQTT report already processed by automatic View routing.
    this.lastAutoRoutingMessageId = null;
  }

  setConfig(config) {
    if (!config) {
      throw new Error('MSS View Card configuration is required.');
    }

    this._config = {
      title: 'MSS View',
      ...config,
    };

    this.render();
  }

  set hass(hass) {
    this._hass = hass;
    // ==========================================================
    // LOAD VIEWS
    // ==========================================================

    if (!this.viewsLoadedFromStorage && this._hass?.connection) {
      this.loadViewsFromStorage().then(async () => {
        /*
         * Resolve automatic routing first so we know
         * which View actually needs to be displayed.
         */
        this.applyAutomaticViewRouting(true);

        const selected = this.selectedView;

        if (selected) {
          await hydrateMssViewImages(this._hass, selected);
        }

        if (!this.activeEditor && !this.activeViewer) {
          this.render();
        }
      });

      return;
    }

    // ==========================================================
    // EDITOR
    // ==========================================================

    if (this.activeEditor) {
      this.activeEditor.hass = hass;

      return;
    }

    // ==========================================================
    // FULLSCREEN VIEWER
    // ==========================================================
    //
    // The fullscreen Viewer owns routing while it is open.
    // ==========================================================

    if (this.activeViewer) {
      this.activeViewer.hass = hass;

      return;
    }

    // ==========================================================
    // DASHBOARD CARD ROUTING
    // ==========================================================

    // ==========================================================
    // DASHBOARD CARD ROUTING
    // ==========================================================

    this.applyAutomaticViewRouting();

    const selected = this.selectedView;

    if (selected) {
      hydrateMssViewImages(this._hass, selected).then(() => {
        if (!this.activeEditor && !this.activeViewer) {
          this.render();
        }
      });

      return;
    }

    this.render();
  }

  // Returns the currently selected measurement when measurement history is available.
  get selectedViewMeasurement() {
    return this.viewMeasurements[this.selectedViewMeasurementIndex] ?? null;
  }

  // Resolves an overlay path from a Home Assistant entity state.
  resolveMeasurementField(path) {
    if (!path) {
      return 'Unavailable';
    }

    return this._hass?.states?.[path]?.state ?? 'Unavailable';
  }

  // Evaluates the configured condition for a status overlay element.
  evaluateOverlayCondition(element) {
    const currentValue = this.resolveOverlayElementValue(element);
    const compareValue = element.compareValue ?? '';

    switch (element.operator) {
      case 'notEquals':
        return String(currentValue) !== String(compareValue);

      case 'greaterThan':
        return Number(currentValue) > Number(compareValue);

      case 'lessThan':
        return Number(currentValue) < Number(compareValue);

      case 'equals':
      default:
        return String(currentValue) === String(compareValue);
    }
  }

  // Renders a standard information row for shared Viewer compatibility.
  infoRow(label, value) {
    return `
      <div class="mss-info-row">
        <span>${label}</span>
        <strong>${value}</strong>
      </div>
    `;
  }
  // Returns the currently selected View.
  get selectedView() {
    return (
      this.views.find(
        (view) => String(view.id) === String(this.selectedViewId)
      ) ?? null
    );
  }

  // Loads Views from Home Assistant storage.
  // Falls back to old browser storage for migration.
  // On a fresh installation, installs the built-in default Views.
  async loadViewsFromStorage() {
    if (this.viewsLoadedFromStorage) {
      return;
    }

    try {
      if (!this._hass?.connection) {
        return;
      }

      const result = await this._hass.connection.sendMessagePromise({
        type: 'mss/views/get',
      });

      const storedViews = result?.views;

      // 1. Existing HA Views.
      if (Array.isArray(storedViews) && storedViews.length > 0) {
        this.views = structuredClone(storedViews);

        this.selectedViewId = this.views[0].id;

        this.viewsLoadedFromStorage = true;

        return;
      }

      // 2. Try migrating old browser-local Views.
      const localSaved = localStorage.getItem('mss-views');

      if (localSaved) {
        const localViews = JSON.parse(localSaved);

        if (Array.isArray(localViews) && localViews.length > 0) {
          this.views = structuredClone(localViews);

          this.selectedViewId = this.views[0].id;

          await this.saveViewsToStorage();

          this.viewsLoadedFromStorage = true;

          console.log(
            'MSS Views migrated from localStorage to Home Assistant.'
          );

          return;
        }
      }

      // 3. Fresh installation:
      // install the built-in default Views.
      if (Array.isArray(defaultViews) && defaultViews.length > 0) {
        this.views = structuredClone(defaultViews);

        this.selectedViewId = this.views[0].id;

        await this.saveViewsToStorage();

        this.viewsLoadedFromStorage = true;

        console.log('MSS default Views installed.');

        return;
      }

      this.viewsLoadedFromStorage = true;
    } catch (error) {
      console.error('Could not load MSS Views from Home Assistant.', error);

      this.viewsLoadedFromStorage = true;
    }
  }

  // Saves all Views to Home Assistant storage.
  async saveViewsToStorage() {
    try {
      if (!this._hass?.connection) {
        throw new Error('Home Assistant connection unavailable');
      }

      const viewsToSave = structuredClone(this.views);

      for (const view of viewsToSave) {
        if (view.backgroundMediaContentId) {
          delete view.imageUrl;
        }
        for (const shape of view.shapes ?? []) {
          if (shape.type !== 'image') {
            continue;
          }

          // Never persist runtime MQTT images.
          delete shape.liveImageUrl;

          // Never persist temporary HA Media signed URLs.
          if (shape.imageSource === 'local' && shape.mediaContentId) {
            delete shape.imageUrl;
          }
        }
      }

      await this._hass.connection.sendMessagePromise({
        type: 'mss/views/save',
        views: viewsToSave,
      });
    } catch (error) {
      console.error('Could not save MSS Views to Home Assistant.', error);

      // Temporary fallback during migration.
      localStorage.setItem('mss-views', JSON.stringify(this.views));
    }
  }

  // Creates a new blank View and selects it.
  createView() {
    const id = `mss-view-${Date.now()}`;

    const view = {
      id,
      name: 'New View',
      imageUrl: '/local/views/body.jpg',
      overlays: [],
    };

    this.views.push(view);
    this.selectedViewId = id;
    this.saveViewsToStorage();
    this.render();
  }

  // Duplicates the currently selected View.
  duplicateView() {
    const current = this.selectedView;

    if (!current) {
      return;
    }

    const copy = structuredClone(current);

    copy.id = `mss-view-${Date.now()}`;

    copy.name = `${current.name} Copy`;

    this.views.push(copy);
    this.selectedViewId = copy.id;
    this.saveViewsToStorage();
    this.render();
  }

  // Deletes the selected View when another View remains available.
  deleteView() {
    if (this.views.length <= 1) {
      return;
    }

    this.views = this.views.filter(
      (view) => String(view.id) !== String(this.selectedViewId)
    );

    this.selectedViewId = this.views[0].id;

    this.saveViewsToStorage();
    this.render();
  }

  // Opens the fullscreen Viewer with all available Views.
  openFullscreenViewer() {
    if (!Array.isArray(this.views) || this.views.length === 0) {
      return;
    }

    const dialog = document.createElement('mss-view-dialog');

    this.activeViewer = dialog;
    dialog.addEventListener(
      'mss-viewer-close',
      () => {
        // Synchronize the routing state from the fullscreen Viewer
        // back to the dashboard card.
        this.lastRoutingResult = dialog.lastRoutingResult;

        this.activeViewer = null;

        this.render();
      },
      {
        once: true,
      }
    );
    dialog.hass = this._hass;

    dialog.addEventListener('mss-views-change', (event) => {
      const updatedViews = event.detail?.views;

      const selectedViewId = event.detail?.selectedViewId;

      if (!Array.isArray(updatedViews) || updatedViews.length === 0) {
        return;
      }

      this.views = structuredClone(updatedViews);

      this.selectedViewId = selectedViewId ?? this.views[0].id;

      this.saveViewsToStorage();

      // Do not rebuild the card while
      // the fullscreen Viewer is mounted.
      if (!this.activeViewer || !this.activeViewer.isConnected) {
        this.render();
      }
    });

    this.shadowRoot.appendChild(dialog);

    dialog.open(this.views, this.selectedViewId);
  }

  // Opens the selected View directly in the Editor.
  openEditor() {
    const view = this.selectedView;

    if (!view) {
      return;
    }

    const editor = document.createElement('mss-view-editor-dialog');

    this.activeEditor = editor;

    editor.hass = this._hass;

    editor.addEventListener(
      'mss-editor-close',
      async () => {
        this.activeEditor = null;

        const selected = this.selectedView;

        if (selected) {
          await hydrateMssViewImages(this._hass, selected);
        }

        this.render();
      },
      {
        once: true,
      }
    );

    editor.addEventListener('mss-view-apply', (event) => {
      const updatedView = structuredClone(event.detail.view);

      const index = this.views.findIndex(
        (item) => String(item.id) === String(updatedView.id)
      );

      if (index < 0) {
        return;
      }

      this.views[index] = updatedView;

      // Keep the legacy/current reference synchronized.
      this.view = structuredClone(updatedView);

      this.selectedViewId = updatedView.id;

      this.saveViewsToStorage();

      // Do NOT render yet:
      // the Editor is still mounted.
    });

    editor.addEventListener('mss-view-duplicate', (event) => {
      const copy = structuredClone(event.detail.view);

      copy.id = `mss-view-${Date.now()}`;

      copy.name = `${copy.name || 'View'} Copy`;

      this.views.push(copy);
      this.selectedViewId = copy.id;

      this.saveViewsToStorage();
    });

    editor.addEventListener('mss-view-delete', (event) => {
      if (this.views.length <= 1) {
        return;
      }

      this.views = this.views.filter(
        (view) => String(view.id) !== String(event.detail.viewId)
      );

      this.selectedViewId = this.views[0].id;

      this.saveViewsToStorage();
    });

    this.shadowRoot.appendChild(editor);

    editor.open(view);
  }

  // ============================================================
  // AUTOMATIC VIEW ROUTING
  // ============================================================

  applyAutomaticViewRouting(force = false) {
    if (!this._hass || !Array.isArray(this.views) || this.views.length === 0) {
      return false;
    }

    const report = getLatestMssReportContext(this._hass);

    if (!report?.messageId) {
      return false;
    }

    // ==========================================================
    // SAME MQTT REPORT
    // ==========================================================
    //
    // Manual View changes are therefore respected until another
    // report arrives.
    // ==========================================================

    if (!force && report.messageId === this.lastAutoRoutingMessageId) {
      return false;
    }

    this.lastAutoRoutingMessageId = report.messageId;

    const result = resolveAutomaticView({
      views: this.views,

      currentViewId: this.selectedViewId,

      hass: this._hass,

      report,
    });
    this.lastRoutingResult = result;

    if (!result.changed || !result.view) {
      return false;
    }

    this.selectedViewId = result.view.id;

    /*
     * Keep the old/current compatibility property synchronized.
     */
    this.view = structuredClone(result.view);

    console.debug('[MSS View Router]', {
      view: result.view.name,

      priority: result.priority,

      reason: result.reason,

      mssGroup: report.mssGroup,

      messageId: report.messageId,
    });

    return true;
  }

  // Rebuilds the MSS dashboard card from its current configuration and HA state.
  render() {
    if (!this.shadowRoot || !this._config) {
      return;
    }

    this.shadowRoot.innerHTML = `
    <ha-card>

     <div class="mss-view-card-layout">
      <div class="mss-view-card-header">
        <h2>
          ${this._config.title ?? 'MSS View'}
        </h2>

        <div class="mss-view-card-actions">
          <button
            id="openMssViewer"
            class="mss-view-card-open"
            type="button">

            ${mssIcon('fullscreen', 17)}

            <span>Open Viewer</span>
          </button>

          <button
            id="editMssView"
            class="mss-view-card-open"
            type="button">

            ${mssIcon('edit', 17)}

            <span>Edit</span>
          </button>
        </div>
      </div>

      <div class="mss-view-management">
        <select
          id="mssViewSelector"
          class="mss-view-selector">

          ${this.views
            .map(
              (view) => `
                <option
                  value="${view.id}"
                  ${
                    String(view.id) === String(this.selectedViewId)
                      ? 'selected'
                      : ''
                  }>
                  ${view.name}
                </option>
              `
            )
            .join('')}
        </select>

      </div>

      <div class="mss-view-card-root">
      ${this.renderViewViewer(this.selectedView, {
        compact: true,
        showNavigation: false,
        showDetails: false,
      })}
    </div>
        ${renderMssRoutingStatus(this.lastRoutingResult)}
        </div>
    </ha-card>

    ${panelStyles()}

    <style>
      :host {
        display: block;
        height: 100%;
        min-height: 0;
      }

      ha-card {
        height: 100%;
          overflow: hidden;
        }

      .mss-view-card-layout {
        --mss-primary: #00a586;
        --mss-primary-hover: #00b896;
        --mss-primary-dark: #00856d;

        --mss-bg: #0f1724;
        --mss-surface: #182233;
        --mss-surface-soft: #223047;
        --mss-border: #2e3c52;

        --mss-text: #f7f9fb;
        --mss-text-secondary: #aeb8c5;
        --mss-text-muted: #7d8794;

        --mss-success: #54d38a;
        --mss-warning: #ffcc66;
        --mss-error: #ff6b6b;

        --mss-radius-sm: 8px;
        --mss-radius-md: 12px;
        --mss-radius-lg: 16px;

        --mss-shadow: 0 8px 24px rgba(0, 0, 0, .18);

        display: grid;

        grid-template-rows:
          auto
          auto
          minmax(0, 1fr)
          auto;

        width: 100%;
        height: 100%;

        min-width: 0;
        min-height: 0;

        overflow: hidden;
      }

      .mss-view-card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;

        padding: 16px 18px 0;
      }

      .mss-view-card-header h2 {
        margin: 0;
        font-size: 18px;
        font-weight: 700;
      }

      .mss-view-card-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .mss-view-card-open {
        border: 1px solid var(--divider-color);
        border-radius: 8px;

        padding: 8px 12px;

        background: var(--secondary-background-color);
        color: var(--primary-text-color);

        cursor: pointer;
        font-weight: 700;
        white-space: nowrap;

        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
      }

      .mss-view-card-open svg {
        display: block;
        flex: 0 0 auto;
      }

      .mss-action-icon {
        display: block;
        flex: 0 0 auto;
        object-fit: contain;
        filter: brightness(0) invert(1);
      }

      .mss-view-card-open {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
      }

      .mss-view-card-open:hover {
        border-color: #00a586;
        color: #00a586;
      }

      .mss-view-card-root {

          min-width: 0;
          min-height: 0;
          width: 100%;

          display: block;
          overflow: hidden;

          padding: 16px;
          box-sizing: border-box;

          background: var(--mss-bg);
          color: var(--mss-text);
          font-family: "Segoe UI", Inter, Arial, sans-serif;
        }

      .mss-view-card-root .mss-inspection {
        width: 100%;
        height: 100%;
        min-height: 0;
        overflow: hidden;
      }

    .mss-view-card-root .mss-inspection-canvas {
      flex: 1 1 0;

      width: 100%;
      height: auto;

      min-height: 0;
      max-height: 100%;

      overflow: hidden;
    }

      .mss-view-card-root .mss-image-stage {
      position: relative;

      display: block;

      max-width: 100%;
      max-height: 100%;

      flex: 0 0 auto;

      transform-origin: center center;
    }

    .mss-view-card-root .mss-stage-image {
      display: block;

      width: 100%;
      height: 100%;

      max-width: none;
      max-height: none;

      object-fit: contain;
    }
      .mss-view-management {
        display: flex;
        gap: 8px;
        padding: 12px 18px 0;
      }

      .mss-view-selector {
        flex: 1;
        min-width: 0;
      }

      .mss-view-management button,
      .mss-view-selector {
        padding: 8px 10px;
        border: 1px solid var(--divider-color);
        border-radius: 7px;
        background: var(--secondary-background-color);
        color: var(--primary-text-color);
      }

       .mss-routing-status {
          flex: 0 0 auto;

          width: auto;
          min-width: 0;

          margin: 0 16px 16px;
          padding: 6px 8px;

          box-sizing: border-box;
        }

        .mss-view-card-root .mss-inspection-compact {
        width: 100%;
        height: 100%;
        min-height: 0;
        max-height: 100%;

        flex: 1 1 0;
      }

        .mss-routing-status-main {
          color: #f7f9fb;

          font-size: 11px;
          font-weight: 700;
        }

        .mss-routing-status-details,
        .mss-routing-status-kept {
          margin-top: 2px;

          color: #aeb8c5;

          font-size: 10px;
        }

        .mss-routing-status-kept {
          color: #00a586;
        }


    </style>
  `;

    const openViewerButton = this.shadowRoot.querySelector('#openMssViewer');

    if (openViewerButton) {
      openViewerButton.onclick = () => {
        this.openFullscreenViewer();
      };
    }

    const editButton = this.shadowRoot.querySelector('#editMssView');

    if (editButton) {
      editButton.onclick = () => {
        this.openEditor();
      };
    }

    const selector = this.shadowRoot.querySelector('#mssViewSelector');

    if (selector) {
      selector.onchange = async () => {
        this.selectedViewId = selector.value;

        this.lastRoutingResult = null;

        this.saveViewsToStorage();

        const selected = this.selectedView;

        if (selected) {
          await hydrateMssViewImages(this._hass, selected);
        }

        this.render();
      };
    }

    const updateReferenceLines = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          (this.selectedView?.overlays ?? []).forEach((overlay) => {
            this.updateReferenceLine(overlay);
          });
        });
      });
    };

    const fitCompactStage = () => {
      const canvas = this.shadowRoot?.querySelector('.mss-inspection-canvas');

      const stage = this.shadowRoot?.querySelector('.mss-image-stage');

      const image = this.shadowRoot?.querySelector('.mss-stage-image');

      if (
        !canvas ||
        !stage ||
        !image ||
        !image.naturalWidth ||
        !image.naturalHeight
      ) {
        return;
      }

      const canvasWidth = canvas.clientWidth;
      const canvasHeight = canvas.clientHeight;

      if (!canvasWidth || !canvasHeight) {
        return;
      }

      const imageRatio = image.naturalWidth / image.naturalHeight;

      const canvasRatio = canvasWidth / canvasHeight;

      let width;
      let height;

      if (imageRatio > canvasRatio) {
        // Image is proportionally wider than the canvas.
        width = canvasWidth;
        height = width / imageRatio;
      } else {
        // Image is proportionally taller than the canvas.
        height = canvasHeight;
        width = height * imageRatio;
      }

      stage.style.width = `${width}px`;
      stage.style.height = `${height}px`;

      image.style.width = '100%';
      image.style.height = '100%';
    };

    const stageImage = this.shadowRoot?.querySelector('.mss-stage-image');

    const updateViewerLayout = () => {
      fitCompactStage();
      updateReferenceLines();
    };

    if (stageImage?.complete && stageImage.naturalWidth > 0) {
      updateViewerLayout();
    } else if (stageImage) {
      stageImage.addEventListener('load', updateViewerLayout, {
        once: true,
      });
    } else {
      updateReferenceLines();
    }
  }

  // Provides an approximate card height for masonry dashboard layouts.
  getCardSize() {
    return 8;
  }

  // Defines the default grid size for Sections dashboards.
  getGridOptions() {
    return {
      columns: 12,
      rows: 8,

      min_columns: 6,
      min_rows: 5,

      max_columns: 24,
      max_rows: 16,
    };
  }

  static getConfigElement() {
    return document.createElement('mss-view-card-editor');
  }
}

class MSSViewCardEditor extends HTMLElement {
  constructor() {
    super();

    this.attachShadow({
      mode: 'open',
    });

    this._config = {};
  }

  set hass(hass) {
    this._hass = hass;
  }

  setConfig(config) {
    this._config = {
      title: 'MSS View',
      grid_options: {
        columns: 12,
        rows: 8,
      },
      ...config,
      grid_options: {
        columns: config?.grid_options?.columns ?? 12,
        rows: config?.grid_options?.rows ?? 8,
      },
    };

    this.render();
  }

  fireConfigChanged() {
    this.dispatchEvent(
      new CustomEvent('config-changed', {
        detail: {
          config: this._config,
        },
        bubbles: true,
        composed: true,
      })
    );
  }

  render() {
    if (!this.shadowRoot) {
      return;
    }

    const columns = Number(this._config.grid_options?.columns ?? 12);
    const rows = Number(this._config.grid_options?.rows ?? 8);

    this.shadowRoot.innerHTML = `
      <div class="editor">

        <label>
          <span>Title</span>
          <input
            id="title"
            type="text"
            value="${this._config.title ?? 'MSS View'}"
          />
        </label>

        <div class="section">
          <h3>Card size</h3>

          <p>
            These values control the Home Assistant Sections grid size.
          </p>

          <div class="size-row">
            <span>Width</span>

            <button id="columnsMinus" type="button">−</button>

            <strong>${columns}</strong>

            <button id="columnsPlus" type="button">+</button>
          </div>

          <div class="size-row">
            <span>Height</span>

            <button id="rowsMinus" type="button">−</button>

            <strong>${rows}</strong>

            <button id="rowsPlus" type="button">+</button>
          </div>

          <button id="fullWidth" class="preset" type="button">
            Full width
          </button>

          <p class="hint">
            Equivalent YAML:
          </p>

          <pre>grid_options:
  columns: ${columns}
  rows: ${rows}</pre>
        </div>

      </div>

      <style>
        .editor {
          display: flex;
          flex-direction: column;
          gap: 18px;
          padding: 4px;
        }

        label {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        label span,
        h3 {
          font-weight: 700;
        }

        input {
          box-sizing: border-box;
          width: 100%;
          padding: 9px 10px;

          border: 1px solid var(--divider-color);
          border-radius: 8px;

          background: var(--secondary-background-color);
          color: var(--primary-text-color);
        }

        .section {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .section h3,
        .section p {
          margin: 0;
        }

        .section p {
          color: var(--secondary-text-color);
          font-size: 12px;
        }

        .size-row {
          display: grid;
          grid-template-columns: 1fr 36px 48px 36px;
          align-items: center;
          gap: 8px;
        }

        .size-row strong {
          text-align: center;
        }

        button {
          min-height: 34px;

          border: 1px solid var(--divider-color);
          border-radius: 7px;

          background: var(--secondary-background-color);
          color: var(--primary-text-color);

          cursor: pointer;
        }

        button:hover {
          border-color: #00a586;
          color: #00a586;
        }

        .preset {
          width: fit-content;
          padding: 0 12px;
        }

        pre {
          margin: 0;
          padding: 10px;

          border-radius: 8px;

          background: var(--secondary-background-color);
          color: var(--primary-text-color);

          font-size: 12px;
        }

        .hint {
          margin-top: 4px !important;
        }
      </style>
    `;

    const titleInput = this.shadowRoot.querySelector('#title');

    titleInput.oninput = (event) => {
      this._config = {
        ...this._config,
        title: event.target.value,
      };

      this.fireConfigChanged();
    };

    this.shadowRoot.querySelector('#columnsMinus').onclick = () => {
      this.updateSize('columns', Math.max(1, columns - 1));
    };

    this.shadowRoot.querySelector('#columnsPlus').onclick = () => {
      this.updateSize('columns', Math.min(24, columns + 1));
    };

    this.shadowRoot.querySelector('#rowsMinus').onclick = () => {
      this.updateSize('rows', Math.max(1, rows - 1));
    };

    this.shadowRoot.querySelector('#rowsPlus').onclick = () => {
      this.updateSize('rows', Math.min(16, rows + 1));
    };

    this.shadowRoot.querySelector('#fullWidth').onclick = () => {
      this.updateSize('columns', 24);
    };
  }

  updateSize(property, value) {
    this._config = {
      ...this._config,

      grid_options: {
        ...this._config.grid_options,
        [property]: value,
      },
    };

    this.fireConfigChanged();
    this.render();
  }
}

Object.assign(MSSViewCard.prototype, overlayRenderMethods, viewRenderMethods);

if (!customElements.get('mss-view-card')) {
  customElements.define('mss-view-card', MSSViewCard);
}

if (!customElements.get('mss-view-card-editor')) {
  customElements.define('mss-view-card-editor', MSSViewCardEditor);
}

window.customCards = window.customCards ?? [];

if (!window.customCards.some((card) => card.type === 'mss-view-card')) {
  window.customCards.push({
    type: 'mss-view-card',
    name: 'MSS View Card',
    description:
      'Displays an MSS image View with Home Assistant entity overlays.',
    preview: true,
  });
}
