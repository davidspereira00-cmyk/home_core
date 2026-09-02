import { overlayRenderMethods } from './mss-overlay-renderer.js';

import { viewRenderMethods } from './mss-view-renderer.js';

import { panelStyles } from './mss-panel-styles.js';

import { renderMssRoutingStatus } from './mss-routing-status.js';

import { hydrateMssViewImages } from './mss-value-decoder.js';

import { mssIcon } from './mss-icons.js';

import {
  getLatestMssReportContext,
  resolveAutomaticView,
} from './mss-view-router.js';

import './mss-view-editor-dialog.js';

class MSSViewDialog extends HTMLElement {
  constructor() {
    super();

    this.attachShadow({
      mode: 'open',
    });

    this._hass = null;
    // Stores all Views available inside the fullscreen Viewer.
    this.views = [];
    // Keeps a reference to the Editor opened from this Viewer.
    this.activeEditor = null;
    // Stores the ID of the View currently displayed.
    this.selectedViewId = null;
    this.selectedOverlay = null;
    this.selectedViewMeasurementIndex = 0;
    this.viewMeasurements = [];

    // Tracks the last MSS MQTT message already handled by
    // automatic View routing.
    this.lastAutoRoutingMessageId = null;

    // Stores the current fullscreen Viewer zoom level.
    this.zoomLevel = 1;

    // Stores the page overflow value so background scrolling can be restored.
    this.previousBodyOverflow = '';

    this.lastRoutingResult = null;
  }

  // Returns the currently selected measurement when measurement history is available.
  get selectedViewMeasurement() {
    return this.viewMeasurements[this.selectedViewMeasurementIndex] ?? null;
  }

  set hass(hass) {
    this._hass = hass;

    // ==========================================================
    // EDITOR
    // ==========================================================

    if (this.activeEditor) {
      this.activeEditor.hass = hass;
      return;
    }

    // ==========================================================
    // AUTOMATIC VIEW ROUTING
    // ==========================================================

    this.applyAutomaticViewRouting();

    // ==========================================================
    // LIVE VIEW VALUES
    // ==========================================================

    if (this.isConnected && this.view) {
      this.refreshLiveOverlayValues(this.view);

      this.hydrateCurrentView().then(() => {
        if (this.isConnected && !this.activeEditor) {
          this.render();
        }
      });
    }
  }

  async hydrateCurrentView() {
    if (!this.view || !this._hass?.connection) {
      return;
    }

    await hydrateMssViewImages(this._hass, this.view);
  }

  // Opens the fullscreen Viewer with all available Views.
  async open(views, selectedViewId) {
    this.views = structuredClone(views);

    const selectedExists = this.views.some(
      (view) => String(view.id) === String(selectedViewId)
    );

    this.selectedViewId = selectedExists
      ? selectedViewId
      : (this.views[0]?.id ?? null);

    this.view = structuredClone(this.selectedView);

    this.zoomLevel = Number(this.view?.viewerScale) || 1;

    this.previousBodyOverflow = document.body.style.overflow;

    document.body.style.overflow = 'hidden';

    /*
     * The View passed by the dashboard card is the View the user
     * currently selected.
     *
     * Do not rerun automatic routing when opening the Viewer.
     * The current MQTT report has already been handled by the card.
     *
     * Seed the router with the current message ID so ordinary HA
     * updates from the same report cannot immediately override the
     * manually selected View.
     */
    const report = getLatestMssReportContext(this._hass);

    this.lastAutoRoutingMessageId = report?.messageId ?? null;

    await this.hydrateCurrentView();

    this.render();
  }

  // Returns the View currently selected in the fullscreen Viewer.
  get selectedView() {
    return (
      this.views.find(
        (view) => String(view.id) === String(this.selectedViewId)
      ) ?? null
    );
  }

  close() {
    document.body.style.overflow = this.previousBodyOverflow;

    this.dispatchEvent(
      new CustomEvent('mss-viewer-close', {
        bubbles: true,
        composed: true,
      })
    );

    this.remove();
  }

  // Restores page scrolling if the Viewer is removed without using close().
  disconnectedCallback() {
    document.body.style.overflow = this.previousBodyOverflow;
  }

  // Shows a temporary notification in the Viewer.
  showMssNotification(message) {
    const existing = this.shadowRoot?.querySelector('.mss-viewer-notification');

    existing?.remove();

    const notification = document.createElement('div');

    notification.className = 'mss-viewer-notification';

    notification.textContent = message;

    this.shadowRoot?.appendChild(notification);

    requestAnimationFrame(() => {
      notification.classList.add('visible');
    });

    setTimeout(() => {
      notification.classList.remove('visible');

      setTimeout(() => {
        notification.remove();
      }, 200);
    }, 3000);
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

  // Applies the current zoom level to the complete image stage.
  applyZoom() {
    const stage = this.shadowRoot?.querySelector('.mss-image-stage');

    if (!stage) {
      return;
    }

    stage.style.transform = `scale(${this.zoomLevel})`;
  }

  // Increases the fullscreen Viewer zoom level.
  zoomIn() {
    this.zoomLevel = Math.min(3, this.zoomLevel + 0.25);

    this.applyZoom();
    this.updateZoomLabel();
  }

  // Decreases the fullscreen Viewer zoom level.
  zoomOut() {
    this.zoomLevel = Math.max(0.5, this.zoomLevel - 0.25);

    this.applyZoom();
    this.updateZoomLabel();
  }

  // Restores the fullscreen Viewer to its fitted size.
  fitView() {
    this.zoomLevel = 1;

    this.applyZoom();
    this.updateZoomLabel();
  }

  // Updates the zoom percentage shown in the Viewer toolbar.
  updateZoomLabel() {
    const label = this.shadowRoot?.querySelector('#mssZoomLabel');

    if (label) {
      label.textContent = `${Math.round(this.zoomLevel * 100)}%`;
    }
  }

  // ============================================================
  // AUTOMATIC VIEW ROUTING
  // ============================================================

  applyAutomaticViewRouting(force = false) {
    if (this.activeEditor) {
      return false;
    }

    if (!this._hass || !Array.isArray(this.views) || this.views.length === 0) {
      return false;
    }

    const report = getLatestMssReportContext(this._hass);

    if (!report?.messageId) {
      return false;
    }

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

    this.view = structuredClone(result.view);

    this.zoomLevel = Number(this.view.viewerScale) || 1;

    /*
     * Tell the dashboard card which View is now active.
     *
     * The View definitions themselves haven't changed, but this
     * synchronizes selectedViewId between the fullscreen Viewer
     * and the underlying card.
     */
    this.emitViewsChange();

    this.showMssNotification(`View changed to ${this.view.name}`);

    console.debug('[MSS View Router]', {
      view: result.view.name,

      priority: result.priority,

      reason: result.reason,

      mssGroup: report.mssGroup,

      messageId: report.messageId,
    });

    return true;
  }

  // Selects and displays another View.
  async selectView(viewId) {
    const selected = this.views.find(
      (view) => String(view.id) === String(viewId)
    );

    if (!selected) {
      return;
    }

    this.selectedViewId = selected.id;

    this.view = structuredClone(selected);

    this.lastRoutingResult = null;

    await this.hydrateCurrentView();

    this.zoomLevel = Number(this.view.viewerScale) || 1;

    this.emitViewsChange();

    this.render();
  }

  // Creates a blank View and selects it.
  createView() {
    const id = `mss-view-${Date.now()}`;

    const view = {
      id,
      name: 'New View',
      imageUrl: '/local/views/body.jpg',
      viewerScale: 1,
      overlays: [],
    };

    this.views.push(view);

    this.selectedViewId = id;
    this.view = structuredClone(view);

    this.zoomLevel = 1;

    this.emitViewsChange();
    this.render();
  }

  // Duplicates the currently selected View.
  duplicateView() {
    if (!this.view) {
      return;
    }

    const copy = structuredClone(this.view);

    copy.id = `mss-view-${Date.now()}`;

    copy.name = `${copy.name || 'View'} Copy`;

    this.views.push(copy);

    this.selectedViewId = copy.id;

    this.view = structuredClone(copy);

    this.emitViewsChange();
    this.render();
  }

  // Requests confirmation before deleting the selected View.
  deleteView() {
    if (!this.view || this.views.length <= 1) {
      return;
    }

    const confirmed = window.confirm(
      `Delete "${this.view.name || 'View'}"?\n\nThis action cannot be undone.`
    );

    if (!confirmed) {
      return;
    }

    this.views = this.views.filter(
      (view) => String(view.id) !== String(this.selectedViewId)
    );

    this.selectedViewId = this.views[0].id;

    this.view = structuredClone(this.views[0]);

    this.zoomLevel = Number(this.view.viewerScale) || 1;

    this.emitViewsChange();
    this.render();
  }

  // Sends the complete View state back to the dashboard card.
  emitViewsChange() {
    this.dispatchEvent(
      new CustomEvent('mss-views-change', {
        detail: {
          views: structuredClone(this.views),
          selectedViewId: this.selectedViewId,
        },
        bubbles: true,
        composed: true,
      })
    );
  }

  // Opens the current View in the fullscreen visual Editor.
  openEditor() {
    const EditorClass = customElements.get('mss-view-editor-dialog');

    if (!EditorClass) {
      console.error(
        'MSS View Editor Dialog is not registered. ' +
          'Check mss-view-editor-dialog.js for syntax or loading errors.'
      );

      return;
    }

    // Prevent opening a second Editor.
    if (this.activeEditor) {
      return;
    }

    const editor = document.createElement('mss-view-editor-dialog');

    // ==========================================================
    // LOCK AUTOMATIC ROUTING
    // ==========================================================

    this.activeEditor = editor;

    editor.hass = this._hass;

    // ==========================================================
    // APPLY CHANGES
    // ==========================================================

    editor.addEventListener('mss-view-apply', (event) => {
      const updatedView = structuredClone(event.detail.view);

      this.view = updatedView;

      this.selectedViewId = updatedView.id;

      this.zoomLevel = Number(updatedView.viewerScale) || 1;

      const index = this.views.findIndex(
        (view) => String(view.id) === String(updatedView.id)
      );

      if (index >= 0) {
        this.views[index] = structuredClone(updatedView);
      }

      this.emitViewsChange();

      // Do NOT render here.
      // The Editor is still open.
    });

    // ==========================================================
    // EDITOR CLOSED
    // ==========================================================

    editor.addEventListener(
      'mss-editor-close',
      () => {
        // Unlock automatic routing.
        this.activeEditor = null;

        // Show the View that was being edited.
        this.render();

        /*
         * IMPORTANT:
         *
         * Do NOT call applyAutomaticViewRouting()
         * here.
         *
         * Automatic routing resumes on the next
         * Home Assistant / MQTT update.
         */
      },
      {
        once: true,
      }
    );

    // ==========================================================
    // OPEN EDITOR
    // ==========================================================

    this.shadowRoot.appendChild(editor);

    editor.open(this.view);
  }

  // Attaches the fullscreen Viewer controls.
  bindEvents() {
    const editButton = this.shadowRoot?.querySelector('#editMssView');

    const fitButton = this.shadowRoot?.querySelector('#fitMssViewer');

    const zoomInButton = this.shadowRoot?.querySelector('#zoomInMssViewer');

    const zoomOutButton = this.shadowRoot?.querySelector('#zoomOutMssViewer');

    const closeButton = this.shadowRoot?.querySelector('#closeMssViewer');

    const viewSelector = this.shadowRoot?.querySelector(
      '#mssFullscreenViewSelector'
    );

    const newViewButton = this.shadowRoot?.querySelector('#newMssView');

    const duplicateViewButton =
      this.shadowRoot?.querySelector('#duplicateMssView');

    const deleteViewButton = this.shadowRoot?.querySelector('#deleteMssView');

    const actionsButton = this.shadowRoot?.querySelector(
      '#mssViewActionsButton'
    );

    const actionsMenu = this.shadowRoot?.querySelector('#mssViewActionsMenu');

    const closeActionsMenu = () => {
      if (!actionsMenu || !actionsButton) {
        return;
      }

      actionsMenu.hidden = true;

      actionsButton.setAttribute('aria-expanded', 'false');
    };

    if (actionsButton && actionsMenu) {
      actionsButton.onclick = (event) => {
        event.stopPropagation();

        const isOpen = !actionsMenu.hidden;

        actionsMenu.hidden = isOpen;

        actionsButton.setAttribute('aria-expanded', String(!isOpen));
      };
    }

    if (editButton) {
      editButton.onclick = () => {
        this.openEditor();
      };
    }

    if (fitButton) {
      fitButton.onclick = () => {
        this.fitView();
      };
    }

    if (zoomInButton) {
      zoomInButton.onclick = () => {
        this.zoomIn();
      };
    }

    if (zoomOutButton) {
      zoomOutButton.onclick = () => {
        this.zoomOut();
      };
    }

    if (closeButton) {
      closeButton.onclick = () => {
        this.close();
      };
    }

    if (viewSelector) {
      viewSelector.onchange = () => {
        this.selectView(viewSelector.value);
      };
    }

    if (newViewButton) {
      newViewButton.onclick = () => {
        closeActionsMenu();
        this.createView();
      };
    }

    if (duplicateViewButton) {
      duplicateViewButton.onclick = () => {
        closeActionsMenu();
        this.duplicateView();
      };
    }

    if (deleteViewButton) {
      deleteViewButton.onclick = () => {
        closeActionsMenu();
        this.deleteView();
      };
    }

    const viewerCanvas = this.shadowRoot?.querySelector(
      '.mss-inspection-canvas'
    );

    if (viewerCanvas) {
      viewerCanvas.onwheel = (event) => {
        event.stopPropagation();
      };

      viewerCanvas.ontouchmove = (event) => {
        event.stopPropagation();
      };
    }

    const backdrop = this.shadowRoot?.querySelector('.mss-dialog-backdrop');

    if (backdrop) {
      backdrop.onclick = (event) => {
        const editorOpen = this.shadowRoot?.querySelector(
          'mss-view-editor-dialog'
        );

        if (editorOpen) {
          return;
        }

        if (event.target === backdrop) {
          this.close();
        }
      };
    }

    this.onkeydown = (event) => {
      if (event.key !== 'Escape') {
        return;
      }

      const editorOpen = this.shadowRoot?.querySelector(
        'mss-view-editor-dialog'
      );

      if (editorOpen) {
        return;
      }

      this.close();
    };

    this.tabIndex = -1;
    this.focus();

    this.applyZoom();
    this.updateZoomLabel();
  }

  // Renders the fullscreen MSS Viewer.
  // ============================================================
  // RENDER
  // ============================================================

  // Renders the fullscreen MSS Viewer.
  render() {
    if (!this.shadowRoot || !this.view) {
      return;
    }

    this.shadowRoot.innerHTML = `
    <div class="mss-dialog-backdrop">

      <section
        class="mss-view-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="MSS fullscreen viewer">

        <header class="mss-dialog-header">

          <div>
            <div class="mss-dialog-kicker">
              MSS VIEWER
            </div>

            <h2>
              ${this.view.name ?? 'MSS View'}
            </h2>
          </div>

          <div class="mss-dialog-actions">

            <button
              id="fitMssViewer"
              class="mss-dialog-button secondary"
              type="button">
              ${mssIcon('fullscreen', 16)}
              <span>Fit</span>
            </button>

            <button
              id="zoomOutMssViewer"
              class="mss-dialog-button secondary"
              type="button"
              aria-label="Zoom out">
              ${mssIcon('minus', 16)}
            </button>

            <button
              id="zoomInMssViewer"
              class="mss-dialog-button secondary"
              type="button"
              aria-label="Zoom in">
              ${mssIcon('plus', 16)}
            </button>

            <button
              id="editMssView"
              class="mss-dialog-button primary"
              type="button">
              ${mssIcon('edit', 16)}
              <span>Edit</span>
            </button>

            <button
              id="closeMssViewer"
              class="mss-dialog-button secondary"
              type="button">
              ${mssIcon('close', 16)}
              <span>Close</span>
            </button>

          </div>

        </header>

        <main class="mss-dialog-content">

          <div class="mss-viewer-stage-shell">

            <div class="mss-app mss-fullscreen-viewer-root">

              ${this.renderViewViewer(this.view, {
                compact: true,
                showNavigation: false,
                showDetails: false,
              })}

            </div>


            <!-- ============================================ -->
            <!-- VIEW CONTROLS -->
            <!-- ============================================ -->

            <div class="mss-viewer-view-controls">

              ${renderMssRoutingStatus(this.lastRoutingResult)}

              <select
                id="mssFullscreenViewSelector"
                class="mss-dialog-select">

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


             <div class="mss-viewer-view-actions">

                      <button
                        id="mssViewActionsButton"
                        class="mss-dialog-icon-button"
                        type="button"
                        title="View actions"
                        aria-label="View actions"
                        aria-expanded="false">
                        ${mssIcon('more', 18)}
                      </button>

                      <div
                        id="mssViewActionsMenu"
                        class="mss-view-actions-menu"
                        hidden>

                        <button
                          id="newMssView"
                          type="button">
                          ${mssIcon('add', 16)}
                          <span>New View</span>
                        </button>

                        <button
                          id="duplicateMssView"
                          type="button">
                          ${mssIcon('copy', 16)}
                          <span>Duplicate View</span>
                        </button>

                        <button
                          id="deleteMssView"
                          class="danger"
                          type="button"
                          ${this.views.length <= 1 ? 'disabled' : ''}>
                          ${mssIcon('trash', 16)}
                          <span>Delete View</span>
                        </button>

                      </div>

                    </div>

          </div>

        </main>

      </section>

    </div>

    ${panelStyles()}

    <style>

      :host {
        position: fixed;
        inset: 0;
        z-index: 9999;

        display: block;
      }


      .mss-dialog-backdrop {
        position: fixed;
        inset: 0;

        display: flex;
        align-items: stretch;
        justify-content: stretch;

        padding: 18px;
        box-sizing: border-box;

        background: rgba(0, 0, 0, .72);
        backdrop-filter: blur(4px);

        overscroll-behavior: contain;
      }


      .mss-view-dialog {
        width: 100%;
        height: 100%;

        display: flex;
        flex-direction: column;

        background: #0f1724;

        border: 1px solid #2e3c52;
        border-radius: 16px;

        overflow: hidden;

        box-shadow:
          0 24px 80px
          rgba(0, 0, 0, .55);
      }


      .mss-dialog-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 20px;

        padding: 16px 20px;

        background: #182233;
        border-bottom: 1px solid #2e3c52;
      }


      .mss-dialog-header h2 {
        margin: 3px 0 0;

        color: #f7f9fb;
        font-size: 22px;
      }


      .mss-dialog-kicker {
        color: #00a586;

        font-size: 11px;
        font-weight: 800;
        letter-spacing: .14em;
      }


      .mss-dialog-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }


      .mss-dialog-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;

          padding: 10px 16px;

          border: 0;
          border-radius: 8px;

          cursor: pointer;
          font-weight: 700;
        }

        .mss-dialog-button svg,
        .mss-dialog-icon-button svg {
          display: block;
          flex: 0 0 auto;
        }


      .mss-dialog-button.secondary {
        color: #f7f9fb;
        background: #223047;

        border: 1px solid #2e3c52;
      }


      .mss-dialog-button.secondary:hover {
        border-color: #00a586;
      }


      .mss-dialog-button.danger {
        color: #ff9b9b;
        background: #3a2025;

        border: 1px solid #7a3939;
      }


      .mss-dialog-button:disabled {
        opacity: .45;
        cursor: not-allowed;
      }


      .mss-dialog-button.primary {
        color: white;
        background: #00a586;

        border: 1px solid #00a586;
      }


      .mss-dialog-button.primary:hover {
        background: #00b896;
      }

      .mss-action-icon {
        display: block;
        flex: 0 0 auto;
        object-fit: contain;
        filter: brightness(0) invert(1);
      }

      .mss-view-actions-menu button.danger .mss-action-icon {
        filter:
          brightness(0)
          saturate(100%)
          invert(67%)
          sepia(34%)
          saturate(1133%)
          hue-rotate(314deg)
          brightness(104%)
          contrast(102%);
      }

      .mss-dialog-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
      }


      .mss-dialog-select {
        width: 190px;
        padding: 9px 10px;

        color: #f7f9fb;
        background: #223047;

        border: 1px solid #2e3c52;
        border-radius: 8px;
      }


      .mss-dialog-content {
        flex: 1;
        min-height: 0;

        padding: 20px;
        box-sizing: border-box;

        overflow: hidden;
      }


      .mss-viewer-stage-shell {
        position: relative;

        width: 100%;
        height: 100%;
        min-height: 0;
      }


      /* ==================================================== */
      /* VIEW CONTROLS */
      /* ==================================================== */

      .mss-viewer-view-controls {
        position: absolute;

        left: 50%;
        bottom: 18px;
        z-index: 20;

        transform: translateX(-50%);

        display: flex;
        align-items: center;
        gap: 8px;

        padding: 8px;

        background: rgba(24, 34, 51, .94);

        border: 1px solid #2e3c52;
        border-radius: 10px;

        box-shadow:
          0 8px 26px
          rgba(0, 0, 0, .32);
      }


      .mss-viewer-view-actions {
        position: relative;

        display: flex;
        align-items: center;
      }

      .mss-view-actions-menu {
        position: absolute;

        right: 0;
        bottom: calc(100% + 8px);

        min-width: 175px;

        padding: 6px;

        background: #182233;

        border: 1px solid #2e3c52;
        border-radius: 10px;

        box-shadow:
          0 10px 30px
          rgba(0, 0, 0, .35);

        z-index: 40;
      }

      .mss-view-actions-menu[hidden] {
        display: none;
      }

      .mss-view-actions-menu button {
        width: 100%;

        display: flex;
        align-items: center;
        gap: 9px;

        padding: 9px 10px;

        color: #f7f9fb;
        background: transparent;

        border: 0;
        border-radius: 7px;

        cursor: pointer;

        text-align: left;
        font: inherit;
      }

      .mss-view-actions-menu button:hover:not(:disabled) {
        background: #223047;
      }

      .mss-view-actions-menu button.danger {
        color: #ff8d8d;
      }

      .mss-view-actions-menu button:disabled {
        opacity: .4;
        cursor: not-allowed;
      }


      /* ==================================================== */
      /* ROUTING STATUS */
      /* ==================================================== */

      .mss-routing-status {
        min-width: 190px;
        padding: 8px 10px;

        background: rgba(15, 23, 36, .9);

        border: 1px solid #2e3c52;
        border-radius: 8px;
      }


      .mss-routing-status-main {
        color: #f7f9fb;

        font-size: 12px;
        font-weight: 700;
      }


      .mss-routing-status-details,
      .mss-routing-status-kept {
        margin-top: 3px;

        color: #aeb8c5;

        font-size: 11px;
      }


      .mss-routing-status-kept {
        color: #00a586;
      }


      /* ==================================================== */
      /* VIEW ACTION BUTTONS */
      /* ==================================================== */

      .mss-dialog-icon-button {
        width: 36px;
        height: 36px;

        display: inline-flex;
        align-items: center;
        justify-content: center;

        padding: 0;

        color: #f7f9fb;
        background: #223047;

        border: 1px solid #2e3c52;
        border-radius: 8px;

        cursor: pointer;
        font-size: 17px;
      }


      .mss-dialog-icon-button:hover {
        border-color: #00a586;
      }


      .mss-dialog-icon-button.danger {
        color: #ff8d8d;
      }


      .mss-dialog-icon-button:disabled {
        opacity: .4;
        cursor: not-allowed;
      }


      /* ==================================================== */
      /* VIEWER */
      /* ==================================================== */

      .mss-fullscreen-viewer-root {
        width: 100%;
        height: 100%;
        min-height: 0;

        background: transparent;
      }


      .mss-fullscreen-viewer-root
      .mss-inspection {
        width: 100%;
        height: 100%;
        min-height: 0;
      }


      .mss-fullscreen-viewer-root
      .mss-inspection-canvas {
        width: 100%;
        height: 100%;
        min-height: 0;

        overflow: auto;

        overscroll-behavior: contain;
        touch-action: pan-x pan-y;
      }


      .mss-fullscreen-viewer-root
      .mss-image-stage {
        max-width: 100%;
        max-height: 100%;

        transform:
          scale(${this.zoomLevel});

        transform-origin: center center;

        transition:
          transform .16s ease;
      }


      .mss-fullscreen-viewer-root
      .mss-stage-image {
        max-width: 100%;
        max-height:
          calc(100vh - 150px);
      }


      .mss-zoom-label {
        min-width: 52px;

        color: #aeb8c5;

        text-align: center;
        font-size: 13px;
        font-weight: 700;
      }


      /* ==================================================== */
      /* NOTIFICATION */
      /* ==================================================== */

      .mss-viewer-notification {
        position: fixed;

        right: 28px;
        bottom: 28px;
        z-index: 100;

        max-width: 320px;
        padding: 12px 16px;

        color: #f7f9fb;
        background: #182233;

        border: 1px solid #00a586;
        border-radius: 10px;

        box-shadow:
          0 10px 30px
          rgba(0, 0, 0, .35);

        font-size: 13px;
        font-weight: 700;

        opacity: 0;

        transform:
          translateY(10px);

        transition:
          opacity .2s ease,
          transform .2s ease;
      }


      .mss-viewer-notification.visible {
        opacity: 1;

        transform:
          translateY(0);
      }


      @media (max-width: 700px) {

        .mss-dialog-backdrop {
          padding: 0;
        }

        .mss-view-dialog {
          border-radius: 0;
        }

        .mss-dialog-content {
          padding: 10px;
        }
      }

    </style>
  `;

    this.bindEvents();

    // ==========================================================
    // UPDATE REFERENCE LINES
    // ==========================================================

    const updateReferenceLines = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          (this.view?.overlays ?? []).forEach((overlay) => {
            this.updateReferenceLine(overlay);
          });
        });
      });
    };

    const stageImage = this.shadowRoot?.querySelector('.mss-stage-image');

    if (stageImage?.complete) {
      updateReferenceLines();
    } else if (stageImage) {
      stageImage.addEventListener('load', updateReferenceLines, {
        once: true,
      });
    } else {
      updateReferenceLines();
    }
  }
}

Object.assign(MSSViewDialog.prototype, overlayRenderMethods, viewRenderMethods);

if (!customElements.get('mss-view-dialog')) {
  customElements.define('mss-view-dialog', MSSViewDialog);
}
