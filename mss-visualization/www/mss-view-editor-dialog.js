import { overlayRenderMethods } from './mss-overlay-renderer.js';
import { hydrateMssViewImages } from './mss-value-decoder.js';
import { panelStyles } from './mss-panel-styles.js';
import {
  getMssCompositeFieldsForGroup,
  getMssMeasurementFieldsForGroup,
} from './mss-field-resolver.js';
import { mssIcon } from './mss-icons.js';
class MSSViewEditorDialog extends HTMLElement {
  constructor() {
    super();

    this.attachShadow({
      mode: 'open',
    });

    this._hass = null;
    this.originalView = null;
    this.workingView = null;

    this.selectedOverlay = null;
    this.selectedOverlayElement = null;
    this.gridEnabled = false;
    this.editorZoom = 1;
    this.draggedOverlayId = null;
    this.overlayDropCompleted = false;
    this.draggedElementId = null;
    this.elementDropCompleted = false;
    this.draggingOverlay = null;
    this.lastMssDataSchemaSignature = '';
    this.availableMssImages = [];
    // Stores the page overflow value so dashboard scrolling can be restored.

    this.draggedShapeId = null;
    this.shapeDropCompleted = false;

    this.localImageUploadState = {
      shapeId: null,
      uploading: false,
      error: '',
    };

    this.previousBodyOverflow = '';
    // Stores the temporary save-status timeout.
    this.saveStatusTimeout = null;
  }

  set hass(hass) {
    this._hass = hass;

    // Load live MSS image metadata once the HA connection exists.
    if (this._hass?.connection && this.availableMssImages.length === 0) {
      this.loadAvailableMssImages().then(() => {
        if (this.isConnected && this.selectedShape?.type === 'image') {
          this.renderPanels();
        }
      });
    }

    // ==========================================================
    // SCHEMA CHANGES
    // ==========================================================

    const nextSignature = this.getMssDataSchemaSignature();

    if (nextSignature && nextSignature !== this.lastMssDataSchemaSignature) {
      this.lastMssDataSchemaSignature = nextSignature;

      if (this.isConnected && this.selectedOverlayElement) {
        this.renderPanels();
      }
    }

    // ==========================================================
    // LIVE ENTITY VALUE CHANGES
    // ==========================================================
    //
    // Home Assistant calls the hass setter whenever entity
    // states change.
    //
    // Therefore a new MSS MQTT report should refresh the
    // values shown inside the editor canvas even if the MSS
    // schema itself did not change.
    // ==========================================================

    if (this.isConnected && this.selectedOverlay) {
      this.refreshSelectedOverlayPreview();
    }
  }

  // Opens the fullscreen Editor with an isolated editable copy of the View.
  async open(view) {
    this.originalView = structuredClone(view);
    this.workingView = structuredClone(view);

    this.selectedOverlay = null;
    this.selectedOverlayElement = null;
    this.selectedShape = null;

    this.previousBodyOverflow = document.body.style.overflow;

    document.body.style.overflow = 'hidden';

    await this.loadAvailableMssImages();

    await hydrateMssViewImages(this._hass, this.workingView);

    this.render();
  }

  // Closes the Editor and discards changes made since the last Apply.
  cancel() {
    this.workingView = structuredClone(this.originalView);

    this.restorePageScroll();

    this.dispatchEvent(
      new CustomEvent('mss-editor-close', {
        bubbles: true,
        composed: true,
      })
    );

    this.remove();
  }

  // Emits the edited View, keeps the Editor open and updates the saved baseline.
  apply() {
    const appliedView = structuredClone(this.workingView);

    if (appliedView.backgroundMediaContentId) {
      delete appliedView.imageUrl;
    }

    // Never persist live MQTT Base64 images.
    for (const shape of appliedView.shapes ?? []) {
      if (shape.type !== 'image') {
        continue;
      }

      // MQTT runtime image.
      delete shape.liveImageUrl;

      /*
       * Media Library URLs are temporary signed URLs.
       * Persist only mediaContentId and resolve imageUrl again
       * when the View is loaded.
       */
      if (shape.imageSource === 'local' && shape.mediaContentId) {
        delete shape.imageUrl;
      }
    }

    this.dispatchEvent(
      new CustomEvent('mss-view-apply', {
        detail: {
          view: appliedView,
        },
        bubbles: true,
        composed: true,
      })
    );

    this.originalView = structuredClone(appliedView);

    this.showSaveStatus('Changes applied');
  }

  // Shows a temporary status message after applying Editor changes.
  showSaveStatus(message) {
    const status = this.shadowRoot?.querySelector('#mssEditorSaveStatus');

    if (!status) {
      return;
    }

    status.textContent = message;
    status.classList.add('visible');

    window.clearTimeout(this.saveStatusTimeout);

    this.saveStatusTimeout = window.setTimeout(() => {
      status.classList.remove('visible');
    }, 1800);
  }

  // Restores the dashboard scrolling state captured when the Editor opened.
  restorePageScroll() {
    document.body.style.overflow = this.previousBodyOverflow;
  }

  // Restores dashboard scrolling if the Editor is removed unexpectedly.
  disconnectedCallback() {
    this.restorePageScroll();
  }

  // Resolves an overlay path from the current Home Assistant entity state.
  resolveMeasurementField(path) {
    if (!path) {
      return 'Unavailable';
    }

    return this._hass?.states?.[path]?.state ?? 'Unavailable';
  }

  // ============================================================
  // GENERIC CONDITION EVALUATOR
  // ============================================================
  //
  // Shared by:
  // - Overlay Status elements
  // - Shape conditional styling
  //
  // Keeps comparison behavior consistent across the editor.
  // ============================================================

  evaluateCondition({ currentValue, operator = 'equals', compareValue = '' }) {
    switch (operator) {
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

  // ============================================================
  // OVERLAY CONDITION
  // ============================================================

  evaluateOverlayCondition(element) {
    const currentValue = this.resolveOverlayElementValue(element);

    return this.evaluateCondition({
      currentValue,

      operator: element.operator ?? 'equals',

      compareValue: element.compareValue ?? '',
    });
  }

  // Creates a new overlay in the center of the current View.
  createOverlay() {
    const id = `mss-overlay-${Date.now()}`;

    const overlay = {
      id,
      name: 'New Overlay',
      pointerVisible: true,

      position: {
        x: 40,
        y: 40,
      },

      size: {
        width: 180,
        height: 90,
      },

      titleFontSize: 16,

      pointer: {
        x: 55,
        y: 55,
      },

      pointerSize: 10,

      referenceLineVisible: true,
      referenceLineThickness: 5,

      elements: [],
    };

    this.workingView.overlays = this.workingView.overlays ?? [];

    this.workingView.overlays.push(overlay);

    this.selectedOverlay = overlay;

    this.selectedOverlayElement = null;

    this.render();
  }

  // Moves one overlay before or after another.
  reorderOverlay(draggedId, targetId, placeAfter = false) {
    if (String(draggedId) === String(targetId)) {
      return false;
    }

    const overlays = this.workingView.overlays ?? [];

    const draggedIndex = overlays.findIndex(
      (overlay) => String(overlay.id) === String(draggedId)
    );

    if (draggedIndex < 0) {
      return false;
    }

    const [draggedOverlay] = overlays.splice(draggedIndex, 1);

    const targetIndex = overlays.findIndex(
      (overlay) => String(overlay.id) === String(targetId)
    );

    if (targetIndex < 0) {
      overlays.splice(draggedIndex, 0, draggedOverlay);

      return false;
    }

    const insertionIndex = placeAfter ? targetIndex + 1 : targetIndex;

    overlays.splice(insertionIndex, 0, draggedOverlay);

    return true;
  }

  reorderShape(draggedId, targetId, placeAfter = false) {
    if (String(draggedId) === String(targetId)) {
      return false;
    }

    const shapes = this.workingView.shapes ?? [];

    const draggedIndex = shapes.findIndex(
      (shape) => String(shape.id) === String(draggedId)
    );

    if (draggedIndex < 0) {
      return false;
    }

    const [draggedShape] = shapes.splice(draggedIndex, 1);

    const targetIndex = shapes.findIndex(
      (shape) => String(shape.id) === String(targetId)
    );

    if (targetIndex < 0) {
      shapes.splice(draggedIndex, 0, draggedShape);

      return false;
    }

    const insertionIndex = placeAfter ? targetIndex + 1 : targetIndex;

    shapes.splice(insertionIndex, 0, draggedShape);

    return true;
  }

  // Creates a copy of the selected overlay with new IDs.
  duplicateSelectedOverlay() {
    if (!this.selectedOverlay) {
      return;
    }

    const copy = structuredClone(this.selectedOverlay);

    const timestamp = Date.now();

    copy.id = `mss-overlay-${timestamp}`;

    copy.name = `${copy.name || 'Overlay'} Copy`;

    copy.position = {
      x: Math.min(100, Number(copy.position?.x ?? 40) + 5),
      y: Math.min(100, Number(copy.position?.y ?? 40) + 5),
    };

    copy.pointer = {
      x: Math.min(100, Number(copy.pointer?.x ?? 55) + 5),
      y: Math.min(100, Number(copy.pointer?.y ?? 55) + 5),
    };

    copy.elements = (copy.elements ?? []).map((element, index) => ({
      ...element,
      id: `mss-element-${timestamp}-${index}`,
    }));

    this.workingView.overlays = this.workingView.overlays ?? [];

    this.workingView.overlays.push(copy);

    this.selectedOverlay = copy;

    this.selectedOverlayElement = copy.elements?.[0] ?? null;

    this.render();
  }

  // Deletes the selected overlay after confirmation.
  deleteSelectedOverlay() {
    if (!this.selectedOverlay) {
      return;
    }

    const confirmed = window.confirm(
      `Delete "${this.selectedOverlay.name ?? 'Overlay'}"?`
    );

    if (!confirmed) {
      return;
    }

    const overlayId = this.selectedOverlay.id;

    this.workingView.overlays = (this.workingView.overlays ?? []).filter(
      (overlay) => String(overlay.id) !== String(overlayId)
    );

    this.removeOverlayFromCanvas(overlayId);

    this.selectedOverlay = null;
    this.selectedOverlayElement = null;
    this.updateOverlayActionButtons();
    this.updateCanvasSelection(null);
    this.renderPanels();
  }
  // Moves the selected element up or down inside its overlay.
  moveSelectedElement(direction) {
    if (!this.selectedOverlay || !this.selectedOverlayElement) {
      return;
    }

    const elements = this.selectedOverlay.elements ?? [];

    const currentIndex = elements.findIndex(
      (element) => String(element.id) === String(this.selectedOverlayElement.id)
    );

    if (currentIndex < 0) {
      return;
    }

    const nextIndex = currentIndex + direction;

    if (nextIndex < 0 || nextIndex >= elements.length) {
      return;
    }

    const [movedElement] = elements.splice(currentIndex, 1);

    elements.splice(nextIndex, 0, movedElement);

    this.refreshSelectedOverlayPreview();
    this.renderPanels();
  }

  // Creates a copy of the selected element with a new ID.
  duplicateSelectedElement() {
    if (!this.selectedOverlay || !this.selectedOverlayElement) {
      return;
    }

    const copy = structuredClone(this.selectedOverlayElement);

    copy.id = `mss-element-${Date.now()}`;

    copy.name = `${copy.name || 'Element'} Copy`;

    this.selectedOverlay.elements = this.selectedOverlay.elements ?? [];

    const index = this.selectedOverlay.elements.findIndex(
      (element) => String(element.id) === String(this.selectedOverlayElement.id)
    );

    this.selectedOverlay.elements.splice(index + 1, 0, copy);

    this.selectedOverlayElement = copy;

    this.refreshSelectedOverlayPreview();
    this.renderPanels();
  }

  // Moves one element before or after another without rebuilding the panel mid-drag.
  reorderElement(draggedId, targetId, placeAfter = false) {
    if (!this.selectedOverlay || String(draggedId) === String(targetId)) {
      return false;
    }

    const elements = this.selectedOverlay.elements ?? [];

    const draggedIndex = elements.findIndex(
      (element) => String(element.id) === String(draggedId)
    );

    if (draggedIndex < 0) {
      return false;
    }

    const [draggedElement] = elements.splice(draggedIndex, 1);

    const targetIndex = elements.findIndex(
      (element) => String(element.id) === String(targetId)
    );

    if (targetIndex < 0) {
      elements.splice(draggedIndex, 0, draggedElement);

      return false;
    }

    const insertionIndex = placeAfter ? targetIndex + 1 : targetIndex;

    elements.splice(insertionIndex, 0, draggedElement);

    return true;
  }

  // Creates a new text element inside the selected overlay.
  createElement() {
    if (!this.selectedOverlay) {
      return;
    }

    const element = {
      id: `mss-element-${Date.now()}`,
      name: 'New Element',
      path: '',
      fontSize: 14,
      elementType: 0,
    };

    this.selectedOverlay.elements = this.selectedOverlay.elements ?? [];

    this.selectedOverlay.elements.push(element);

    this.selectedOverlayElement = element;
    this.refreshSelectedOverlayPreview();

    this.renderPanels();
  }

  // Deletes the currently selected element from the selected overlay.
  deleteSelectedElement() {
    if (!this.selectedOverlay || !this.selectedOverlayElement) {
      return;
    }

    const elementId = this.selectedOverlayElement.id;

    this.selectedOverlay.elements = (
      this.selectedOverlay.elements ?? []
    ).filter((element) => String(element.id) !== String(elementId));

    this.selectedOverlayElement = this.selectedOverlay.elements[0] ?? null;

    this.refreshSelectedOverlayPreview();
    this.renderPanels();
  }

  selectOverlay(overlayId, shouldRender = true) {
    this.selectedOverlay =
      this.workingView?.overlays?.find(
        (overlay) => String(overlay.id) === String(overlayId)
      ) ?? null;

    this.selectedOverlayElement = this.selectedOverlay?.elements?.[0] ?? null;

    // Shapes and overlays are mutually exclusive.
    this.selectedShape = null;

    // Update action buttons immediately.
    this.updateOverlayActionButtons();
    this.updateShapeActionButtons();

    // Remove Shape selection styling.
    this.updateShapeSelection(null);

    if (shouldRender) {
      this.renderPanels();
    }
  }

  clearEditorSelection() {
    this.selectedOverlay = null;
    this.selectedOverlayElement = null;
    this.selectedShape = null;

    this.updateCanvasSelection(null);
    this.updateShapeSelection(null);

    this.updateOverlayActionButtons();
    this.updateShapeActionButtons();

    this.renderPanels();
  }

  bindEditorCanvasControls() {
    const gridButton = this.shadowRoot?.querySelector('#toggleEditorGrid');

    const zoomOut = this.shadowRoot?.querySelector('#editorZoomOut');

    const zoomReset = this.shadowRoot?.querySelector('#editorZoomReset');

    const zoomIn = this.shadowRoot?.querySelector('#editorZoomIn');

    const zoomWrapper = this.shadowRoot?.querySelector(
      '.mss-editor-stage-zoom'
    );

    const applyZoom = () => {
      if (!zoomWrapper) {
        return;
      }

      zoomWrapper.style.transform = `scale(${this.editorZoom})`;

      if (zoomReset) {
        zoomReset.textContent = `${Math.round(this.editorZoom * 100)}%`;
      }
    };

    if (gridButton) {
      gridButton.onclick = () => {
        this.gridEnabled = !this.gridEnabled;

        const stage = this.shadowRoot?.querySelector('.mss-editor-stage');

        stage?.classList.toggle('grid-enabled', this.gridEnabled);

        gridButton.classList.toggle('active', this.gridEnabled);
      };
    }

    if (zoomOut) {
      zoomOut.onclick = () => {
        this.editorZoom = Math.max(0.5, this.editorZoom - 0.1);

        applyZoom();
      };
    }

    if (zoomIn) {
      zoomIn.onclick = () => {
        this.editorZoom = Math.min(2, this.editorZoom + 0.1);

        applyZoom();
      };
    }

    if (zoomReset) {
      zoomReset.onclick = () => {
        this.editorZoom = 1;

        applyZoom();
      };
    }

    applyZoom();
  }

  // Updates the visible overlay position fields while dragging.
  updatePositionInputs(overlay) {
    const xInput = this.shadowRoot?.querySelector('#editorOverlayX');

    const yInput = this.shadowRoot?.querySelector('#editorOverlayY');

    if (xInput) {
      xInput.value = Number(overlay.position?.x ?? 0).toFixed(2);
    }

    if (yInput) {
      yInput.value = Number(overlay.position?.y ?? 0).toFixed(2);
    }
  }

  // Updates canvas selection classes without rebuilding the Editor.
  updateCanvasSelection(overlayId) {
    this.shadowRoot
      ?.querySelectorAll('.editor-callout, .editor-point')
      .forEach((element) => {
        element.classList.remove('selected');
      });

    const callout = this.shadowRoot?.querySelector(
      `.editor-callout[data-overlay="${overlayId}"]`
    );

    const pointer = this.shadowRoot?.querySelector(
      `[data-overlay-pointer="${overlayId}"]`
    );

    callout?.classList.add('selected');
    pointer?.classList.add('selected');
  }

  // ============================================================
  // SHAPE SELECTION
  // ============================================================

  // Selects one Shape without rebuilding the canvas.
  selectShape(shapeId, shouldRenderPanels = true) {
    const shape =
      this.workingView?.shapes?.find(
        (item) => String(item.id) === String(shapeId)
      ) ?? null;

    if (!shape) {
      return;
    }

    this.selectedShape = shape;

    // Shapes and overlays are mutually exclusive.
    this.selectedOverlay = null;
    this.selectedOverlayElement = null;

    // Remove Overlay selection from the canvas.
    this.updateCanvasSelection(null);

    this.updateShapeSelection(shape.id);

    // Enable Duplicate / Delete immediately.
    this.updateShapeActionButtons();
    this.updateOverlayActionButtons();

    if (shouldRenderPanels) {
      this.renderPanels();
    }
  }

  // Updates Shape selection classes without rebuilding the editor.
  updateShapeSelection(shapeId) {
    // ==========================================================
    // CANVAS SHAPES
    // ==========================================================

    this.shadowRoot
      ?.querySelectorAll('.editor-shape[data-shape]')
      .forEach((element) => {
        const selected = String(element.dataset.shape) === String(shapeId);

        element.classList.toggle('selected', selected);
      });

    // ==========================================================
    // LEFT SIDEBAR SHAPE LIST
    // ==========================================================

    this.shadowRoot
      ?.querySelectorAll('[data-editor-shape]')
      .forEach((element) => {
        const selected =
          String(element.dataset.editorShape) === String(shapeId);

        element.classList.toggle('selected', selected);
      });
  }

  // Updates the enabled state of Shape action buttons
  // without rebuilding the sidebars or canvas.
  updateShapeActionButtons() {
    const duplicateButton = this.shadowRoot?.querySelector(
      '#duplicateSelectedShape'
    );

    const deleteButton = this.shadowRoot?.querySelector('#deleteSelectedShape');

    const disabled = !this.selectedShape;

    if (duplicateButton) {
      duplicateButton.disabled = disabled;
    }

    if (deleteButton) {
      deleteButton.disabled = disabled;
    }
  }

  updateOverlayActionButtons() {
    const duplicateButton = this.shadowRoot?.querySelector(
      '#duplicateMssOverlay'
    );

    const deleteButton = this.shadowRoot?.querySelector('#deleteMssOverlay');

    const disabled = !this.selectedOverlay;

    if (duplicateButton) {
      duplicateButton.disabled = disabled;
    }

    if (deleteButton) {
      deleteButton.disabled = disabled;
    }
  }

  // Creates a copy of the selected Shape.
  duplicateSelectedShape() {
    if (!this.selectedShape) {
      return;
    }

    const copy = structuredClone(this.selectedShape);

    const timestamp = Date.now();

    copy.id = `mss-shape-${timestamp}`;

    copy.name = `${copy.name || 'Shape'} Copy`;

    if (copy.type === 'line' || copy.type === 'arrow') {
      copy.start = {
        x: Math.min(100, Number(copy.start?.x ?? 30) + 5),

        y: Math.min(100, Number(copy.start?.y ?? 30) + 5),
      };

      copy.end = {
        x: Math.min(100, Number(copy.end?.x ?? 55) + 5),

        y: Math.min(100, Number(copy.end?.y ?? 30) + 5),
      };
    } else {
      copy.position = {
        x: Math.min(100, Number(copy.position?.x ?? 30) + 5),

        y: Math.min(100, Number(copy.position?.y ?? 30) + 5),
      };
    }

    // Runtime-only MQTT image data must not be copied.
    if (copy.type === 'image') {
      copy.liveImageUrl = '';
    }

    this.workingView.shapes = this.workingView.shapes ?? [];

    this.workingView.shapes.push(copy);

    this.selectedShape = copy;

    this.selectedOverlay = null;

    this.selectedOverlayElement = null;

    this.render();

    this.viewDirty = true;
  }

  // Deletes the selected Shape after confirmation.
  deleteSelectedShape() {
    if (!this.selectedShape) {
      return;
    }

    const confirmed = window.confirm(
      `Delete "${this.selectedShape.name ?? 'Shape'}"?`
    );

    if (!confirmed) {
      return;
    }

    const shapeId = this.selectedShape.id;

    this.workingView.shapes = (this.workingView.shapes ?? []).filter(
      (shape) => String(shape.id) !== String(shapeId)
    );

    this.selectedShape = null;

    this.updateShapeSelection(null);

    this.render();

    this.viewDirty = true;
  }

  createRectangleShape() {
    const shapes = this.workingView.shapes ?? [];

    const rectangleCount = shapes.filter(
      (shape) => shape.type === 'rectangle'
    ).length;

    const shape = {
      id: `mss-shape-${Date.now()}`,

      type: 'rectangle',

      name: `Rectangle ${rectangleCount + 1}`,

      position: {
        x: 30,
        y: 30,
      },

      size: {
        width: 20,
        height: 15,
      },

      color: '#00a586',

      borderColor: '#000000',

      borderWidth: 0,

      borderRadius: 0,

      opacity: 1,

      conditionalStyle: {
        enabled: false,

        mssGroup: '',
        dataPath: '',

        operator: 'equals',
        compareValue: '',

        color: '#00a586',
      },
    };

    this.workingView.shapes = this.workingView.shapes ?? [];

    this.workingView.shapes.push(shape);

    this.selectedShape = shape;
    this.selectedOverlay = null;

    this.render();

    this.viewDirty = true;
  }

  createCircleShape() {
    const shapes = this.workingView.shapes ?? [];

    const circleCount = shapes.filter(
      (shape) => shape.type === 'circle'
    ).length;

    const stage = this.shadowRoot?.querySelector('.mss-editor-stage');

    const stageRect = stage?.getBoundingClientRect();

    const initialWidth = 15;

    let initialHeight = 15;

    if (stageRect?.width > 0 && stageRect?.height > 0) {
      const diameterPixels = (initialWidth / 100) * stageRect.width;

      initialHeight = (diameterPixels / stageRect.height) * 100;
    }

    const shape = {
      id: `mss-shape-${Date.now()}`,

      type: 'circle',

      name: `Circle ${circleCount + 1}`,

      position: {
        x: 30,
        y: 30,
      },

      size: {
        width: initialWidth,
        height: initialHeight,
      },

      color: '#00a586',

      borderColor: '#000000',

      borderWidth: 0,

      opacity: 1,

      conditionalStyle: {
        enabled: false,

        mssGroup: '',
        dataPath: '',

        operator: 'equals',
        compareValue: '',

        color: '#00a586',
      },
    };

    this.workingView.shapes = this.workingView.shapes ?? [];

    this.workingView.shapes.push(shape);

    this.selectedShape = shape;

    this.selectedOverlay = null;

    this.selectedOverlayElement = null;

    this.render();

    this.viewDirty = true;
  }

  createLineShape() {
    const shapes = this.workingView.shapes ?? [];

    const lineCount = shapes.filter((shape) => shape.type === 'line').length;

    const shape = {
      id: `mss-shape-${Date.now()}`,

      type: 'line',

      name: `Line ${lineCount + 1}`,

      start: {
        x: 30,
        y: 30,
      },

      end: {
        x: 55,
        y: 30,
      },

      color: '#00a586',

      strokeWidth: 3,

      opacity: 1,

      conditionalStyle: {
        enabled: false,

        mssGroup: '',
        dataPath: '',

        operator: 'equals',
        compareValue: '',

        color: '#00a586',
      },
    };

    this.workingView.shapes = this.workingView.shapes ?? [];

    this.workingView.shapes.push(shape);

    this.selectedShape = shape;

    this.selectedOverlay = null;

    this.selectedOverlayElement = null;

    this.render();

    this.viewDirty = true;
  }

  createArrowShape() {
    const shapes = this.workingView.shapes ?? [];

    const arrowCount = shapes.filter((shape) => shape.type === 'arrow').length;

    const shape = {
      id: `mss-shape-${Date.now()}`,

      type: 'arrow',

      name: `Arrow ${arrowCount + 1}`,

      start: {
        x: 30,
        y: 30,
      },

      end: {
        x: 55,
        y: 30,
      },

      color: '#00a586',

      strokeWidth: 3,

      arrowHeadSize: 12,

      opacity: 1,

      conditionalStyle: {
        enabled: false,
        mssGroup: '',
        dataPath: '',
        operator: 'equals',
        compareValue: '',
        color: '#00a586',
      },
    };

    this.workingView.shapes = this.workingView.shapes ?? [];

    this.workingView.shapes.push(shape);

    this.selectedShape = shape;

    this.selectedOverlay = null;

    this.selectedOverlayElement = null;

    this.render();

    this.viewDirty = true;
  }

  createTextShape() {
    const shapes = this.workingView.shapes ?? [];

    const textCount = shapes.filter((shape) => shape.type === 'text').length;

    const shape = {
      id: `mss-shape-${Date.now()}`,

      type: 'text',

      name: `Text ${textCount + 1}`,

      text: 'Text',

      position: {
        x: 30,
        y: 30,
      },

      size: {
        width: 20,
        height: 10,
      },

      color: '#ffffff',

      fontSize: 16,

      fontWeight: 400,

      textAlign: 'left',

      opacity: 1,

      conditionalStyle: {
        enabled: false,
        mssGroup: '',
        dataPath: '',
        operator: 'equals',
        compareValue: '',
        color: '#00a586',
      },
    };

    this.workingView.shapes = this.workingView.shapes ?? [];

    this.workingView.shapes.push(shape);

    this.selectedShape = shape;

    this.selectedOverlay = null;

    this.selectedOverlayElement = null;

    this.render();

    this.viewDirty = true;
  }

  bindArrowShapeEvent() {
    const button = this.shadowRoot?.querySelector('#addArrowShape');

    if (!button) {
      return;
    }

    button.onclick = () => {
      this.createArrowShape();
    };
  }

  bindArrowShapePropertiesEvents() {
    const shape = this.selectedShape;

    if (!shape || shape.type !== 'arrow') {
      return;
    }

    const color = this.shadowRoot?.querySelector('#editorArrowColor');

    const strokeWidth = this.shadowRoot?.querySelector(
      '#editorArrowStrokeWidth'
    );

    const arrowHeadSize = this.shadowRoot?.querySelector(
      '#editorArrowHeadSize'
    );

    const opacity = this.shadowRoot?.querySelector('#editorArrowOpacity');

    if (color) {
      color.oninput = () => {
        shape.color = color.value;

        this.updateSelectedLinePreview();
      };
    }

    if (strokeWidth) {
      strokeWidth.oninput = () => {
        shape.strokeWidth = Math.max(
          1,
          Math.min(30, Number(strokeWidth.value) || 1)
        );

        this.updateSelectedLinePreview();
      };
    }

    if (arrowHeadSize) {
      arrowHeadSize.oninput = () => {
        shape.arrowHeadSize = Math.max(
          4,
          Math.min(40, Number(arrowHeadSize.value) || 12)
        );

        this.updateSelectedLinePreview();
      };
    }

    if (opacity) {
      opacity.oninput = () => {
        shape.opacity = Math.max(0, Math.min(1, Number(opacity.value)));

        this.updateSelectedLinePreview();
      };
    }

    this.bindShapeConditionalColorEvents(shape, {
      updatePreview: () => this.updateSelectedLinePreview(),
    });
  }

  renderArrowShapeProperties() {
    const shape = this.selectedShape;

    if (!shape || shape.type !== 'arrow') {
      return '';
    }

    return `
    <details
      class="mss-editor-property-group"
      data-editor-section="arrow-shape"
      open>

      <summary class="mss-editor-summary-row">
        <span>Arrow</span>
      </summary>

      <div class="mss-editor-property-content">

        <label class="mss-editor-field">
          <span>Stroke color</span>

          <input
            id="editorArrowColor"
            class="mss-editor-color-input"
            type="color"
            value="${shape.color ?? '#00a586'}">
        </label>

        <label class="mss-editor-field">
          <span>Stroke width</span>

          <input
            id="editorArrowStrokeWidth"
            class="mss-editor-input"
            type="number"
            min="1"
            max="30"
            step="1"
            value="${Number(shape.strokeWidth ?? 3)}">
        </label>

        <label class="mss-editor-field">
          <span>Arrowhead size</span>

          <input
            id="editorArrowHeadSize"
            class="mss-editor-input"
            type="number"
            min="4"
            max="40"
            step="1"
            value="${Number(shape.arrowHeadSize ?? 12)}">
        </label>

        <label class="mss-editor-field">
          <span>Opacity</span>

          <input
            id="editorArrowOpacity"
            class="mss-editor-input"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value="${Number(shape.opacity ?? 1)}">
        </label>

        ${this.renderShapeConditionalColorProperties(shape, {
          toggleLabel: 'Conditional stroke',

          colorLabel: 'Conditional stroke color',
        })}

      </div>

    </details>
  `;
  }

  bindRectangleShapeEvent() {
    const button = this.shadowRoot?.querySelector('#addRectangleShape');

    if (!button) {
      return;
    }

    button.onclick = () => {
      this.createRectangleShape();
    };
  }

  bindCircleShapeEvent() {
    const button = this.shadowRoot?.querySelector('#addCircleShape');

    if (!button) {
      return;
    }

    button.onclick = () => {
      this.createCircleShape();
    };
  }

  bindCircleShapePropertiesEvents() {
    const shape = this.selectedShape;

    if (!shape || shape.type !== 'circle') {
      return;
    }

    const fillColor = this.shadowRoot?.querySelector('#editorCircleFillColor');

    const borderColor = this.shadowRoot?.querySelector(
      '#editorCircleBorderColor'
    );

    const borderWidth = this.shadowRoot?.querySelector(
      '#editorCircleBorderWidth'
    );

    const opacity = this.shadowRoot?.querySelector('#editorCircleOpacity');

    const fillTransparent = this.shadowRoot?.querySelector(
      '#editorCircleFillTransparent'
    );

    if (fillColor) {
      fillColor.oninput = () => {
        shape.color = fillColor.value;

        this.updateSelectedCirclePreview();
      };
    }

    if (borderColor) {
      borderColor.oninput = () => {
        shape.borderColor = borderColor.value;

        this.updateSelectedCirclePreview();
      };
    }

    if (borderWidth) {
      borderWidth.oninput = () => {
        shape.borderWidth = Math.max(
          0,
          Math.min(20, Number(borderWidth.value) || 0)
        );

        this.updateSelectedCirclePreview();
      };
    }

    if (fillTransparent) {
      fillTransparent.onchange = () => {
        shape.fillTransparent = fillTransparent.checked;

        if (fillColor) {
          fillColor.disabled = shape.fillTransparent;
        }

        this.updateSelectedCirclePreview();
      };
    }
    if (opacity) {
      opacity.oninput = () => {
        shape.opacity = Math.max(0, Math.min(1, Number(opacity.value)));

        this.updateSelectedCirclePreview();
      };
    }

    this.bindShapeConditionalColorEvents(shape, {
      updatePreview: () => this.updateSelectedCirclePreview(),
    });
  }

  bindLineShapeEvent() {
    const button = this.shadowRoot?.querySelector('#addLineShape');

    if (!button) {
      return;
    }

    button.onclick = () => {
      this.createLineShape();
    };
  }

  bindLineShapePropertiesEvents() {
    const shape = this.selectedShape;

    if (!shape || shape.type !== 'line') {
      return;
    }

    const color = this.shadowRoot?.querySelector('#editorLineColor');

    const strokeWidth = this.shadowRoot?.querySelector(
      '#editorLineStrokeWidth'
    );

    const opacity = this.shadowRoot?.querySelector('#editorLineOpacity');

    if (color) {
      color.oninput = () => {
        shape.color = color.value;

        this.updateSelectedLinePreview();
      };
    }

    if (strokeWidth) {
      strokeWidth.oninput = () => {
        shape.strokeWidth = Math.max(
          1,
          Math.min(30, Number(strokeWidth.value) || 1)
        );

        this.updateSelectedLinePreview();
      };
    }

    if (opacity) {
      opacity.oninput = () => {
        shape.opacity = Math.max(0, Math.min(1, Number(opacity.value)));

        this.updateSelectedLinePreview();
      };
    }

    this.bindShapeConditionalColorEvents(shape, {
      updatePreview: () => this.updateSelectedLinePreview(),
    });
  }

  bindLineEndpointEvents() {
    this.shadowRoot
      ?.querySelectorAll('.mss-line-endpoint-handle[data-line-endpoint]')
      .forEach((handle) => {
        const shapeId = handle.dataset.shape;

        const endpoint = handle.dataset.lineEndpoint;

        const shape = this.workingView?.shapes?.find(
          (item) => String(item.id) === String(shapeId)
        );

        const stage = this.shadowRoot?.querySelector('.mss-editor-stage');

        if (!shape || !stage || !['line', 'arrow'].includes(shape.type)) {
          return;
        }

        handle.onpointerdown = (event) => {
          if (event.button !== undefined && event.button !== 0) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();

          this.selectShape(shape.id, false);

          const stageRect = stage.getBoundingClientRect();

          if (stageRect.width <= 0 || stageRect.height <= 0) {
            return;
          }

          try {
            handle.setPointerCapture(event.pointerId);
          } catch {}

          const handleMove = (moveEvent) => {
            if (moveEvent.pointerId !== event.pointerId) {
              return;
            }

            moveEvent.preventDefault();
            moveEvent.stopPropagation();

            const x = Math.max(
              0,
              Math.min(
                100,
                ((moveEvent.clientX - stageRect.left) / stageRect.width) * 100
              )
            );

            const y = Math.max(
              0,
              Math.min(
                100,
                ((moveEvent.clientY - stageRect.top) / stageRect.height) * 100
              )
            );

            shape[endpoint] = {
              x,
              y,
            };

            this.updateSelectedLinePreview();
          };

          const handleEnd = (endEvent) => {
            if (endEvent.pointerId !== event.pointerId) {
              return;
            }

            handle.removeEventListener('pointermove', handleMove);

            handle.removeEventListener('pointerup', handleEnd);

            handle.removeEventListener('pointercancel', handleEnd);

            try {
              if (handle.hasPointerCapture(event.pointerId)) {
                handle.releasePointerCapture(event.pointerId);
              }
            } catch {}

            this.viewDirty = true;
          };

          handle.addEventListener('pointermove', handleMove);

          handle.addEventListener('pointerup', handleEnd);

          handle.addEventListener('pointercancel', handleEnd);
        };
      });
  }

  bindLineBodyDragEvents() {
    this.shadowRoot
      ?.querySelectorAll(
        '.editor-shape.mss-shape-line[data-shape], ' +
          '.editor-shape.mss-shape-arrow[data-shape]'
      )
      .forEach((element) => {
        const shapeId = element.dataset.shape;

        const shape = this.workingView?.shapes?.find(
          (item) => String(item.id) === String(shapeId)
        );

        const stage = this.shadowRoot?.querySelector('.mss-editor-stage');

        if (!shape || !stage || !['line', 'arrow'].includes(shape.type)) {
          return;
        }

        element.onpointerdown = (event) => {
          // Endpoint handles have their own drag behavior.
          if (event.target.closest?.('.mss-line-endpoint-handle')) {
            return;
          }

          // Primary mouse button only.
          if (event.button !== undefined && event.button !== 0) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();

          this.selectShape(shape.id, false);

          const stageRect = stage.getBoundingClientRect();

          if (stageRect.width <= 0 || stageRect.height <= 0) {
            return;
          }

          const startMouseX = event.clientX;

          const startMouseY = event.clientY;

          const initialStart = {
            x: Number(shape.start?.x ?? 30),

            y: Number(shape.start?.y ?? 30),
          };

          const initialEnd = {
            x: Number(shape.end?.x ?? 55),

            y: Number(shape.end?.y ?? 30),
          };

          // ======================================================
          // MOVEMENT BOUNDS
          // ======================================================
          //
          // Both endpoints must remain inside the stage.
          //
          // Example:
          //
          // start.x = 20
          // end.x   = 60
          //
          // Maximum left movement  = -20
          // Maximum right movement = +40
          // ======================================================

          const minDeltaX = -Math.min(initialStart.x, initialEnd.x);

          const maxDeltaX = 100 - Math.max(initialStart.x, initialEnd.x);

          const minDeltaY = -Math.min(initialStart.y, initialEnd.y);

          const maxDeltaY = 100 - Math.max(initialStart.y, initialEnd.y);

          try {
            element.setPointerCapture(event.pointerId);
          } catch {}

          element.classList.add('dragging');

          const handleMove = (moveEvent) => {
            if (moveEvent.pointerId !== event.pointerId) {
              return;
            }

            moveEvent.preventDefault();
            moveEvent.stopPropagation();

            let deltaX =
              ((moveEvent.clientX - startMouseX) / stageRect.width) * 100;

            let deltaY =
              ((moveEvent.clientY - startMouseY) / stageRect.height) * 100;

            deltaX = Math.max(minDeltaX, Math.min(maxDeltaX, deltaX));

            deltaY = Math.max(minDeltaY, Math.min(maxDeltaY, deltaY));

            shape.start = {
              x: initialStart.x + deltaX,

              y: initialStart.y + deltaY,
            };

            shape.end = {
              x: initialEnd.x + deltaX,

              y: initialEnd.y + deltaY,
            };

            this.updateSelectedLinePreview();
          };

          const handleEnd = (endEvent) => {
            if (endEvent.pointerId !== event.pointerId) {
              return;
            }

            element.removeEventListener('pointermove', handleMove);

            element.removeEventListener('pointerup', handleEnd);

            element.removeEventListener('pointercancel', handleEnd);

            try {
              if (element.hasPointerCapture(event.pointerId)) {
                element.releasePointerCapture(event.pointerId);
              }
            } catch {}

            element.classList.remove('dragging');

            this.viewDirty = true;
          };

          element.addEventListener('pointermove', handleMove);

          element.addEventListener('pointerup', handleEnd);

          element.addEventListener('pointercancel', handleEnd);
        };
      });
  }

  updateSelectedLinePreview() {
    const shape = this.selectedShape;

    if (!shape || !['line', 'arrow'].includes(shape.type)) {
      return;
    }

    const element = this.shadowRoot?.querySelector(
      `.editor-shape[data-shape="${shape.id}"]`
    );

    if (!element) {
      return;
    }

    const start = shape.start ?? {
      x: 30,
      y: 30,
    };

    const end = shape.end ?? {
      x: 55,
      y: 30,
    };

    const stage = this.shadowRoot?.querySelector('.mss-editor-stage');

    const stageRect = stage?.getBoundingClientRect();

    let angle = 0;

    if (stageRect?.width > 0 && stageRect?.height > 0) {
      const dx = ((end.x - start.x) / 100) * stageRect.width;

      const dy = ((end.y - start.y) / 100) * stageRect.height;

      angle = Math.atan2(dy, dx) * (180 / Math.PI);
    }

    // ==========================================================
    // BOUNDING BOX
    // ==========================================================

    const minX = Math.min(start.x, end.x);

    const minY = Math.min(start.y, end.y);

    const maxX = Math.max(start.x, end.x);

    const maxY = Math.max(start.y, end.y);

    const width = Math.max(maxX - minX, 0.01);

    const height = Math.max(maxY - minY, 0.01);

    // ==========================================================
    // LOCAL SVG COORDINATES
    // ==========================================================

    const x1 = ((start.x - minX) / width) * 100;

    const y1 = ((start.y - minY) / height) * 100;

    const x2 = ((end.x - minX) / width) * 100;

    const y2 = ((end.y - minY) / height) * 100;

    // ==========================================================
    // UPDATE SHAPE BOUNDS
    // ==========================================================

    element.style.left = `${minX}%`;

    element.style.top = `${minY}%`;

    element.style.width = `${width}%`;

    element.style.height = `${height}%`;

    // ==========================================================
    // UPDATE SVG LINE
    // ==========================================================

    const line = element.querySelector('.mss-shape-line-content');

    if (line) {
      line.setAttribute('x1', String(x1));

      line.setAttribute('y1', String(y1));

      line.setAttribute('x2', String(x2));

      line.setAttribute('y2', String(y2));

      line.setAttribute('stroke', this.resolveShapeColor(shape));

      line.setAttribute('stroke-width', String(Number(shape.strokeWidth ?? 3)));

      line.setAttribute('opacity', String(Number(shape.opacity ?? 1)));
    }

    const arrowHead = element.querySelector('.mss-arrow-head');

    if (arrowHead && shape.type === 'arrow') {
      const size = Number(shape.arrowHeadSize ?? 12);

      arrowHead.style.left = `${x2}%`;

      arrowHead.style.top = `${y2}%`;

      arrowHead.style.borderTopWidth = `${size / 2}px`;

      arrowHead.style.borderBottomWidth = `${size / 2}px`;

      arrowHead.style.borderLeftWidth = `${size}px`;

      arrowHead.style.borderLeftColor = this.resolveShapeColor(shape);

      arrowHead.style.opacity = String(Number(shape.opacity ?? 1));

      arrowHead.style.transform = `translateY(-50%) rotate(${angle}deg)`;
    }

    // ==========================================================
    // UPDATE ENDPOINT HANDLES
    // ==========================================================

    const startHandle = element.querySelector('[data-line-endpoint="start"]');

    const endHandle = element.querySelector('[data-line-endpoint="end"]');

    if (startHandle) {
      startHandle.style.left = `${x1}%`;

      startHandle.style.top = `${y1}%`;
    }

    if (endHandle) {
      endHandle.style.left = `${x2}%`;

      endHandle.style.top = `${y2}%`;
    }

    this.viewDirty = true;
  }

  renderLineShapeProperties() {
    const shape = this.selectedShape;

    if (!shape || shape.type !== 'line') {
      return '';
    }

    return `
    <details
      class="mss-editor-property-group"
      data-editor-section="line-shape"
      open>

      <summary
        class="mss-editor-summary-row">

        <span>Line</span>

      </summary>

      <div
        class="mss-editor-property-content">

        <label class="mss-editor-field">
          <span>Stroke color</span>

          <input
            id="editorLineColor"
            class="mss-editor-color-input"
            type="color"
            value="${shape.color ?? '#00a586'}">
        </label>

        <label class="mss-editor-field">
          <span>Stroke width</span>

          <input
            id="editorLineStrokeWidth"
            class="mss-editor-input"
            type="number"
            min="1"
            max="30"
            step="1"
            value="${Number(shape.strokeWidth ?? 3)}">
        </label>


        <label class="mss-editor-field">
          <span>Opacity</span>

          <input
            id="editorLineOpacity"
            class="mss-editor-input"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value="${Number(shape.opacity ?? 1)}">
        </label>

        ${this.renderShapeConditionalColorProperties(shape, {
          toggleLabel: 'Conditional stroke',

          colorLabel: 'Conditional stroke color',
        })}

      </div>

    </details>
  `;
  }

  updateSelectedCirclePreview() {
    const shape = this.selectedShape;

    if (!shape || shape.type !== 'circle') {
      return;
    }

    const element = this.shadowRoot?.querySelector(
      `.editor-shape[data-shape="${shape.id}"]`
    );

    if (!element) {
      return;
    }

    element.style.background = shape.fillTransparent
      ? 'transparent'
      : this.resolveShapeColor(shape);

    element.style.border = `${Number(shape.borderWidth ?? 0)}px solid ${
      shape.borderColor ?? '#000000'
    }`;

    element.style.opacity = String(Number(shape.opacity ?? 1));

    this.viewDirty = true;
  }

  bindRectangleShapePropertiesEvents() {
    const shape = this.selectedShape;

    if (!shape || shape.type !== 'rectangle') {
      return;
    }

    const fillColor = this.shadowRoot?.querySelector(
      '#editorRectangleFillColor'
    );

    const borderColor = this.shadowRoot?.querySelector(
      '#editorRectangleBorderColor'
    );

    const borderWidth = this.shadowRoot?.querySelector(
      '#editorRectangleBorderWidth'
    );

    const borderRadius = this.shadowRoot?.querySelector(
      '#editorRectangleBorderRadius'
    );

    const opacity = this.shadowRoot?.querySelector('#editorRectangleOpacity');

    const fillTransparent = this.shadowRoot?.querySelector(
      '#editorRectangleFillTransparent'
    );

    if (fillColor) {
      fillColor.oninput = () => {
        shape.color = fillColor.value;

        this.updateSelectedRectanglePreview();
      };
    }

    if (borderColor) {
      borderColor.oninput = () => {
        shape.borderColor = borderColor.value;

        this.updateSelectedRectanglePreview();
      };
    }

    if (borderWidth) {
      borderWidth.oninput = () => {
        shape.borderWidth = Math.max(
          0,
          Math.min(20, Number(borderWidth.value) || 0)
        );

        this.updateSelectedRectanglePreview();
      };
    }

    if (borderRadius) {
      borderRadius.oninput = () => {
        shape.borderRadius = Math.max(
          0,
          Math.min(100, Number(borderRadius.value) || 0)
        );

        this.updateSelectedRectanglePreview();
      };
    }

    if (opacity) {
      opacity.oninput = () => {
        shape.opacity = Math.max(0, Math.min(1, Number(opacity.value)));

        this.updateSelectedRectanglePreview();
      };
    }

    if (fillTransparent) {
      fillTransparent.onchange = () => {
        shape.fillTransparent = fillTransparent.checked;

        if (fillColor) {
          fillColor.disabled = shape.fillTransparent;
        }

        this.updateSelectedRectanglePreview();
      };
    }

    // Generic MSS-driven color behavior.
    this.bindShapeConditionalColorEvents(shape, {
      updatePreview: () => this.updateSelectedRectanglePreview(),
    });
  }

  updateSelectedRectanglePreview() {
    const shape = this.selectedShape;

    if (!shape || shape.type !== 'rectangle') {
      return;
    }

    const element = this.shadowRoot?.querySelector(
      `.editor-shape[data-shape="${shape.id}"]`
    );

    if (!element) {
      return;
    }

    element.style.background = shape.fillTransparent
      ? 'transparent'
      : this.resolveShapeColor(shape);

    element.style.border = `${Number(shape.borderWidth ?? 0)}px solid ${
      shape.borderColor ?? '#000000'
    }`;

    element.style.borderRadius = `${Number(shape.borderRadius ?? 0)}px`;

    element.style.opacity = String(Number(shape.opacity ?? 1));

    this.viewDirty = true;
  }

  createImageShape() {
    const shapes = this.workingView.shapes ?? [];

    const imageCount = shapes.filter((shape) => shape.type === 'image').length;

    const shape = {
      id: `mss-shape-${Date.now()}`,

      type: 'image',

      name: `Image ${imageCount + 1}`,

      position: {
        x: 30,
        y: 30,
      },

      size: {
        width: 30,
        height: 20,
      },

      imageSource: 'mqtt',

      bindingMode: 'exact',

      mssGroup: '',
      dataPath: '',

      groupPattern: '',
      pathPattern: '',

      imageUrl: '',
      liveImageUrl: '',

      fit: 'contain',
    };

    this.workingView.shapes = this.workingView.shapes ?? [];

    this.workingView.shapes.push(shape);

    this.selectedShape = shape;
    this.selectedOverlay = null;

    this.render();

    this.viewDirty = true;
  }

  bindImageShapeEvent() {
    const button = this.shadowRoot?.querySelector('#addImageShape');

    if (!button) {
      return;
    }

    button.onclick = () => {
      this.createImageShape();
    };
  }

  bindImageShapePropertiesEvents() {
    const shape = this.selectedShape;

    if (!shape || shape.type !== 'image') {
      return;
    }

    const source = this.shadowRoot?.querySelector('#editorImageShapeSource');

    const group = this.shadowRoot?.querySelector('#editorImageShapeMssGroup');

    const dataPath = this.shadowRoot?.querySelector(
      '#editorImageShapeDataPath'
    );

    const fit = this.shadowRoot?.querySelector('#editorImageShapeFit');

    const url = this.shadowRoot?.querySelector('#editorImageShapeUrl');

    const bindingMode = this.shadowRoot?.querySelector(
      '#editorImageShapeBindingMode'
    );

    const groupPattern = this.shadowRoot?.querySelector(
      '#editorImageShapeGroupPattern'
    );

    const pathPattern = this.shadowRoot?.querySelector(
      '#editorImageShapePathPattern'
    );

    const browse = this.shadowRoot?.querySelector('#editorImageShapeBrowse');

    const fileInput = this.shadowRoot?.querySelector('#editorImageShapeFile');

    const remove = this.shadowRoot?.querySelector('#editorImageShapeRemove');

    const media = this.shadowRoot?.querySelector('#editorImageShapeMedia');
    // ========================================================
    // IMAGE SOURCE
    // ========================================================

    if (source) {
      source.onchange = async () => {
        shape.imageSource = source.value;

        /*
         * liveImageUrl is runtime-only MQTT data.
         * Clear it whenever the source changes.
         */
        shape.liveImageUrl = '';

        /*
         * Keep both configurations stored:
         *
         * Local:
         *   shape.imageUrl
         *
         * MQTT:
         *   shape.mssGroup
         *   shape.dataPath
         *   shape.groupPattern
         *   shape.pathPattern
         *
         * This allows the user to switch between Local and MQTT
         * without losing their previous selections.
         */
        if (shape.imageSource === 'mqtt') {
          await this.loadAvailableMssImages();

          /*
           * Restore the MQTT image immediately if the shape
           * already has a configured binding.
           */
          await hydrateMssViewImages(this._hass, this.workingView);
        }

        this.render();
      };
    }

    // ========================================================
    // MSS SOURCE
    // ========================================================

    if (group) {
      group.onchange = async () => {
        shape.mssGroup = group.value;

        // Changing the MSS source invalidates the previously
        // selected image field.
        shape.dataPath = '';
        shape.liveImageUrl = '';

        await this.loadAvailableMssImages();

        this.render();
      };
    }

    // ========================================================
    // MQTT IMAGE FIELD
    // ========================================================

    if (dataPath) {
      dataPath.onchange = async () => {
        shape.dataPath = dataPath.value;
        shape.liveImageUrl = '';

        if (shape.dataPath) {
          await this.loadImageShapeData(shape);
        }

        this.render();
      };
    }

    // ========================================================
    // IMAGE FIT
    // ========================================================

    if (fit) {
      fit.onchange = () => {
        shape.fit = fit.value;

        this.render();
      };
    }

    if (bindingMode) {
      bindingMode.onchange = async () => {
        shape.bindingMode = bindingMode.value;

        shape.liveImageUrl = '';

        if (shape.bindingMode === 'dynamic') {
          if (!shape.groupPattern && shape.mssGroup) {
            shape.groupPattern = shape.mssGroup;
          }

          if (!shape.pathPattern && shape.dataPath) {
            shape.pathPattern = this.createAutoRoutingWildcard(
              shape.dataPath,
              shape.mssGroup
            );
          }
        }

        await hydrateMssViewImages(this._hass, this.workingView);

        this.render();
      };
    }

    if (groupPattern) {
      groupPattern.onchange = async () => {
        shape.groupPattern = groupPattern.value;

        await hydrateMssViewImages(this._hass, this.workingView);

        this.render();
      };
    }

    if (pathPattern) {
      pathPattern.onchange = async () => {
        shape.pathPattern = pathPattern.value;

        await hydrateMssViewImages(this._hass, this.workingView);

        this.render();
      };
    }

    if (remove) {
      remove.onclick = () => {
        shape.imageUrl = '';

        shape.mediaContentId = '';
        shape.mediaContentType = '';
        shape.mediaTitle = '';

        shape.liveImageUrl = '';

        this.localImageUploadState = {
          shapeId: shape.id,
          uploading: false,
          error: '',
        };

        this.viewDirty = true;

        this.render();
      };
    }

    // ==========================================================
    // LOCAL IMAGE BROWSE
    // ==========================================================

    if (media) {
      media.onclick = async () => {
        await this.openMediaImagePicker(async (selectedMedia) => {
          shape.mediaContentId = selectedMedia.mediaContentId;

          shape.mediaContentType = selectedMedia.mediaContentType;

          shape.mediaTitle = selectedMedia.title;

          /*
           * Runtime resolved URL.
           * Do not rely on this as the permanent reference.
           */
          shape.imageUrl = selectedMedia.url;

          shape.liveImageUrl = '';

          this.localImageUploadState = {
            shapeId: shape.id,
            uploading: false,
            error: '',
          };

          this.viewDirty = true;

          this.render();
        });
      };
    }

    if (browse && fileInput) {
      browse.onclick = () => {
        fileInput.click();
      };

      fileInput.onchange = async () => {
        const file = fileInput.files?.[0];

        if (!file) {
          return;
        }

        this.localImageUploadState = {
          shapeId: shape.id,
          uploading: true,
          error: '',
        };

        this.renderPanels();
        // ========================================================
        // FRONTEND VALIDATION
        // ========================================================

        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

        if (!allowedTypes.includes(file.type)) {
          this.localImageUploadState = {
            shapeId: shape.id,
            uploading: false,
            error: 'Unsupported image type. Use JPG, PNG or WEBP.',
          };

          this.renderPanels();

          return;
        }

        const maxSize = 10 * 1024 * 1024;

        if (file.size > maxSize) {
          this.localImageUploadState = {
            shapeId: shape.id,
            uploading: false,
            error: 'Image exceeds the 10 MB limit.',
          };

          this.renderPanels();

          return;
        }

        // ========================================================
        // READ FILE
        // ========================================================

        let encodedData;

        try {
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = () => resolve(String(reader.result));

            reader.onerror = reject;

            reader.readAsDataURL(file);
          });

          encodedData = dataUrl.split(',')[1];

          if (!encodedData) {
            throw new Error('Could not encode image.');
          }
        } catch (error) {
          this.localImageUploadState = {
            shapeId: shape.id,
            uploading: false,
            error: 'Could not read the selected image.',
          };

          this.renderPanels();

          return;
        }

        // ========================================================
        // UPLOAD TO HOME ASSISTANT
        // ========================================================

        try {
          const result = await this._hass.connection.sendMessagePromise({
            type: 'mss/images/upload_local',

            filename: file.name,

            data: encodedData,
          });

          if (!result?.url) {
            throw new Error('Upload returned no image URL.');
          }

          // ======================================================
          // UPDATE SHAPE
          // ======================================================

          shape.mediaContentId = '';
          shape.mediaContentType = '';
          shape.mediaTitle = '';

          shape.imageUrl = result.url;

          /*
           * Local images don't use the runtime MQTT image.
           */
          shape.liveImageUrl = '';

          this.localImageUploadState = {
            shapeId: shape.id,
            uploading: false,
            error: '',
          };

          this.viewDirty = true;

          this.render();
        } catch (error) {
          this.localImageUploadState = {
            shapeId: shape.id,
            uploading: false,
            error: 'Could not upload the image.',
          };

          this.renderPanels();
        } finally {
          fileInput.value = '';
        }
      };
    }
  }

  bindTextShapeEvent() {
    const button = this.shadowRoot?.querySelector('#addTextShape');

    if (!button) {
      return;
    }

    button.onclick = () => {
      this.createTextShape();
    };
  }

  bindTextShapePropertiesEvents() {
    const shape = this.selectedShape;

    if (!shape || shape.type !== 'text') {
      return;
    }

    const content = this.shadowRoot?.querySelector('#editorTextContent');

    const color = this.shadowRoot?.querySelector('#editorTextColor');

    const fontSize = this.shadowRoot?.querySelector('#editorTextFontSize');

    const fontWeight = this.shadowRoot?.querySelector('#editorTextFontWeight');

    const textAlign = this.shadowRoot?.querySelector('#editorTextAlign');

    const opacity = this.shadowRoot?.querySelector('#editorTextOpacity');

    if (content) {
      content.oninput = () => {
        shape.text = content.value;

        this.updateSelectedTextPreview();
      };
    }

    if (color) {
      color.oninput = () => {
        shape.color = color.value;

        this.updateSelectedTextPreview();
      };
    }

    if (fontSize) {
      fontSize.oninput = () => {
        shape.fontSize = Math.max(
          6,
          Math.min(120, Number(fontSize.value) || 16)
        );

        this.updateSelectedTextPreview();
      };
    }

    if (fontWeight) {
      fontWeight.onchange = () => {
        shape.fontWeight = Number(fontWeight.value) || 400;

        this.updateSelectedTextPreview();
      };
    }

    if (textAlign) {
      textAlign.onchange = () => {
        shape.textAlign = textAlign.value;

        this.updateSelectedTextPreview();
      };
    }

    if (opacity) {
      opacity.oninput = () => {
        shape.opacity = Math.max(0, Math.min(1, Number(opacity.value)));

        this.updateSelectedTextPreview();
      };
    }

    this.bindShapeConditionalColorEvents(shape, {
      updatePreview: () => this.updateSelectedTextPreview(),
    });
  }

  renderTextShapeProperties() {
    const shape = this.selectedShape;

    if (!shape || shape.type !== 'text') {
      return '';
    }

    return `
    <details
      class="mss-editor-property-group"
      data-editor-section="text-shape"
      open>

      <summary class="mss-editor-summary-row">
        <span>Text</span>
      </summary>

      <div class="mss-editor-property-content">

        <label class="mss-editor-field">
          <span>Text</span>

          <textarea
            id="editorTextContent"
            class="mss-editor-input"
            rows="3">${shape.text ?? ''}</textarea>
        </label>

        <label class="mss-editor-field">
          <span>Text color</span>

          <input
            id="editorTextColor"
            class="mss-editor-color-input"
            type="color"
            value="${shape.color ?? '#ffffff'}">
        </label>

        <label class="mss-editor-field">
          <span>Font size</span>

          <input
            id="editorTextFontSize"
            class="mss-editor-input"
            type="number"
            min="6"
            max="120"
            step="1"
            value="${Number(shape.fontSize ?? 16)}">
        </label>

        <label class="mss-editor-field">
          <span>Font weight</span>

          <select
            id="editorTextFontWeight"
            class="mss-editor-input">


            <option value="300"
              ${Number(shape.fontWeight ?? 400) === 300 ? 'selected' : ''}>
              Light
            </option>

            <option value="400"
              ${Number(shape.fontWeight ?? 400) === 500 ? 'selected' : ''}>
              Medium
            </option>

            <option value="700"
              ${Number(shape.fontWeight ?? 400) === 700 ? 'selected' : ''}>
              Bold
            </option>


          </select>
        </label>

        <label class="mss-editor-field">
          <span>Alignment</span>

          <select
            id="editorTextAlign"
            class="mss-editor-input">

            <option value="left"
              ${shape.textAlign === 'left' ? 'selected' : ''}>
              Left
            </option>

            <option value="center"
              ${shape.textAlign === 'center' ? 'selected' : ''}>
              Center
            </option>

            <option value="right"
              ${shape.textAlign === 'right' ? 'selected' : ''}>
              Right
            </option>

          </select>
        </label>

        <label class="mss-editor-field">
          <span>Opacity</span>

          <input
            id="editorTextOpacity"
            class="mss-editor-input"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value="${Number(shape.opacity ?? 1)}">
        </label>

        ${this.renderShapeConditionalColorProperties(shape, {
          toggleLabel: 'Conditional text color',

          colorLabel: 'Conditional text color',
        })}

      </div>

    </details>
  `;
  }

  updateSelectedTextPreview() {
    const shape = this.selectedShape;

    if (!shape || shape.type !== 'text') {
      return;
    }

    const element = this.shadowRoot?.querySelector(
      `.editor-shape[data-shape="${shape.id}"]`
    );

    if (!element) {
      return;
    }

    const textContainer = element.querySelector('.mss-shape-text-content');

    const text = element.querySelector('.mss-shape-text-value');

    if (!textContainer || !text) {
      return;
    }

    text.textContent = shape.text ?? '';

    text.style.textAlign = shape.textAlign ?? 'left';

    textContainer.style.color = this.resolveShapeColor(shape);

    textContainer.style.fontFamily = '"Segoe UI", sans-serif';

    textContainer.style.fontSize = `${Number(shape.fontSize ?? 16)}px`;

    textContainer.style.fontWeight = String(Number(shape.fontWeight ?? 400));

    textContainer.style.opacity = String(Number(shape.opacity ?? 1));

    this.viewDirty = true;
  }

  bindShapeCanvasEvents() {
    this.shadowRoot
      ?.querySelectorAll('.editor-shape[data-shape]')
      .forEach((shapeElement) => {
        const shapeId = shapeElement.dataset.shape;

        const shape = this.workingView?.shapes?.find(
          (item) => String(item.id) === String(shapeId)
        );

        const stage = this.shadowRoot?.querySelector('.mss-editor-stage');

        if (!shape || !stage) {
          return;
        }

        if (shape.type === 'line' || shape.type === 'arrow') {
          return;
        }

        this.bindPercentDrag({
          element: shapeElement,
          stage,
          dragMode: 'position',
          getPosition: () => ({
            x: Number(shape.position?.x ?? 30),
            y: Number(shape.position?.y ?? 30),
          }),

          getBounds: () => {
            const width = Number(shape.size?.width ?? 20);

            const height = Number(shape.size?.height ?? 15);

            return {
              minX: 0,
              minY: 0,
              maxX: 100 - width,
              maxY: 100 - height,
            };
          },

          setPosition: (position) => {
            shape.position = position;
          },

          onStart: () => {
            this.selectShape(shape.id, false);
          },

          onEnd: () => {
            this.renderPanels();
          },
        });
      });
  }

  // Attaches selection and dragging behavior to overlay callouts.
  bindCalloutEvents() {
    this.shadowRoot
      ?.querySelectorAll('.editor-callout[data-overlay]')
      .forEach((callout) => {
        const overlayId = callout.dataset.overlay;

        const overlay = this.workingView?.overlays?.find(
          (item) => String(item.id) === String(overlayId)
        );

        const stage = this.shadowRoot?.querySelector('.mss-editor-stage');

        if (!overlay?.position || !stage) {
          return;
        }

        this.bindPercentDrag({
          element: callout,
          stage,
          dragMode: 'position',

          getPosition: () => ({
            x: Number(overlay.position?.x ?? 0),
            y: Number(overlay.position?.y ?? 0),
          }),

          getBounds: () => ({
            minX: 0,
            minY: 0,
            maxX: 100,
            maxY: 100,
          }),

          setPosition: (position) => {
            overlay.position = position;
          },

          onStart: () => {
            this.selectOverlay(overlay.id, false);

            this.updateCanvasSelection(overlay.id);

            this.draggingOverlay = overlay;

            callout.classList.add('dragging');
          },

          onMove: () => {
            this.updatePositionInputs(overlay);

            this.updateReferenceLine(overlay);
          },

          onEnd: () => {
            callout.classList.remove('dragging');

            this.draggingOverlay = null;

            this.renderPanels();
          },
        });
      });
  }

  bindCanvasDeselectionEvent() {
    const stage = this.shadowRoot?.querySelector('.mss-editor-stage');

    if (!stage) {
      return;
    }

    stage.onclick = (event) => {
      /*
       * Ignore clicks on selectable editor objects.
       *
       * Their own handlers manage selection.
       */
      if (
        event.target.closest?.('.editor-shape, .editor-callout, .editor-point')
      ) {
        return;
      }

      this.clearEditorSelection();
    };
  }

  // Attaches resizing behavior to overlay corner handles.
  bindOverlayResizeEvents() {
    this.shadowRoot
      ?.querySelectorAll('.mss-overlay-resize-handle[data-overlay-resize]')
      .forEach((handle) => {
        const overlayId = handle.dataset.overlayResize;

        const direction = handle.dataset.resizeDirection;

        const overlay = this.workingView?.overlays?.find(
          (item) => String(item.id) === String(overlayId)
        );

        const callout = this.shadowRoot?.querySelector(
          `.editor-callout[data-overlay="${overlayId}"]`
        );

        const stage = this.shadowRoot?.querySelector('.mss-editor-stage');

        if (!overlay || !callout || !stage) {
          return;
        }

        this.bindResizeInteraction({
          handle,
          targetElement: callout,
          stage,
          direction,

          getInitialGeometry: () => ({
            x: Number(overlay.position?.x ?? 0),

            y: Number(overlay.position?.y ?? 0),

            width: callout.offsetWidth,

            height: callout.offsetHeight,
          }),

          applyResize: ({ direction, initialGeometry, deltaPixels }) => {
            let { width, height } = initialGeometry;

            if (direction.includes('right')) {
              width = Math.max(30, initialGeometry.width + deltaPixels.x);
            }

            if (direction.includes('left')) {
              width = Math.max(30, initialGeometry.width - deltaPixels.x);
            }

            if (direction.includes('bottom')) {
              height = Math.max(30, initialGeometry.height + deltaPixels.y);
            }

            if (direction.includes('top')) {
              height = Math.max(30, initialGeometry.height - deltaPixels.y);
            }

            return {
              width,
              height,
            };
          },

          onMove: ({ width, height }) => {
            overlay.size = {
              width,
              height,
            };

            callout.style.width = `${width}px`;

            callout.style.minHeight = `${height}px`;

            const widthInput = this.shadowRoot?.querySelector(
              '#editorOverlayWidth'
            );

            const heightInput = this.shadowRoot?.querySelector(
              '#editorOverlayHeight'
            );

            if (widthInput) {
              widthInput.value = Math.round(width);
            }

            if (heightInput) {
              heightInput.value = Math.round(height);
            }

            this.updateReferenceLine(overlay);
          },
        });
      });
  }

  bindShapeResizeEvents() {
    this.shadowRoot
      ?.querySelectorAll('.mss-shape-resize-handle[data-shape-resize]')
      .forEach((handle) => {
        const shapeId = handle.dataset.shapeResize;

        const direction = handle.dataset.resizeDirection;

        const shape = this.workingView?.shapes?.find(
          (item) => String(item.id) === String(shapeId)
        );

        const shapeElement = this.shadowRoot?.querySelector(
          `.editor-shape[data-shape="${shapeId}"]`
        );

        const stage = this.shadowRoot?.querySelector('.mss-editor-stage');

        if (!shape || !shapeElement || !stage) {
          return;
        }

        // Line and Arrow use endpoint handles,
        // not rectangular resize handles.
        if (shape.type === 'line' || shape.type === 'arrow') {
          return;
        }

        this.bindResizeInteraction({
          handle,
          targetElement: shapeElement,
          stage,
          direction,

          getInitialGeometry: () => ({
            x: Number(shape.position?.x ?? 30),

            y: Number(shape.position?.y ?? 30),

            width: Number(shape.size?.width ?? 20),

            height: Number(shape.size?.height ?? 15),
          }),

          onStart: () => {
            this.selectShape(shape.id, false);
          },

          applyResize: ({
            direction,
            initialGeometry,
            deltaPixels,
            deltaPercent,
            stageRect,
          }) => {
            // ====================================================
            // CIRCLE
            // ====================================================
            //
            // Circle dimensions must remain equal in actual
            // screen pixels.
            //
            // Example:
            //
            // Stage = 1000 x 600
            //
            // 20% width  = 200 px
            // 20% height = 120 px
            //
            // Therefore equal percentage values would create
            // an ellipse.
            //
            // For Circle we resize in pixels first and only then
            // convert the result back to percentages.
            // ====================================================

            if (shape.type === 'circle') {
              const stageWidth = stageRect.width;

              const stageHeight = stageRect.height;

              // Initial geometry converted to pixels.
              const initial_X = (initialGeometry.x / 100) * stageWidth;

              const initial_Y = (initialGeometry.y / 100) * stageHeight;

              const initialWidth = (initialGeometry.width / 100) * stageWidth;

              const initialHeight =
                (initialGeometry.height / 100) * stageHeight;

              /*
               * Existing Circles should already have equal pixel
               * width/height. Using their average also makes this
               * tolerant of older Circle data that may be slightly
               * distorted.
               */
              const initialDiameter = (initialWidth + initialHeight) / 2;

              // ==================================================
              // DETERMINE RESIZE AMOUNT
              // ==================================================

              let horizontalDiameter = initialDiameter;

              let verticalDiameter = initialDiameter;

              if (direction.includes('right')) {
                horizontalDiameter = initialDiameter + deltaPixels.x;
              }

              if (direction.includes('left')) {
                horizontalDiameter = initialDiameter - deltaPixels.x;
              }

              if (direction.includes('bottom')) {
                verticalDiameter = initialDiameter + deltaPixels.y;
              }

              if (direction.includes('top')) {
                verticalDiameter = initialDiameter - deltaPixels.y;
              }

              /*
               * Use whichever axis the user moved further.
               * This makes diagonal corner resizing feel natural.
               */
              const horizontalChange = Math.abs(
                horizontalDiameter - initialDiameter
              );

              const verticalChange = Math.abs(
                verticalDiameter - initialDiameter
              );

              let diameter =
                horizontalChange >= verticalChange
                  ? horizontalDiameter
                  : verticalDiameter;

              // Minimum Circle diameter.
              const minDiameter = Math.max(
                12,
                Math.min(stageWidth, stageHeight) * 0.02
              );

              diameter = Math.max(minDiameter, diameter);

              // ==================================================
              // KEEP OPPOSITE CORNER FIXED
              // ==================================================

              const initialRight = initial_X + initialDiameter;

              const initialBottom = initial_Y + initialDiameter;

              /*
               * Work out the maximum diameter before the Circle
               * would leave the stage.
               */
              let maxDiameter = Infinity;

              if (direction.includes('right')) {
                maxDiameter = Math.min(maxDiameter, stageWidth - initial_X);
              }

              if (direction.includes('left')) {
                maxDiameter = Math.min(maxDiameter, initialRight);
              }

              if (direction.includes('bottom')) {
                maxDiameter = Math.min(maxDiameter, stageHeight - initial_Y);
              }

              if (direction.includes('top')) {
                maxDiameter = Math.min(maxDiameter, initialBottom);
              }

              diameter = Math.min(diameter, maxDiameter);

              let xPixels = initial_X;

              let yPixels = initial_Y;

              if (direction.includes('left')) {
                xPixels = initialRight - diameter;
              }

              if (direction.includes('top')) {
                yPixels = initialBottom - diameter;
              }

              // ==================================================
              // PIXELS -> PERCENTAGES
              // ==================================================

              return {
                x: (xPixels / stageWidth) * 100,

                y: (yPixels / stageHeight) * 100,

                width: (diameter / stageWidth) * 100,

                height: (diameter / stageHeight) * 100,
              };
            }

            // ====================================================
            // NORMAL SHAPES
            // ====================================================
            //
            // Rectangle / Image / future free-resize Shapes.
            // ====================================================

            let x = initialGeometry.x;

            let y = initialGeometry.y;

            let width = initialGeometry.width;

            let height = initialGeometry.height;

            const minWidth = 2;
            const minHeight = 2;

            if (direction.includes('right')) {
              width = Math.max(
                minWidth,
                initialGeometry.width + deltaPercent.x
              );
            }

            if (direction.includes('left')) {
              width = Math.max(
                minWidth,
                initialGeometry.width - deltaPercent.x
              );

              x = initialGeometry.x + (initialGeometry.width - width);
            }

            if (direction.includes('bottom')) {
              height = Math.max(
                minHeight,
                initialGeometry.height + deltaPercent.y
              );
            }

            if (direction.includes('top')) {
              height = Math.max(
                minHeight,
                initialGeometry.height - deltaPercent.y
              );

              y = initialGeometry.y + (initialGeometry.height - height);
            }

            x = Math.max(0, x);

            y = Math.max(0, y);

            width = Math.min(width, 100 - x);

            height = Math.min(height, 100 - y);

            return {
              x,
              y,
              width,
              height,
            };
          },

          onMove: ({ x, y, width, height }) => {
            shape.position = {
              x,
              y,
            };

            shape.size = {
              width,
              height,
            };

            shapeElement.style.left = `${x}%`;

            shapeElement.style.top = `${y}%`;

            shapeElement.style.width = `${width}%`;

            shapeElement.style.height = `${height}%`;
          },

          onEnd: () => {
            this.renderPanels();
          },
        });
      });
  }

  bindResizeInteraction({
    handle,
    targetElement,
    stage,
    direction,
    getInitialGeometry,
    applyResize,
    onStart,
    onMove,
    onEnd,
  }) {
    if (!handle || !targetElement || !stage || !direction) {
      return;
    }

    handle.onpointerdown = (event) => {
      event.preventDefault();
      event.stopPropagation();

      const stageRect = stage.getBoundingClientRect();

      if (stageRect.width <= 0 || stageRect.height <= 0) {
        return;
      }

      const startMouseX = event.clientX;
      const startMouseY = event.clientY;

      const initialGeometry = getInitialGeometry();

      onStart?.(initialGeometry);

      try {
        handle.setPointerCapture(event.pointerId);
      } catch {}

      const handlePointerMove = (moveEvent) => {
        if (moveEvent.pointerId !== event.pointerId) {
          return;
        }

        moveEvent.preventDefault();
        moveEvent.stopPropagation();

        const deltaPixels = {
          x: moveEvent.clientX - startMouseX,

          y: moveEvent.clientY - startMouseY,
        };

        const deltaPercent = {
          x: (deltaPixels.x / stageRect.width) * 100,

          y: (deltaPixels.y / stageRect.height) * 100,
        };

        const geometry = applyResize({
          direction,
          initialGeometry,
          deltaPixels,
          deltaPercent,
          stageRect,
        });

        if (!geometry) {
          return;
        }

        onMove?.(geometry);
      };

      const handlePointerEnd = (endEvent) => {
        if (endEvent.pointerId !== event.pointerId) {
          return;
        }

        handle.removeEventListener('pointermove', handlePointerMove);

        handle.removeEventListener('pointerup', handlePointerEnd);

        handle.removeEventListener('pointercancel', handlePointerEnd);

        try {
          if (handle.hasPointerCapture(event.pointerId)) {
            handle.releasePointerCapture(event.pointerId);
          }
        } catch {}

        onEnd?.();
      };

      handle.addEventListener('pointermove', handlePointerMove);

      handle.addEventListener('pointerup', handlePointerEnd);

      handle.addEventListener('pointercancel', handlePointerEnd);
    };
  }

  // Attaches selection and dragging behavior to overlay pointer dots.
  bindPointerEvents() {
    this.shadowRoot
      ?.querySelectorAll('.editor-point[data-overlay-pointer]')
      .forEach((point) => {
        point.onpointerdown = (event) => {
          if (event.button !== undefined && event.button !== 0) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();

          const overlayId = point.dataset.overlayPointer;

          const overlay = this.workingView?.overlays?.find(
            (item) => String(item.id) === String(overlayId)
          );

          const stage = this.shadowRoot?.querySelector('.mss-editor-stage');

          if (!overlay?.pointer || !stage) {
            return;
          }

          const stageRect = stage.getBoundingClientRect();

          if (stageRect.width <= 0 || stageRect.height <= 0) {
            return;
          }

          this.selectOverlay(overlay.id, false);

          this.updateCanvasSelection(overlay.id);

          this.draggingOverlay = overlay;

          point.classList.add('dragging');

          const startMouseX = event.clientX;

          const startMouseY = event.clientY;

          const startPointerX = Number(overlay.pointer.x) || 0;

          const startPointerY = Number(overlay.pointer.y) || 0;

          try {
            point.setPointerCapture(event.pointerId);
          } catch (error) {
            console.debug('Could not capture the overlay pointer dot.', error);
          }

          // Moves the pointer dot using percentage coordinates relative to the image stage.
          const handlePointerMove = (moveEvent) => {
            if (moveEvent.pointerId !== event.pointerId) {
              return;
            }

            moveEvent.preventDefault();
            moveEvent.stopPropagation();

            const deltaX =
              ((moveEvent.clientX - startMouseX) / stageRect.width) * 100;

            const deltaY =
              ((moveEvent.clientY - startMouseY) / stageRect.height) * 100;

            const nextX = Math.max(0, Math.min(100, startPointerX + deltaX));

            const nextY = Math.max(0, Math.min(100, startPointerY + deltaY));

            overlay.pointer.x = nextX;

            overlay.pointer.y = nextY;

            point.style.left = `${nextX}%`;

            point.style.top = `${nextY}%`;

            this.updateReferenceLine(overlay);
          };

          // Finishes pointer-dot dragging and rebuilds the Editor once.
          const handlePointerUp = (upEvent) => {
            if (upEvent.pointerId !== event.pointerId) {
              return;
            }

            point.removeEventListener('pointermove', handlePointerMove);

            point.removeEventListener('pointerup', handlePointerUp);

            point.removeEventListener('pointercancel', handlePointerUp);

            try {
              if (point.hasPointerCapture(event.pointerId)) {
                point.releasePointerCapture(event.pointerId);
              }
            } catch (error) {
              console.debug(
                'Could not release the overlay pointer dot.',
                error
              );
            }

            point.classList.remove('dragging');

            this.draggingOverlay = null;

            this.renderPanels();
          };

          point.addEventListener('pointermove', handlePointerMove);

          point.addEventListener('pointerup', handlePointerUp);

          point.addEventListener('pointercancel', handlePointerUp);
        };
      });
  }

  bindOverlayTitleSizeEvent() {
    const overlay = this.selectedOverlay;

    const input = this.shadowRoot?.querySelector('#editorOverlayTitleSize');

    if (!overlay || !input) {
      return;
    }

    input.oninput = () => {
      const size = Math.max(8, Math.min(48, Number(input.value) || 16));

      overlay.titleFontSize = size;

      const title = this.shadowRoot?.querySelector(
        `.editor-callout[data-overlay="${overlay.id}"] .callout-title`
      );

      if (title) {
        title.style.fontSize = `${size}px`;
      }
    };
  }

  // Returns the logical MSS group represented by an HA entity.
  //
  // Preferred:
  //   mss_group
  //
  // Fallback:
  //   mss_generic = true
  //       -> MSSReport
  //
  //   mss_control_plan = Test1
  //       -> MSSReport_Test1
  getMssStateGroup(state) {
    const attributes = state?.attributes ?? {};

    // Preferred value created by the MSS integration.
    if (attributes.mss_group) {
      return String(attributes.mss_group);
    }

    // Generic MSS entities.
    if (attributes.mss_generic === true || attributes.mss_generic === 'true') {
      return 'MSSReport';
    }

    // Control-plan-specific MSS entities.
    if (attributes.mss_control_plan) {
      return `MSSReport_${attributes.mss_control_plan}`;
    }

    return null;
  }

  // Builds Data Field options from the dynamic MSS HA entities.
  //
  // No MQTT message needs to arrive while the editor is open.
  getMssDataFieldOptions() {
    const element = this.selectedOverlayElement;

    if (!element) {
      return [];
    }

    let selectedGroup = element.mssGroup;

    if (!selectedGroup && element.path) {
      selectedGroup = this.getMssStateGroup(this._hass?.states?.[element.path]);
    }

    return this.getMssFieldOptionsForGroup(selectedGroup);
  }

  // ============================================================
  // MSS SMART DATA FIELD OPTIONS
  // ============================================================
  //
  // Converts resolver-level composites / measurements into options
  // that can be displayed by the existing Data Field picker.
  //
  // No new HA entities are created here.
  // ============================================================

  getMssSmartDataFieldOptions() {
    const element = this.selectedOverlayElement;

    if (!element) {
      return [];
    }

    let selectedGroup = element.mssGroup;

    if (!selectedGroup && element.path) {
      selectedGroup = this.getMssStateGroup(this._hass?.states?.[element.path]);
    }

    if (!selectedGroup) {
      return [];
    }

    // ----------------------------------------------------------
    // TRUE COMPOSITES
    // Position 2D / Size
    // ----------------------------------------------------------

    const composites = getMssCompositeFieldsForGroup({
      hass: this._hass,
      mssGroup: selectedGroup,
    }).map((item) => ({
      smartKey: `composite:${item.compositeType}:${item.basePath}`,

      bindingType: 'composite',

      label: item.label,
      secondaryLabel:
        item.compositeType === 'position2d'
          ? 'X + Y'
          : item.compositeType === 'size2d'
            ? 'Width + Height'
            : '',

      searchLabel: [
        item.label,
        item.basePath,
        Object.values(item.components ?? {})
          .map((component) => component.dataPath)
          .join(' '),
      ]
        .filter(Boolean)
        .join(' '),

      mssGroup: item.mssGroup,
      compositeType: item.compositeType,
      basePath: item.basePath,
      components: item.components,
      format: item.format,
    }));

    // ----------------------------------------------------------
    // MEASUREMENTS
    // One entity: state + unit_of_measurement
    // ----------------------------------------------------------

    const measurements = getMssMeasurementFieldsForGroup({
      hass: this._hass,
      mssGroup: selectedGroup,
    }).map((item) => ({
      smartKey: `measurement:${item.dataPath}`,

      bindingType: 'measurement',

      label: item.label,
      secondaryLabel: item.unit ? `Value + ${item.unit}` : 'Value',

      searchLabel: [item.label, item.dataPath, item.dataEntity, item.unit]
        .filter(Boolean)
        .join(' '),

      mssGroup: item.mssGroup,
      dataEntity: item.dataEntity,
      dataPath: item.dataPath,
      unit: item.unit,
    }));

    return [...composites, ...measurements];
  }

  getAvailableMssGroups() {
    if (!this._hass?.states) {
      console.warn('No hass.states available inside MSS View Editor.');

      console.groupEnd();

      return [];
    }

    const allStates = Object.entries(this._hass.states);

    const possibleMssEntities = allStates
      .filter(([entityId, state]) => {
        const attributes = state?.attributes ?? {};

        return (
          attributes.mss_group !== undefined ||
          attributes.mss_source_path !== undefined ||
          attributes.mss_generic !== undefined ||
          attributes.mss_control_plan !== undefined ||
          entityId.includes('last_measurement') ||
          entityId.includes('statistics_evaluation')
        );
      })
      .map(([entityId, state]) => ({
        entityId,

        state: state.state,

        mss_group: state.attributes?.mss_group,

        mss_source_path: state.attributes?.mss_source_path,

        mss_generic: state.attributes?.mss_generic,

        mss_control_plan: state.attributes?.mss_control_plan,

        friendly_name: state.attributes?.friendly_name,
      }));

    const groups = new Map();

    for (const [entityId, state] of allStates) {
      const attributes = state?.attributes ?? {};

      let group = attributes.mss_group;

      // Generic fallback.
      if (
        !group &&
        (attributes.mss_generic === true || attributes.mss_generic === 'true')
      ) {
        group = 'MSSReport';
      }

      // Control plan fallback.
      if (!group && attributes.mss_control_plan) {
        group = `MSSReport_${attributes.mss_control_plan}`;
      }

      if (!group) {
        continue;
      }

      if (groups.has(group)) {
        continue;
      }

      const controlPlan = attributes.mss_control_plan ?? null;

      const isGeneric =
        group === 'MSSReport' ||
        attributes.mss_generic === true ||
        attributes.mss_generic === 'true';

      groups.set(group, {
        id: String(group),

        label: isGeneric
          ? 'MSS Report'
          : controlPlan
            ? `MSS Report - ${controlPlan}`
            : String(group),

        controlPlan,

        generic: isGeneric,
      });
    }

    const result = Array.from(groups.values());

    result.sort((a, b) => {
      if (a.generic && !b.generic) {
        return -1;
      }

      if (b.generic && !a.generic) {
        return 1;
      }

      return a.label.localeCompare(b.label);
    });

    return result;
  }

  getAvailableMssImageGroups() {
    const groups = new Map();

    for (const image of this.availableMssImages ?? []) {
      if (!image?.group) {
        continue;
      }

      const group = String(image.group);

      if (groups.has(group)) {
        continue;
      }

      const controlPlan = image.control_plan ?? null;

      const generic = image.generic === true || group === 'MSSReport';

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
      if (a.generic && !b.generic) {
        return -1;
      }

      if (b.generic && !a.generic) {
        return 1;
      }

      return a.label.localeCompare(b.label);
    });
  }

  getMssFieldOptionsForGroup(mssGroup) {
    if (!mssGroup || !this._hass?.states) {
      return [];
    }

    const fields = new Map();

    for (const [entityId, state] of Object.entries(this._hass.states)) {
      if (this.getMssStateGroup(state) !== mssGroup) {
        continue;
      }

      const sourcePath = state?.attributes?.mss_source_path;

      if (!sourcePath) {
        continue;
      }

      const labelParts = this.createMssDataFieldLabelParts(sourcePath, state);

      if (!fields.has(sourcePath)) {
        fields.set(sourcePath, {
          path: sourcePath,
          entityId,
          label: labelParts.join(' › ') || sourcePath,
          group: labelParts[0] ?? 'Other',
        });
      }
    }

    return Array.from(fields.values()).sort((a, b) =>
      a.label.localeCompare(b.label)
    );
  }

  filterMssFieldList({
    list,
    query,
    optionSelector,
    groupSelector,
    labelAttribute,
  }) {
    if (!list) {
      return;
    }

    const normalizedQuery = String(query ?? '')
      .trim()
      .toLowerCase();

    // ==========================================================
    // FILTER FIELD OPTIONS
    // ==========================================================

    list.querySelectorAll(optionSelector).forEach((option) => {
      const searchable = String(
        option.getAttribute(labelAttribute) ?? ''
      ).toLowerCase();

      const matches = !normalizedQuery || searchable.includes(normalizedQuery);

      option.style.display = matches ? '' : 'none';
    });

    // ==========================================================
    // HIDE EMPTY GROUPS
    // ==========================================================

    list.querySelectorAll(groupSelector).forEach((group) => {
      const options = Array.from(group.querySelectorAll(optionSelector));

      const hasVisibleOption = options.some(
        (option) => option.style.display !== 'none'
      );

      group.style.display = hasVisibleOption ? '' : 'none';
    });
  }

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

  // Converts an MSS source path into readable hierarchy labels.
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

  // Groups MSS data fields by their top-level section.
  getGroupedMssDataFields() {
    return this.groupMssFieldOptions(this.getMssDataFieldOptions());
  }

  // Renders the list of overlays available in the editable View.
  renderOverlayList() {
    const overlays = this.workingView?.overlays ?? [];

    if (overlays.length === 0) {
      return `
        <p class="mss-editor-empty">
          No overlays in this View.
        </p>
      `;
    }

    return overlays
      .map((overlay) => {
        const selected =
          String(this.selectedOverlay?.id) === String(overlay.id);

        return `
          <button
            class="
              mss-editor-object
              ${selected ? 'selected' : ''}
            "
            data-editor-overlay="${overlay.id}"
            type="button"
            draggable="true">

            <span class="mss-editor-object-icon">
              ●
            </span>

            <span class="mss-editor-object-name">
              ${overlay.name ?? 'Overlay'}
            </span>
          </button>
        `;
      })
      .join('');
  }

  // Renders the elements belonging to the currently selected overlay.
  renderElementList() {
    const elements = this.selectedOverlay?.elements ?? [];

    if (elements.length === 0) {
      return `
        <p class="mss-editor-empty">
          No elements in this overlay.
        </p>
      `;
    }

    return elements
      .map((element) => {
        const selected =
          String(this.selectedOverlayElement?.id) === String(element.id);

        return `
          <button
            class="
              mss-editor-element
              ${selected ? 'selected' : ''}
            "
            data-editor-element="${element.id}"
            type="button">

            <strong>
              ${element.name ?? element.path ?? 'Element'}
            </strong>

            <span>
              ${element.path ?? 'No binding'}
            </span>
          </button>
        `;
      })
      .join('');
  }

  // Converts MSS JSON/entity path names into readable labels.
  formatMssFieldLabel(key, controlPlan = null) {
    if (key === '#text') {
      return 'Value';
    }

    if (key === '@Unit') {
      return 'Unit';
    }

    let displayKey = String(key);

    // ==========================================================
    // REMOVE CURRENT CONTROL PLAN FROM DISPLAY LABEL
    // ==========================================================

    if (controlPlan) {
      const suffix = `_${controlPlan}`;

      if (displayKey.toLowerCase().endsWith(suffix.toLowerCase())) {
        displayKey = displayKey.slice(0, -suffix.length);
      }
    }

    // ==========================================================
    // KNOWN FRIENDLY LABELS
    // ==========================================================

    const knownLabels = {
      ProductId: 'Product ID',

      StationId: 'Station ID',

      ControlPlan: 'Control Plan',

      SerialNumber: 'Serial Number',

      SystemHealthPC: 'System Health PC',

      SystemHealthMSS: 'System Health MSS',

      SystemStartTime: 'System Start Time',

      MSSStartTime: 'MSS Start Time',

      MSSCPUUsage: 'MSS CPU Usage',

      AverageCPUUsage: 'Average CPU Usage',

      MemoryUsage: 'Memory Usage',

      ControlPlanOverview: 'Control Plan Overview',

      SuccessRate: 'Success Rate',

      MeasurementFrequency: 'Measurement Frequency',

      MeasurementAverageDuration: 'Measurement Average Duration',

      AverageCPUUsageLastMeasurement: 'Average CPU Usage Last Measurement',

      ConfigurationChangedTime: 'Configuration Changed Time',

      AvailableFreeSpaceOnProjectDrive: 'Available Free Space on Project Drive',

      AvailableFreeSpaceOnSystemDrive: 'Available Free Space on System Drive',

      AvailableFreeSpaceOnSystemDrivePercent:
        'Available Free Space on System Drive (%)',

      LastMeasurement: 'Last Measurement',

      StatisticsEvaluation: 'Statistics Evaluation',

      Identification: 'Identification',
    };

    if (knownLabels[displayKey]) {
      return knownLabels[displayKey];
    }

    // ==========================================================
    // GENERIC FALLBACK
    // ==========================================================

    return displayKey
      .replace(/_/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .trim();
  }

  // Converts control-plan-specific MSS paths into reusable dynamic paths.
  normalizeMssDataPath(path) {
    if (!path) {
      return '';
    }

    const controlPlan =
      this._hass?.states?.['sensor.mss_report']?.attributes?.rootNode
        ?.Identification?.ControlPlan;

    let normalized = String(path)
      .replace(
        /rootNode\.LastMeasurement_[^.]+/,
        'rootNode.LastMeasurement_{ControlPlan}'
      )
      .replace(
        /rootNode\.StatisticsEvaluation_[^.]+/,
        'rootNode.StatisticsEvaluation_{ControlPlan}'
      );

    if (controlPlan) {
      normalized = normalized.replaceAll(`.${controlPlan}_`, '.{ControlPlan}_');
    }

    return normalized;
  }

  // Ensures the current View has a valid automatic-routing configuration.
  ensureAutoRoutingConfig() {
    if (!this.workingView.autoRouting) {
      this.workingView.autoRouting = {
        enabled: false,
        mssGroup: '',
        sourceMode: 'detected',
        manualControlPlan: '',
        conditionLogic: 'and',
        conditions: [],
      };
    }

    this.workingView.autoRouting.conditions ??= [];

    this.workingView.autoRouting.conditionLogic ??= 'and';

    this.workingView.autoRouting.sourceMode ??= 'detected';

    this.workingView.autoRouting.manualControlPlan ??= '';

    return this.workingView.autoRouting;
  }

  addAutoRoutingCondition() {
    const routing = this.ensureAutoRoutingConfig();

    routing.conditions.push({
      exampleMssGroup: '',
      field: '',
      matchMode: 'exact',
      pattern: '',
      operator: 'equals',
      value: '',
    });

    this.renderPanels();
  }
  // Deletes one automatic-routing condition.
  removeAutoRoutingCondition(index) {
    const routing = this.ensureAutoRoutingConfig();

    routing.conditions.splice(index, 1);

    this.renderPanels();
  }

  getAutoRoutingFieldOptions(selectedGroup = null) {
    const routing = this.ensureAutoRoutingConfig();

    const group = selectedGroup || routing.mssGroup;

    return this.getMssFieldOptionsForGroup(group);
  }

  groupMssFieldOptions(options) {
    const groups = new Map();

    for (const option of options) {
      const group = option.group ?? 'Other';

      if (!groups.has(group)) {
        groups.set(group, []);
      }

      groups.get(group).push(option);
    }

    return Array.from(groups.entries()).map(([name, options]) => ({
      name,
      options,
    }));
  }

  createAutoRoutingWildcard(path, sourceGroup = '') {
    if (!path) {
      return '';
    }

    let pattern = String(path);

    const controlPlan = sourceGroup?.startsWith('MSSReport_')
      ? sourceGroup.substring('MSSReport_'.length)
      : '';

    pattern = pattern.replace(
      /rootNode\.LastMeasurement_[^.]+/,
      'rootNode.LastMeasurement*'
    );

    pattern = pattern.replace(
      /rootNode\.StatisticsEvaluation_[^.]+/,
      'rootNode.StatisticsEvaluation*'
    );

    pattern = pattern.replace(/_Copy\d+(?=_)/gi, '*');

    if (controlPlan) {
      pattern = pattern.replaceAll(`_${controlPlan}_`, '*_');
    }

    return pattern;
  }

  renderSelectedShapeProperties() {
    const shape = this.selectedShape;

    if (!shape) {
      return '';
    }

    switch (shape.type) {
      case 'image':
        return this.renderImageShapeProperties();

      case 'rectangle':
        return this.renderRectangleShapeProperties();

      case 'circle':
        return this.renderCircleShapeProperties();

      case 'line':
        return this.renderLineShapeProperties();

      case 'arrow':
        return this.renderArrowShapeProperties();

      case 'text':
        return this.renderTextShapeProperties();

      default:
        return '';
    }
  }

  // Renders the properties of the currently selected overlay and element.
  renderProperties() {
    const overlay = this.selectedOverlay;

    const dataFieldOptions = this.getMssDataFieldOptions();

    const smartDataFieldOptions = this.getMssSmartDataFieldOptions();

    const selectedBindingType = this.selectedOverlayElement?.bindingType ?? '';

    const selectedSmartKey =
      selectedBindingType === 'composite'
        ? `composite:${this.selectedOverlayElement?.composite?.type ?? ''}:${
            this.selectedOverlayElement?.composite?.basePath ?? ''
          }`
        : selectedBindingType === 'measurement'
          ? `measurement:${this.selectedOverlayElement?.dataPath ?? ''}`
          : '';

    const selectedDataEntity = this.selectedOverlayElement?.dataEntity ?? '';

    const selectedDataPath = this.selectedOverlayElement?.dataPath ?? '';

    const selectedPathExists = dataFieldOptions.some(
      (option) =>
        option.entityId === selectedDataEntity ||
        option.path === selectedDataPath
    );

    // ==========================================================
    // OVERLAY PROPERTIES
    // ==========================================================

    const overlayProperties = overlay
      ? `
        <details
          class="mss-editor-property-group"
          data-editor-section="overlays"
          open>

          <summary class="mss-editor-summary-row">
            <span>Overlay</span>
          </summary>

          <label class="mss-editor-field">
            <span>Name</span>

            <input
              id="editorOverlayName"
              class="mss-editor-input"
              type="text"
              value="${overlay.name ?? ''}">
          </label>

          <div class="mss-editor-property-grid">

            <label class="mss-editor-field">
              <span>X</span>

              <input
                id="editorOverlayX"
                class="mss-editor-input"
                type="number"
                min="0"
                max="100"
                step="0.1"
                value="${Number(overlay.position?.x ?? 50).toFixed(2)}">
            </label>

            <label class="mss-editor-field">
              <span>Y</span>

              <input
                id="editorOverlayY"
                class="mss-editor-input"
                type="number"
                min="0"
                max="100"
                step="0.1"
                value="${Number(overlay.position?.y ?? 50).toFixed(2)}">
            </label>

          </div>

          <div class="mss-editor-property-grid">

            <label class="mss-editor-field">
              <span>Width</span>

              <input
                id="editorOverlayWidth"
                class="mss-editor-input"
                type="number"
                min="30"
                max="800"
                step="10"
                value="${overlay.size?.width ?? 220}">
            </label>

            <label class="mss-editor-field">
              <span>Height</span>

              <input
                id="editorOverlayHeight"
                class="mss-editor-input"
                type="number"
                min="30"
                max="600"
                step="10"
                value="${overlay.size?.height ?? 120}">
            </label>

            <label class="mss-editor-field">
              <span>Title size</span>

              <input
                id="editorOverlayTitleSize"
                class="mss-editor-input"
                type="number"
                min="8"
                max="48"
                step="1"
                value="${overlay.titleFontSize ?? 16}">
            </label>

          </div>

          <label class="mss-editor-checkbox">

            <input
              id="editorPointerVisible"
              type="checkbox"
              ${overlay.pointerVisible !== false ? 'checked' : ''}>

            <span>Show reference point</span>

          </label>

          <label
            class="mss-editor-field"
            style="margin-top:12px;">

            <span>Reference point size</span>

            <input
              id="editorPointerSize"
              class="mss-editor-input"
              type="number"
              min="4"
              max="40"
              step="1"
              value="${overlay.pointerSize ?? 10}">

          </label>

        </details>


        <label
          class="mss-editor-checkbox"
          style="margin-top:12px;">

          <input
            id="editorReferenceLineVisible"
            type="checkbox"
            ${overlay.referenceLineVisible !== false ? 'checked' : ''}>

          <span>Show reference line</span>

        </label>


        <label
          class="mss-editor-field"
          style="margin-top:12px;">

          <span>Reference line thickness</span>

          <input
            id="editorReferenceLineThickness"
            class="mss-editor-input"
            type="number"
            min="1"
            max="12"
            step="1"
            value="${overlay.referenceLineThickness ?? 5}">

        </label>


        <details
          class="mss-editor-property-group"
          data-editor-section="elements"
          open>

          <summary class="mss-editor-summary-row">

            <span>Elements</span>

            <div class="mss-editor-panel-actions">

              <button
                id="addMssElement"
                class="mss-editor-icon-button"
                type="button"
                title="Add element"
                aria-label="Add element">
                ${mssIcon('add', 18)}
              </button>

              <button
                id="duplicateMssElement"
                class="mss-editor-icon-button"
                type="button"
                title="Duplicate selected element"
                aria-label="Duplicate selected element"
                ${this.selectedOverlayElement ? '' : 'disabled'}>
                ${mssIcon('copy', 18)}
              </button>

              <button
                id="deleteMssElement"
                class="mss-editor-icon-button danger"
                type="button"
                title="Delete selected element"
                aria-label="Delete selected element"
                ${this.selectedOverlayElement ? '' : 'disabled'}>
                ${mssIcon('trash', 18)}
              </button>
            </div>

          </summary>

          <div class="mss-editor-property-content">

            <div class="mss-editor-object-list">

              ${(overlay.elements ?? [])
                .map(
                  (element) => `
                    <button
                      class="
                        mss-editor-object
                        ${
                          String(this.selectedOverlayElement?.id) ===
                          String(element.id)
                            ? 'selected'
                            : ''
                        }
                      "
                      data-editor-element="${element.id}"
                      type="button"
                      draggable="true">

                      ${element.name ?? 'Element'}

                    </button>
                  `
                )
                .join('')}

            </div>

          </div>

        </details>
      `
      : '';

    // ==========================================================
    // MAIN PROPERTIES
    // ==========================================================

    return `
    ${this.renderSelectedShapeProperties()}
    ${
      !this.selectedOverlay && !this.selectedShape
        ? `

            <!-- ============================================= -->
            <!-- VIEW SETTINGS                                 -->
            <!-- ============================================= -->

            <details
              class="mss-editor-property-group"
              data-editor-section="view-settings"
              open>

              <summary class="mss-editor-summary-row">
                <span>View Settings</span>
              </summary>

              <label class="mss-editor-field">

                <span>View name</span>

                <input
                  id="editorViewName"
                  class="mss-editor-input"
                  type="text"
                  value="${this.workingView.name ?? ''}">

              </label>

            </details>


            <!-- ============================================= -->
            <!-- BACKGROUND                                    -->
            <!-- ============================================= -->

            <details
              class="mss-editor-property-group"
              data-editor-section="background"
              open>

              <summary class="mss-editor-summary-row">
                <span>Background</span>
              </summary>

              <div class="mss-editor-property-content">

                <label class="mss-editor-field">

                  <span>Image URL</span>

                  <input
                    id="editorBackgroundImage"
                    class="mss-editor-input"
                    type="text"
                    value="${this.workingView.imageUrl ?? ''}"
                    placeholder="/local/views/body.jpg">

                </label>

                <label class="mss-editor-field">

                  <span>
                    Viewer Size

                    <strong id="editorViewerScaleLabel">
                      ${Math.round((this.workingView.viewerScale ?? 1) * 100)}%
                    </strong>
                  </span>

                  <input
                    id="editorViewerScale"
                    class="mss-editor-input"
                    type="range"
                    min="0.5"
                    max="2"
                    step="0.1"
                    value="${this.workingView.viewerScale ?? 1}">

                </label>

                <input
                  id="editorBackgroundFile"
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                  hidden>

                <div class="mss-editor-inline-row">

                <button
                  id="browseBackgroundImage"
                  class="mss-editor-button secondary"
                  type="button">
                  Upload
                </button>

                <button
                  id="browseBackgroundMedia"
                  class="mss-editor-button secondary"
                  type="button">
                  Media library
                </button>

              </div>

              </div>

            </details>


            <!-- ============================================= -->
            <!-- AUTOMATIC VIEW                                -->
            <!-- ============================================= -->

            <details
              class="mss-editor-property-group"
              data-editor-section="automatic-routing"
              open>

              <summary class="mss-editor-summary-row">
                <span>Automatic View</span>
              </summary>

              <div class="mss-editor-property-content">

                <label class="mss-editor-checkbox">

                  <input
                    id="editorAutoRoutingEnabled"
                    type="checkbox"
                    ${this.workingView.autoRouting?.enabled ? 'checked' : ''}>

                  <span>
                    Automatically select this View
                  </span>

                </label>


                ${
                  this.workingView.autoRouting?.enabled
                    ? `

                        <!-- =============================== -->
                        <!-- ROUTING SOURCE                  -->
                        <!-- =============================== -->

                        <label
                          class="mss-editor-field"
                          style="margin-top:14px;">

                          <span>MSS source</span>

                          <select
                            id="editorAutoRoutingGroup"
                            class="mss-editor-input">

                            <option value="">
                              Any MSS source
                            </option>

                            ${this.getAvailableMssGroups()
                              .map(
                                (group) => `
                                  <option
                                    value="${group.id}"
                                    ${
                                      this.workingView.autoRouting?.mssGroup ===
                                      group.id
                                        ? 'selected'
                                        : ''
                                    }>
                                    ${group.label}
                                  </option>
                                `
                              )
                              .join('')}

                              <option
                                value="__custom__"
                                ${this.workingView.autoRouting?.sourceMode === 'custom' ? 'selected' : ''}>
                                Custom / Future Plan
                              </option>
                            </select>

                        </label>
                                ${
                                  this.workingView.autoRouting?.sourceMode ===
                                  'custom'
                                    ? `
                                      <label
                                        class="mss-editor-field"
                                        style="margin-top:14px;">

                                        <span>Control Plan</span>

                                        <input
                                          id="editorAutoRoutingManualControlPlan"
                                          class="mss-editor-input"
                                          type="text"
                                          value="${
                                            this.workingView.autoRouting
                                              ?.manualControlPlan ?? ''
                                          }"
                                          placeholder="Production_Line_A">

                                        <small class="mss-editor-help">
                                          ${
                                            this.workingView.autoRouting
                                              ?.manualControlPlan
                                              ? `MSS source: MSSReport_${this.workingView.autoRouting.manualControlPlan}`
                                              : 'Enter the Control Plan name'
                                          }
                                        </small>

                                      </label>
                                    `
                                    : ''
                                }

                        <!-- =============================== -->
                        <!-- CONDITIONS                      -->
                        <!-- =============================== -->

                        <div class="mss-routing-heading">
                          Conditions
                        </div>

                        ${
                          (this.workingView.autoRouting?.conditions ?? [])
                            .length >= 2
                            ? `
                                <label
                                  class="mss-editor-field"
                                  style="margin-bottom:14px;">

                                  <span>Match conditions</span>

                                  <select
                                    id="editorAutoRoutingConditionLogic"
                                    class="mss-editor-input">

                                    <option
                                      value="and"
                                      ${
                                        (this.workingView.autoRouting
                                          ?.conditionLogic ?? 'and') === 'and'
                                          ? 'selected'
                                          : ''
                                      }>
                                      All conditions (AND)
                                    </option>

                                    <option
                                      value="or"
                                      ${
                                        this.workingView.autoRouting
                                          ?.conditionLogic === 'or'
                                          ? 'selected'
                                          : ''
                                      }>
                                      Any condition (OR)
                                    </option>

                                  </select>

                                </label>
                              `
                            : ''
                        }


                        ${(this.workingView.autoRouting?.conditions ?? [])
                          .map((condition, index) => {
                            const routing = this.ensureAutoRoutingConfig();

                            /*
                             * If the View has a specific MSS
                             * source, use it.
                             *
                             * If the View is configured for
                             * Any MSS source, the condition's
                             * example source is used ONLY to
                             * browse/copy a real field.
                             */
                            const fieldSource =
                              routing.mssGroup ||
                              condition.exampleMssGroup ||
                              '';

                            const fieldOptions =
                              this.getAutoRoutingFieldOptions(fieldSource);

                            const selectedField = fieldOptions.find(
                              (field) => field.path === condition.field
                            );

                            return `

                                <div
                                  class="mss-routing-condition"
                                  data-routing-condition="${index}">


                                  <!-- ===================== -->
                                  <!-- REMOVE                -->
                                  <!-- ===================== -->

                                  <button
                                    class="mss-routing-remove"
                                    data-remove-routing-condition="${index}"
                                    type="button"
                                    title="Remove condition"
                                    aria-label="Remove condition">
                                    ${mssIcon('close', 16)}
                                  </button>


                                  <!-- ===================== -->
                                  <!-- EXAMPLE SOURCE         -->
                                  <!-- ===================== -->

                                  ${
                                    !routing.mssGroup
                                      ? `

                                          <label
                                            class="mss-routing-field-group">

                                            <span
                                              class="mss-routing-label">
                                              Example source
                                            </span>

                                            <select
                                              class="mss-editor-input"
                                              data-routing-example-group="${index}">

                                              <option value="">
                                                Select source to choose a field...
                                              </option>

                                              ${this.getAvailableMssGroups()
                                                .map(
                                                  (group) => `
                                                    <option
                                                      value="${group.id}"
                                                      ${
                                                        condition.exampleMssGroup ===
                                                        group.id
                                                          ? 'selected'
                                                          : ''
                                                      }>
                                                      ${group.label}
                                                    </option>
                                                  `
                                                )
                                                .join('')}

                                            </select>

                                          </label>
                                        `
                                      : ''
                                  }


                                 <!-- ===================== -->
                                  <!-- DATA FIELD             -->
                                  <!-- ===================== -->

                                  <label
                                    class="mss-routing-field-group">

                                    <span
                                      class="mss-routing-label">
                                      Data field
                                    </span>

                                    <input
                                      class="mss-editor-input"
                                      data-routing-field-search="${index}"
                                      type="text"
                                      placeholder="${
                                        fieldSource
                                          ? 'Search field...'
                                          : 'Select an example source first...'
                                      }"
                                      ${fieldSource ? '' : 'disabled'}>


                                    <div
                                      class="mss-data-field-list"
                                      data-routing-field-list="${index}">

                                      ${
                                        fieldSource
                                          ? this.groupMssFieldOptions(
                                              fieldOptions
                                            )
                                              .map(
                                                (group) => `

                                                  <div
                                                    class="mss-data-field-group"
                                                    data-routing-field-group>

                                                    <div
                                                      class="mss-data-field-group-title">
                                                      ${group.name}
                                                    </div>

                                                    ${group.options
                                                      .map(
                                                        (option) => `

                                                          <button
                                                            class="
                                                              mss-data-field-option
                                                              ${
                                                                option.path ===
                                                                condition.field
                                                                  ? 'selected'
                                                                  : ''
                                                              }
                                                            "
                                                            data-routing-field-option="${index}"
                                                            data-routing-field-path="${option.path}"
                                                            data-routing-field-label="${[
                                                              option.label,
                                                              option.path,
                                                              option.entityId,
                                                            ]
                                                              .filter(Boolean)
                                                              .join(' ')
                                                              .toLowerCase()}"
                                                            type="button">

                                                            <span
                                                              class="mss-data-field-option-label">

                                                              ${option.label
                                                                .split(' › ')
                                                                .slice(1)
                                                                .join(' › ')}

                                                            </span>

                                                          </button>
                                                        `
                                                      )
                                                      .join('')}

                                                  </div>
                                                `
                                              )
                                              .join('')
                                          : `
                                              <div class="mss-editor-empty">
                                                Select an example source first.
                                              </div>
                                            `
                                      }

                                    </div>

                                  </label>


                                  <!-- ===================== -->
                                  <!-- MATCHING               -->
                                  <!-- ===================== -->

                                  <label
                                    class="mss-routing-field-group">

                                    <span
                                      class="mss-routing-label">
                                      Matching
                                    </span>

                                    <select
                                      class="mss-editor-input"
                                      data-routing-match-mode="${index}">

                                      <option
                                        value="exact"
                                        ${
                                          (condition.matchMode ?? 'exact') ===
                                          'exact'
                                            ? 'selected'
                                            : ''
                                        }>
                                        Exact
                                      </option>

                                      <option
                                        value="wildcard"
                                        ${
                                          condition.matchMode === 'wildcard'
                                            ? 'selected'
                                            : ''
                                        }>
                                        Dynamic
                                      </option>

                                    </select>

                                  </label>


                                  <!-- ===================== -->
                                  <!-- DYNAMIC FIELD          -->
                                  <!-- ===================== -->

                                  ${
                                    condition.matchMode === 'wildcard'
                                      ? `

                                          <div
                                            class="mss-routing-dynamic">

                                            <div
                                              class="mss-routing-dynamic-title">
                                              Dynamic field
                                            </div>

                                            <div
                                              class="mss-routing-dynamic-name"
                                              data-routing-dynamic-name="${index}">

                                              ${
                                                selectedField?.label ??
                                                (condition.field
                                                  ? condition.field
                                                  : 'Select a data field first')
                                              }

                                            </div>

                                            <details
                                              class="mss-routing-advanced">

                                              <summary>
                                                Advanced pattern
                                              </summary>

                                              <textarea
                                                class="mss-editor-input mss-routing-pattern-input"
                                                data-routing-pattern="${index}"
                                                rows="3"
                                                spellcheck="false"
                                                placeholder="Dynamic field pattern">${
                                                  condition.pattern ?? ''
                                                }</textarea>

                                            </details>

                                          </div>
                                        `
                                      : ''
                                  }


                                  <!-- ===================== -->
                                  <!-- VALUE CONDITION        -->
                                  <!-- ===================== -->

                                  <div
                                    class="mss-routing-condition-value">

                                    <span
                                      class="mss-routing-label">
                                      Condition
                                    </span>

                                    <div
                                      class="mss-routing-condition-value-row">

                                      <select
                                        class="mss-editor-input"
                                        data-routing-operator="${index}">

                                        <option
                                          value="equals"
                                          ${
                                            (condition.operator ?? 'equals') ===
                                            'equals'
                                              ? 'selected'
                                              : ''
                                          }>
                                          Equals
                                        </option>

                                        <option
                                          value="notEquals"
                                          ${
                                            condition.operator === 'notEquals'
                                              ? 'selected'
                                              : ''
                                          }>
                                          Not equals
                                        </option>

                                      </select>

                                      <input
                                        class="mss-editor-input"
                                        data-routing-value="${index}"
                                        type="text"
                                        value="${condition.value ?? ''}"
                                        placeholder="Value">

                                    </div>

                                  </div>

                                </div>
                              `;
                          })
                          .join('')}


                        ${
                          this.workingView.autoRouting?.sourceMode !== 'custom'
                            ? `
                                <!-- =============================== -->
                                <!-- ADD CONDITION                   -->
                                <!-- =============================== -->

                                <button
                                  id="addAutoRoutingCondition"
                                  class="mss-editor-action-button"
                                  type="button">
                                  + Add condition
                                </button>
                              `
                            : ''
                        }

                        ${
                          this.workingView.autoRouting?.sourceMode === 'custom'
                            ? `
                                <small class="mss-editor-help">
                                  Custom / Future Plan is available for source-only routing.
                                </small>
                              `
                            : ''
                        }
                      `
                    : ''
                }

              </div>

            </details>
          `
        : ''
    }


    ${!this.selectedShape ? overlayProperties : ''}


    <!-- ==================================================== -->
    <!-- SELECTED ELEMENT                                     -->
    <!-- ==================================================== -->

    ${
      !this.selectedShape && this.selectedOverlayElement
        ? `

            <div class="mss-editor-property-group">

              <h3>
                Selected Element
              </h3>


              <!-- ELEMENT TYPE -->

              <label class="mss-editor-field">

                <span>Element type</span>

                <select
                  id="editorElementType"
                  class="mss-editor-input">

                  <option
                    value="0"
                    ${
                      Number(this.selectedOverlayElement.elementType) === 0
                        ? 'selected'
                        : ''
                    }>
                    Text
                  </option>

                  <option
                    value="1"
                    ${
                      Number(this.selectedOverlayElement.elementType) === 1
                        ? 'selected'
                        : ''
                    }>
                    Status
                  </option>

                </select>

              </label>


              <!-- NAME -->

              <label class="mss-editor-field">

                <span>Name</span>

                <input
                  id="editorElementName"
                  class="mss-editor-input"
                  type="text"
                  value="${this.selectedOverlayElement.name ?? ''}">

              </label>


              <!-- MSS SOURCE -->

              <label class="mss-editor-field">

                <span>MSS source</span>

                <select
                  id="editorElementMssGroup"
                  class="mss-editor-input">

                  <option value="">
                    Select MSS source...
                  </option>

                  ${this.getAvailableMssGroups()
                    .map(
                      (group) => `
                        <option
                          value="${group.id}"
                          ${
                            this.selectedOverlayElement?.mssGroup === group.id
                              ? 'selected'
                              : ''
                          }>
                          ${group.label}
                        </option>
                      `
                    )
                    .join('')}

                </select>

              </label>


              <!-- DATA FIELD -->

              <label class="mss-editor-field">

                <span>Data field</span>

                <input
                  id="editorElementDataFieldSearch"
                  class="mss-editor-input"
                  type="text"
                  placeholder="Search field...">

                <div
                  id="editorElementDataFieldList"
                  class="mss-data-field-list">

                  ${
                    selectedDataPath && !selectedPathExists
                      ? `
                          <button
                            class="mss-data-field-option selected"
                            data-data-path="${selectedDataPath}"
                            data-data-label="${selectedDataPath.toLowerCase()}"
                            type="button">

                            ${selectedDataPath}

                            <span
                              class="mss-data-field-unavailable">
                              Waiting for MQTT data
                            </span>

                          </button>
                        `
                      : ''
                  }

                  ${
                    smartDataFieldOptions.length > 0
                      ? `
                    <div
                      class="mss-data-field-group"
                      data-data-group>

                      <div class="mss-data-field-group-title">
                        Suggested combinations
                      </div>

                      ${smartDataFieldOptions
                        .map(
                          (option) => `
                            <button
                              class="
                                mss-data-field-option
                                ${option.smartKey === selectedSmartKey ? 'selected' : ''}
                              "
                              data-smart-key="${option.smartKey}"
                              data-binding-type="${option.bindingType}"
                              data-data-label="${option.searchLabel.toLowerCase()}"
                              type="button">

                              <span class="mss-data-field-option-label">
                                ${option.label}
                              </span>

                              <span class="mss-data-field-option-secondary">
                                ${option.secondaryLabel}
                              </span>

                            </button>
                          `
                        )
                        .join('')}

                    </div>
                  `
                      : ''
                  }

                  ${this.getGroupedMssDataFields()
                    .map(
                      (group) => `

                        <div
                          class="mss-data-field-group"
                          data-data-group>

                          <div
                            class="mss-data-field-group-title">
                            ${group.name}
                          </div>

                          ${group.options
                            .map(
                              (option) => `

                                <button
                                  class="
                                    mss-data-field-option
                                    ${
                                      option.path === selectedDataPath
                                        ? 'selected'
                                        : ''
                                    }
                                  "
                                  data-data-path="${option.path}"
                                  data-data-entity="${option.entityId}"
                                  data-data-label="${[
                                    option.label,
                                    option.path,
                                    option.entityId,
                                  ]
                                    .filter(Boolean)
                                    .join(' ')
                                    .toLowerCase()}"
                                  title="${option.label}"
                                  type="button">

                                  <span
                                    class="mss-data-field-option-label">

                                    ${option.label
                                      .split(' › ')
                                      .slice(1)
                                      .join(' › ')}

                                  </span>

                                </button>
                              `
                            )
                            .join('')}

                        </div>
                      `
                    )
                    .join('')}

                </div>

              </label>


              <!-- FONT SIZE -->

              <label class="mss-editor-field">

                <span>Font size</span>

                <input
                  id="editorElementFontSize"
                  class="mss-editor-input"
                  type="number"
                  min="8"
                  max="72"
                  value="${this.selectedOverlayElement.fontSize ?? 14}">

              </label>


              <!-- STATUS OPTIONS -->

              ${
                Number(this.selectedOverlayElement.elementType) === 1
                  ? `

                      <label class="mss-editor-field">

                        <span>Operator</span>

                        <select
                          id="editorElementOperator"
                          class="mss-editor-input">

                          <option
                            value="equals"
                            ${
                              this.selectedOverlayElement.operator === 'equals'
                                ? 'selected'
                                : ''
                            }>
                            Equals
                          </option>

                          <option
                            value="notEquals"
                            ${
                              this.selectedOverlayElement.operator ===
                              'notEquals'
                                ? 'selected'
                                : ''
                            }>
                            Not equals
                          </option>

                          <option
                            value="greaterThan"
                            ${
                              this.selectedOverlayElement.operator ===
                              'greaterThan'
                                ? 'selected'
                                : ''
                            }>
                            Greater than
                          </option>

                          <option
                            value="lessThan"
                            ${
                              this.selectedOverlayElement.operator ===
                              'lessThan'
                                ? 'selected'
                                : ''
                            }>
                            Less than
                          </option>

                        </select>

                      </label>


                      <label class="mss-editor-field">

                        <span>Compare value</span>

                        <input
                          id="editorCompareValue"
                          class="mss-editor-input"
                          type="text"
                          value="${
                            this.selectedOverlayElement.compareValue ?? ''
                          }">

                      </label>


                      <label class="mss-editor-field">

                        <span>True text</span>

                        <input
                          id="editorTrueText"
                          class="mss-editor-input"
                          type="text"
                          value="${
                            this.selectedOverlayElement.trueText ?? 'OK'
                          }">

                      </label>


                      <label class="mss-editor-field">

                        <span>False text</span>

                        <input
                          id="editorFalseText"
                          class="mss-editor-input"
                          type="text"
                          value="${
                            this.selectedOverlayElement.falseText ?? 'NOK'
                          }">

                      </label>
                    `
                  : ''
              }

            </div>
          `
        : ''
    }
  `;
  }

  // Renders the editable image canvas and all current overlays.
  renderCanvas() {
    const view = this.workingView;

    if (!view) {
      return '';
    }

    return `
    <div class="mss-editor-canvas-shell">

      <div class="mss-editor-stage-zoom">

        <div
          class="
            mss-editor-stage
            ${this.gridEnabled ? 'grid-enabled' : ''}
          ">

          <img
            src="${view.imageUrl ?? '/local/views/body.jpg'}"
            class="mss-editor-stage-image"
            alt="${view.name ?? 'MSS View'}">

          <div
            class="mss-editor-grid-overlay"
            aria-hidden="true">
          </div>

          ${(view.overlays ?? [])
            .map((overlay) => this.renderOverlay(overlay, true))
            .join('')}

          ${(view.shapes ?? [])
            .map((shape) => this.renderShape(shape, true))
            .join('')}

        </div>

      </div>

    </div>
  `;
  }

  renderImageShapeProperties() {
    const shape = this.selectedShape;

    if (!shape || shape.type !== 'image') {
      return '';
    }

    const uploadState =
      this.localImageUploadState?.shapeId === shape.id
        ? this.localImageUploadState
        : {
            uploading: false,
            error: '',
          };

    return `
    <details
      class="mss-editor-property-group"
      data-editor-section="image-shape"
      open>

      <summary class="mss-editor-summary-row">
        <span>Image</span>
      </summary>

      <div class="mss-editor-property-content">

        <!-- ======================================================
             SOURCE
             ====================================================== -->

        <label class="mss-editor-field">
          <span>Source</span>

          <select
            id="editorImageShapeSource"
            class="mss-editor-input">

            <option
              value="mqtt"
              ${shape.imageSource === 'mqtt' ? 'selected' : ''}>
              MQTT
            </option>

            <option
              value="local"
              ${shape.imageSource === 'local' ? 'selected' : ''}>
              Local image
            </option>

          </select>
        </label>

        <!-- ======================================================
             SOURCE-SPECIFIC PROPERTIES
             ====================================================== -->

        ${
          shape.imageSource === 'mqtt'
            ? `
                <!-- ==============================================
                     MQTT BINDING MODE
                     ============================================== -->

                <label class="mss-editor-field">
                  <span>Binding</span>

                  <select
                    id="editorImageShapeBindingMode"
                    class="mss-editor-input">

                    <option
                      value="exact"
                      ${shape.bindingMode !== 'dynamic' ? 'selected' : ''}>
                      Exact
                    </option>

                    <option
                      value="dynamic"
                      ${shape.bindingMode === 'dynamic' ? 'selected' : ''}>
                      Dynamic
                    </option>

                  </select>
                </label>

                ${
                  shape.bindingMode !== 'dynamic'
                    ? `
                        <!-- ======================================
                             EXACT MQTT BINDING
                             ====================================== -->

                        <label class="mss-editor-field">
                          <span>MSS source</span>

                          <select
                            id="editorImageShapeMssGroup"
                            class="mss-editor-input">

                            <option value="">
                              Select MSS source
                            </option>

                            ${this.getAvailableMssImageGroups()
                              .map(
                                (group) => `
                                  <option
                                    value="${group.id}"
                                    ${
                                      shape.mssGroup === group.id
                                        ? 'selected'
                                        : ''
                                    }>
                                    ${group.label}
                                  </option>
                                `
                              )
                              .join('')}

                          </select>
                        </label>

                        <label class="mss-editor-field">
                          <span>Image field</span>

                          <select
                            id="editorImageShapeDataPath"
                            class="mss-editor-input">

                            <option value="">
                              Select image field
                            </option>

                            ${(this.availableMssImages ?? [])
                              .filter(
                                (image) =>
                                  !shape.mssGroup ||
                                  image.group === shape.mssGroup
                              )
                              .map((image) => {
                                const availability =
                                  image.available === false
                                    ? ' — waiting for live data'
                                    : '';

                                return `
                                  <option
                                    value="${image.path}"
                                    ${
                                      shape.dataPath === image.path
                                        ? 'selected'
                                        : ''
                                    }>
                                    ${this.formatMssFieldLabel(
                                      image.path.split('.').pop()
                                    )}${availability}
                                  </option>
                                `;
                              })
                              .join('')}

                          </select>
                        </label>
                      `
                    : `
                        <!-- ======================================
                             DYNAMIC MQTT BINDING
                             ====================================== -->

                        <label class="mss-editor-field">
                          <span>Source pattern</span>

                          <input
                            id="editorImageShapeGroupPattern"
                            class="mss-editor-input"
                            type="text"
                            value="${shape.groupPattern ?? ''}"
                            placeholder="MSSReport_*">
                        </label>

                        <label class="mss-editor-field">
                          <span>Image path pattern</span>

                          <input
                            id="editorImageShapePathPattern"
                            class="mss-editor-input"
                            type="text"
                            value="${shape.pathPattern ?? ''}"
                            placeholder="rootNode.LastMeasurement_*...">
                        </label>
                      `
                }
              `
            : `
                <div class="mss-editor-field">
                  <span>Local image</span>

                  <input
                    id="editorImageShapeUrl"
                    class="mss-editor-input"
                    type="text"
                    value="${shape.imageUrl ?? ''}"
                    placeholder="No image selected"
                    readonly>

                  <div class="mss-editor-inline-row">

                        <button
                          id="editorImageShapeBrowse"
                          class="mss-editor-button secondary"
                          type="button"
                          ${uploadState.uploading ? 'disabled' : ''}>
                          ${uploadState.uploading ? 'Uploading...' : 'Upload'}
                        </button>

                        <button
                          id="editorImageShapeMedia"
                          class="mss-editor-button secondary"
                          type="button"
                          ${uploadState.uploading ? 'disabled' : ''}>
                          Media library
                        </button>

                    ${
                      shape.imageUrl
                        ? `
                            <button
                              id="editorImageShapeRemove"
                              class="mss-editor-button danger"
                              type="button"
                              ${uploadState.uploading ? 'disabled' : ''}>
                              Remove
                            </button>
                          `
                        : ''
                    }

                  </div>

                  ${
                    uploadState.error
                      ? `
                          <div class="mss-editor-field-error">
                            ${uploadState.error}
                          </div>
                        `
                      : ''
                  }

                  <input
                    id="editorImageShapeFile"
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                    hidden>
                </div>
              `
        }

        <!-- ======================================================
             FIT
             ====================================================== -->

        <label class="mss-editor-field">
          <span>Fit</span>

          <select
            id="editorImageShapeFit"
            class="mss-editor-input">

            <option
              value="contain"
              ${shape.fit === 'contain' ? 'selected' : ''}>
              Contain
            </option>

            <option
              value="cover"
              ${shape.fit === 'cover' ? 'selected' : ''}>
              Cover
            </option>

            <option
              value="fill"
              ${shape.fit === 'fill' ? 'selected' : ''}>
              Fill
            </option>

          </select>
        </label>

      </div>
    </details>
  `;
  }

  renderRectangleShapeProperties() {
    const shape = this.selectedShape;

    if (!shape || shape.type !== 'rectangle') {
      return '';
    }

    return `
    <details
      class="mss-editor-property-group"
      data-editor-section="rectangle-shape"
      open>

      <summary class="mss-editor-summary-row">
        <span>Rectangle</span>
      </summary>

      <div class="mss-editor-property-content">

        <!-- ======================================================
             FILL
             ====================================================== -->

        <label class="mss-editor-field">
          <span>Fill color</span>

          <input
              id="editorRectangleFillColor"
              class="mss-editor-color-input"
              type="color"
              value="${shape.color ?? '#00a586'}"
              ${shape.fillTransparent ? 'disabled' : ''}>
            <label class="mss-editor-field checkbox">
              <input
                id="editorRectangleFillTransparent"
                type="checkbox"
                ${shape.fillTransparent ? 'checked' : ''}>

              <span>Transparent fill</span>
            </label>
        </label>




        <!-- ======================================================
             BORDER
             ====================================================== -->

        <label class="mss-editor-field">
          <span>Border color</span>

          <input
            id="editorRectangleBorderColor"
            class="mss-editor-color-input"
            type="color"
            value="${shape.borderColor ?? '#000000'}">
        </label>

        <label class="mss-editor-field">
          <span>Border width</span>

          <input
            id="editorRectangleBorderWidth"
            class="mss-editor-input"
            type="number"
            min="0"
            max="20"
            step="1"
            value="${Number(shape.borderWidth ?? 0)}">
        </label>

        <label class="mss-editor-field">
          <span>Border radius</span>

          <input
            id="editorRectangleBorderRadius"
            class="mss-editor-input"
            type="number"
            min="0"
            max="100"
            step="1"
            value="${Number(shape.borderRadius ?? 0)}">
        </label>


        <!-- ======================================================
             OPACITY
             ====================================================== -->

        <label class="mss-editor-field">
          <span>Opacity</span>

          <input
            id="editorRectangleOpacity"
            class="mss-editor-input"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value="${Number(shape.opacity ?? 1)}">
        </label>


        <!-- ======================================================
             CONDITIONAL FILL
             ====================================================== -->

        ${this.renderShapeConditionalColorProperties(shape, {
          toggleLabel: 'Conditional fill',
          colorLabel: 'Conditional fill color',
        })}

      </div>

    </details>
  `;
  }

  renderCircleShapeProperties() {
    const shape = this.selectedShape;

    if (!shape || shape.type !== 'circle') {
      return '';
    }

    return `
    <details
      class="mss-editor-property-group"
      data-editor-section="circle-shape"
      open>

      <summary
        class="mss-editor-summary-row">

        <span>Circle</span>

      </summary>

      <div
        class="mss-editor-property-content">

        <label
          class="mss-editor-field">

          <span>Fill color</span>

          <input
            id="editorCircleFillColor"
            class="mss-editor-color-input"
            type="color"
            value="${shape.color ?? '#00a586'}"
            ${shape.fillTransparent ? 'disabled' : ''}>
            <label class="mss-editor-field checkbox">
            <input
              id="editorCircleFillTransparent"
              type="checkbox"
              ${shape.fillTransparent ? 'checked' : ''}>

            <span>Transparent fill</span>
          </label>

        </label>


        <label
          class="mss-editor-field">

          <span>Border color</span>

          <input
            id="editorCircleBorderColor"
            class="mss-editor-color-input"
            type="color"
            value="${shape.borderColor ?? '#000000'}">

        </label>


        <label
          class="mss-editor-field">

          <span>Border width</span>

          <input
            id="editorCircleBorderWidth"
            class="mss-editor-input"
            type="number"
            min="0"
            max="20"
            step="1"
            value="${Number(shape.borderWidth ?? 0)}">

        </label>


        <label
          class="mss-editor-field">

          <span>Opacity</span>

          <input
            id="editorCircleOpacity"
            class="mss-editor-input"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value="${Number(shape.opacity ?? 1)}">

        </label>


        ${this.renderShapeConditionalColorProperties(shape, {
          toggleLabel: 'Conditional fill',

          colorLabel: 'Conditional fill color',
        })}

      </div>

    </details>
  `;
  }

  bindShapeConditionalColorEvents(shape, { updatePreview = null } = {}) {
    if (!shape) {
      return;
    }

    const enabled = this.shadowRoot?.querySelector(
      '#editorShapeConditionalEnabled'
    );

    const group = this.shadowRoot?.querySelector(
      '#editorShapeConditionalGroup'
    );

    const search = this.shadowRoot?.querySelector(
      '#editorShapeConditionalFieldSearch'
    );

    const operator = this.shadowRoot?.querySelector(
      '#editorShapeConditionalOperator'
    );

    const compare = this.shadowRoot?.querySelector(
      '#editorShapeConditionalCompare'
    );

    const color = this.shadowRoot?.querySelector(
      '#editorShapeConditionalColor'
    );

    const fieldOptions = Array.from(
      this.shadowRoot?.querySelectorAll('[data-shape-condition-path]') ?? []
    );

    const fieldGroups = Array.from(
      this.shadowRoot?.querySelectorAll('[data-shape-condition-group]') ?? []
    );

    const ensureCondition = () => {
      shape.conditionalStyle ??= {
        enabled: false,
        mssGroup: '',
        dataPath: '',
        operator: 'equals',
        compareValue: '',
        color: shape.color ?? '#00a586',
      };

      return shape.conditionalStyle;
    };

    const refreshPreview = () => {
      updatePreview?.();

      this.viewDirty = true;
    };

    // ==========================================================
    // ENABLE / DISABLE
    // ==========================================================

    if (enabled) {
      enabled.onchange = () => {
        const condition = ensureCondition();

        condition.enabled = enabled.checked;

        this.renderPanels();

        refreshPreview();
      };
    }

    // ==========================================================
    // MSS SOURCE
    // ==========================================================

    if (group) {
      group.onchange = () => {
        const condition = ensureCondition();

        condition.mssGroup = group.value;

        condition.dataPath = '';

        /*
         * Rebuild is required here because changing source
         * changes the entire set of available fields.
         */
        this.renderPanels();

        refreshPreview();
      };
    }

    // ==========================================================
    // FIELD SEARCH
    // ==========================================================

    const normalizeSearchText = (value) =>
      String(value ?? '')
        .toLowerCase()
        .replace(/[_./\\›\-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (search) {
      search.oninput = () => {
        const query = normalizeSearchText(search.value);

        const tokens = query ? query.split(' ') : [];

        fieldOptions.forEach((option) => {
          const searchable = normalizeSearchText(
            option.dataset.shapeConditionLabel ?? option.textContent ?? ''
          );

          const matches =
            tokens.length === 0 ||
            tokens.every((token) => searchable.includes(token));

          option.style.display = matches ? '' : 'none';
        });

        fieldGroups.forEach((fieldGroup) => {
          const options = Array.from(
            fieldGroup.querySelectorAll('[data-shape-condition-path]')
          );

          const hasVisible = options.some(
            (option) => option.style.display !== 'none'
          );

          fieldGroup.style.display = hasVisible ? '' : 'none';
        });
      };
    }

    // ==========================================================
    // FIELD SELECTION
    // ==========================================================

    const fields = this.getMssFieldOptionsForGroup(
      shape.conditionalStyle?.mssGroup
    );

    fieldOptions.forEach((option) => {
      option.onclick = () => {
        const condition = ensureCondition();

        condition.dataPath = option.dataset.shapeConditionPath ?? '';

        // Do not rebuild the panel here.
        // This preserves Data Field scroll position.
        fieldOptions.forEach((item) => {
          item.classList.toggle('selected', item === option);
        });

        const selectedDisplay = this.shadowRoot?.querySelector(
          '#editorShapeSelectedConditionalField'
        );

        const selectedField = fields.find(
          (field) => field.path === condition.dataPath
        );

        if (selectedDisplay) {
          selectedDisplay.textContent =
            selectedField?.label ?? condition.dataPath ?? 'No field selected';

          selectedDisplay.classList.toggle('empty', !selectedField);
        }

        refreshPreview();
      };
    });

    // ==========================================================
    // OPERATOR
    // ==========================================================

    if (operator) {
      operator.onchange = () => {
        const condition = ensureCondition();

        condition.operator = operator.value;

        refreshPreview();
      };
    }

    // ==========================================================
    // COMPARE VALUE
    // ==========================================================

    if (compare) {
      compare.oninput = () => {
        const condition = ensureCondition();

        condition.compareValue = compare.value;

        refreshPreview();
      };
    }

    // ==========================================================
    // CONDITIONAL COLOR
    // ==========================================================

    if (color) {
      color.oninput = () => {
        const condition = ensureCondition();

        condition.color = color.value;

        refreshPreview();
      };
    }
  }
  // ============================================================
  // GENERIC SHAPE CONDITIONAL COLOR PROPERTIES
  // ============================================================
  //
  // Used by color-capable Shapes:
  //
  // Rectangle -> fill
  // Circle    -> fill
  // Line      -> stroke
  // Arrow     -> stroke
  // Text      -> text color
  //
  // shape.color is always the normal / condition-false color.
  // conditionalStyle.color is used when the condition is true.
  // ============================================================

  renderShapeConditionalColorProperties(
    shape,
    { toggleLabel = 'Conditional color', colorLabel = 'Conditional color' } = {}
  ) {
    if (!shape) {
      return '';
    }

    const condition = shape.conditionalStyle ?? {};

    const fields = this.getMssFieldOptionsForGroup(condition.mssGroup);

    const selectedField = fields.find(
      (field) => field.path === condition.dataPath
    );

    return `
    <div class="mss-editor-conditional-section">

      <label class="mss-editor-field checkbox">
        <input
          id="editorShapeConditionalEnabled"
          type="checkbox"
          ${condition.enabled ? 'checked' : ''}>

        <span>${toggleLabel}</span>
      </label>

      ${
        condition.enabled
          ? `
              <div class="mss-editor-conditional-content">

                <!-- ============================================
                     MSS SOURCE
                     ============================================ -->

                <label class="mss-editor-field">
                  <span>MSS source</span>

                  <select
                    id="editorShapeConditionalGroup"
                    class="mss-editor-input">

                    <option value="">
                      Select MSS source
                    </option>

                    ${this.getAvailableMssGroups()
                      .map(
                        (group) => `
                          <option
                            value="${group.id}"
                            ${
                              condition.mssGroup === group.id ? 'selected' : ''
                            }>
                            ${group.label}
                          </option>
                        `
                      )
                      .join('')}

                  </select>
                </label>


                <!-- ============================================
                     DATA FIELD
                     ============================================ -->

                <label class="mss-editor-field">
                  <span>Data field</span>

                  <div
                    id="editorShapeSelectedConditionalField"
                    class="
                      mss-editor-selected-field
                      ${selectedField ? '' : 'empty'}
                    ">
                    ${selectedField?.label ?? 'No field selected'}
                  </div>

                  <input
                    id="editorShapeConditionalFieldSearch"
                    class="mss-editor-input"
                    type="text"
                    placeholder="Search field...">

                  <div
                    id="editorShapeConditionalFieldList"
                    class="mss-data-field-list">

                    ${this.groupMssFieldOptions(fields)
                      .map(
                        (group) => `
                          <div
                            class="mss-data-field-group"
                            data-shape-condition-group>

                            <div
                              class="mss-data-field-group-title">
                              ${group.name}
                            </div>

                            ${group.options
                              .map(
                                (option) => `
                                  <button
                                    class="
                                      mss-data-field-option
                                      ${
                                        option.path === condition.dataPath
                                          ? 'selected'
                                          : ''
                                      }
                                    "
                                    data-shape-condition-path="${option.path}"
                                    data-shape-condition-label="${[
                                      option.label,
                                      option.path,
                                      option.entityId,
                                    ]
                                      .filter(Boolean)
                                      .join(' ')
                                      .toLowerCase()}"
                                    title="${option.label}"
                                    type="button">

                                    <span
                                      class="mss-data-field-option-label">

                                      ${option.label
                                        .split(' › ')
                                        .slice(1)
                                        .join(' › ')}

                                    </span>

                                  </button>
                                `
                              )
                              .join('')}

                          </div>
                        `
                      )
                      .join('')}

                  </div>
                </label>


                <!-- ============================================
                     OPERATOR
                     ============================================ -->

                <label class="mss-editor-field">
                  <span>Operator</span>

                  <select
                    id="editorShapeConditionalOperator"
                    class="mss-editor-input">

                    <option
                      value="equals"
                      ${condition.operator === 'equals' ? 'selected' : ''}>
                      Equals
                    </option>

                    <option
                      value="notEquals"
                      ${condition.operator === 'notEquals' ? 'selected' : ''}>
                      Not equals
                    </option>

                    <option
                      value="greaterThan"
                      ${condition.operator === 'greaterThan' ? 'selected' : ''}>
                      Greater than
                    </option>

                    <option
                      value="lessThan"
                      ${condition.operator === 'lessThan' ? 'selected' : ''}>
                      Less than
                    </option>

                  </select>
                </label>


                <!-- ============================================
                     COMPARE VALUE
                     ============================================ -->

                <label class="mss-editor-field">
                  <span>Compare value</span>

                  <input
                    id="editorShapeConditionalCompare"
                    class="mss-editor-input"
                    type="text"
                    value="${condition.compareValue ?? ''}">
                </label>


                <!-- ============================================
                     CONDITIONAL COLOR
                     ============================================ -->

                <label class="mss-editor-field">
                  <span>${colorLabel}</span>

                  <input
                    id="editorShapeConditionalColor"
                    class="mss-editor-color-input"
                    type="color"
                    value="${condition.color ?? '#00a586'}">
                </label>

              </div>
            `
          : ''
      }

    </div>
  `;
  }

  renderShapeList() {
    const shapes = this.workingView?.shapes ?? [];

    if (shapes.length === 0) {
      return `
      <div class="mss-editor-empty">
        No shapes yet.
      </div>
    `;
    }

    return shapes
      .map((shape) => {
        const selected = String(this.selectedShape?.id) === String(shape.id);

        return `
        <button
          class="
            mss-editor-object
            ${selected ? 'selected' : ''}
          "
          data-editor-shape="${shape.id}"
          type="button"
          draggable="true">

          <span class="mss-editor-object-icon">
            ${shape.type === 'rectangle' ? '□' : '●'}
          </span>

          <span>
            ${shape.name ?? 'Shape'}
          </span>

        </button>
      `;
      })
      .join('');
  }

  async loadAvailableMssImages() {
    if (!this._hass?.connection) {
      this.availableMssImages = [];
      return;
    }

    try {
      const result = await this._hass.connection.sendMessagePromise({
        type: 'mss/images/list',
      });

      this.availableMssImages = result?.images ?? [];
    } catch (error) {
      console.error('Could not load MSS image fields.', error);

      this.availableMssImages = [];
    }
  }

  async openMediaImagePicker(onSelect) {
    const hass = this._hass;

    if (!hass?.connection) {
      return;
    }

    // ============================================================
    // ENSURE HOME ASSISTANT MEDIA COMPONENT EXISTS
    // ============================================================

    let MediaBrowser = customElements.get('ha-media-player-browse');

    if (!MediaBrowser) {
      /*
       * HA may not have loaded the Media Browser component yet.
       *
       * Ask HA to browse the local media source first.
       * This confirms Media Source is available while we wait
       * briefly for the frontend component to become registered.
       */
      try {
        await hass.connection.sendMessagePromise({
          type: 'media_source/browse_media',

          media_content_id: 'media-source://media_source/local/.',
        });
      } catch (error) {
        console.error(
          'Could not initialize Home Assistant media source.',
          error
        );
      }

      /*
       * Give already-loading HA frontend modules a short chance
       * to register the custom element.
       */
      for (let attempt = 0; attempt < 20; attempt += 1) {
        MediaBrowser = customElements.get('ha-media-player-browse');

        if (MediaBrowser) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    if (!customElements.get('ha-media-player-browse')) {
      console.error('Home Assistant Media Browser component is not loaded.');

      this.showSaveStatus('Open Media once, then try again');

      return;
    }

    // ============================================================
    // MODAL OVERLAY
    // ============================================================

    const overlay = document.createElement('div');

    overlay.style.cssText = `
    position:fixed;
    inset:0;

    display:flex;
    align-items:center;
    justify-content:center;

    padding:32px;

    box-sizing:border-box;

    background:
      rgba(0, 0, 0, 0.62);

    z-index:100000;
  `;

    const dialog = document.createElement('div');

    dialog.style.cssText = `
    width:min(1100px, 94vw);
    height:min(760px, 90vh);

    display:flex;
    flex-direction:column;

    overflow:hidden;

    background:
      var(
        --card-background-color,
        #ffffff
      );

    border:
      1px solid
      var(
        --divider-color,
        rgba(127,127,127,0.25)
      );

    border-radius:12px;

    box-shadow:
      0 18px 60px
      rgba(0,0,0,0.4);
  `;

    // ============================================================
    // HEADER
    // ============================================================

    const header = document.createElement('div');

    header.style.cssText = `
    min-height:56px;

    display:flex;
    align-items:center;
    justify-content:space-between;

    gap:16px;

    padding:0 16px 0 20px;

    box-sizing:border-box;

    border-bottom:
      1px solid
      var(
        --divider-color,
        rgba(127,127,127,0.25)
      );

    flex-shrink:0;
  `;

    const title = document.createElement('strong');

    title.textContent = 'Choose image';

    title.style.cssText = `
    color:
      var(
        --primary-text-color,
        #111111
      );

    font-size:16px;
  `;

    const close = document.createElement('button');

    close.type = 'button';

    close.innerHTML = mssIcon('close', 18);

    close.setAttribute('aria-label', 'Close');

    close.style.cssText = `
    width:38px;
    height:38px;

    display:flex;
    align-items:center;
    justify-content:center;

    padding:0;

    color:
      var(
        --primary-text-color,
        #111111
      );

    background:transparent;

    border:0;
    border-radius:50%;

    cursor:pointer;
  `;

    header.append(title, close);

    // ============================================================
    // NATIVE HA MEDIA BROWSER
    // ============================================================

    const browser = document.createElement('ha-media-player-browse');

    browser.hass = hass;

    browser.action = 'pick';

    browser.dialog = true;

    browser.accept = ['image/jpeg', 'image/png', 'image/webp'];

    browser.navigateIds = [
      {
        media_content_id: 'media-source://media_source/local/.',

        media_content_type: '',
      },
    ];

    browser.style.cssText = `
    display:block;

    width:100%;
    height:100%;

    min-height:0;

    flex:1;
  `;

    // ============================================================
    // CLOSE
    // ============================================================

    const cleanup = () => {
      document.removeEventListener('keydown', handleKeyDown);

      overlay.remove();
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        cleanup();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    close.onclick = cleanup;

    overlay.onclick = (event) => {
      if (event.target === overlay) {
        cleanup();
      }
    };

    // ============================================================
    // MEDIA SELECTED
    // ============================================================

    browser.addEventListener(
      'media-picked',
      async (event) => {
        const item = event.detail?.item;

        if (!item?.media_content_id) {
          return;
        }

        try {
          const resolved = await hass.connection.sendMessagePromise({
            type: 'media_source/resolve_media',

            media_content_id: item.media_content_id,
          });

          await onSelect?.({
            mediaContentId: item.media_content_id,

            mediaContentType: item.media_content_type,

            title: item.title,

            url: resolved.url,

            mimeType: resolved.mime_type,
          });
        } catch (error) {
          console.error('Failed to resolve selected media.', error);
        } finally {
          cleanup();
        }
      },
      {
        once: true,
      }
    );

    dialog.append(header, browser);

    overlay.appendChild(dialog);

    document.body.appendChild(overlay);
  }

  async loadImageShapeData(shape) {
    if (
      !shape ||
      shape.type !== 'image' ||
      shape.imageSource !== 'mqtt' ||
      !shape.mssGroup ||
      !shape.dataPath ||
      !this._hass?.connection
    ) {
      return;
    }

    try {
      const result = await this._hass.connection.sendMessagePromise({
        type: 'mss/images/get',
        group: shape.mssGroup,
        path: shape.dataPath,
      });

      shape.liveImageUrl = `data:${result.mimetype};base64,${result.data}`;
    } catch (error) {
      shape.liveImageUrl = '';

      /*
       * A known historical image field may not yet have received
       * live image data during this HA runtime.
       */
      if (error?.code !== 'image_not_found') {
        console.error('Could not load MSS image.', error);
      }
    }
  }

  // Updates the background image immediately.
  bindBackgroundImageEvent() {
    const input = this.shadowRoot?.querySelector('#editorBackgroundImage');

    if (!input) {
      return;
    }

    input.oninput = () => {
      this.workingView.backgroundMediaContentId = '';
      this.workingView.backgroundMediaContentType = '';
      this.workingView.backgroundMediaTitle = '';

      this.workingView.imageUrl = input.value;

      const image = this.shadowRoot?.querySelector('.mss-editor-stage-image');

      if (image) {
        image.src = input.value;
      }
    };
  }

  bindBackgroundBrowseEvent() {
    const browseButton = this.shadowRoot?.querySelector(
      '#browseBackgroundImage'
    );

    const mediaButton = this.shadowRoot?.querySelector(
      '#browseBackgroundMedia'
    );

    const fileInput = this.shadowRoot?.querySelector('#editorBackgroundFile');

    const urlInput = this.shadowRoot?.querySelector('#editorBackgroundImage');

    if (!browseButton || !fileInput) {
      return;
    }

    if (mediaButton) {
      mediaButton.onclick = async () => {
        await this.openMediaImagePicker(async (selectedMedia) => {
          // Stable HA Media reference.
          this.workingView.backgroundMediaContentId =
            selectedMedia.mediaContentId;

          this.workingView.backgroundMediaContentType =
            selectedMedia.mediaContentType;

          this.workingView.backgroundMediaTitle = selectedMedia.title;

          // Temporary resolved URL for the current session.
          this.workingView.imageUrl = selectedMedia.url;

          if (urlInput) {
            urlInput.value = selectedMedia.url;
          }

          const image = this.shadowRoot?.querySelector(
            '.mss-editor-stage-image'
          );

          if (image) {
            image.src = selectedMedia.url;
          }

          this.viewDirty = true;

          this.showSaveStatus('Background selected');
        });
      };
    }

    browseButton.onclick = () => {
      fileInput.click();
    };

    fileInput.onchange = async () => {
      const file = fileInput.files?.[0];

      if (!file) {
        return;
      }

      // ========================================================
      // VALIDATE CLIENT-SIDE TYPE
      // ========================================================

      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

      if (!allowedTypes.includes(file.type)) {
        this.showSaveStatus('Unsupported image type');

        return;
      }

      // ========================================================
      // VALIDATE CLIENT-SIDE SIZE
      // ========================================================

      const maxSize = 10 * 1024 * 1024;

      if (file.size > maxSize) {
        this.showSaveStatus('Image exceeds 10 MB');

        return;
      }

      // ========================================================
      // REQUIRE HA CONNECTION
      // ========================================================

      if (!this._hass?.connection) {
        this.showSaveStatus('Home Assistant connection unavailable');

        return;
      }

      // ========================================================
      // READ FILE AS BASE64
      // ========================================================

      let dataUrl;

      try {
        dataUrl = await this.readFileAsDataUrl(file);
      } catch (error) {
        console.error('Could not read background image.', error);

        this.showSaveStatus('Could not read image');

        return;
      }

      const commaIndex = dataUrl.indexOf(',');

      if (commaIndex < 0) {
        this.showSaveStatus('Invalid image data');

        return;
      }

      const base64Data = dataUrl.slice(commaIndex + 1);

      // ========================================================
      // UPLOAD TO HOME ASSISTANT
      // ========================================================

      try {
        this.showSaveStatus('Uploading background...');

        const result = await this._hass.connection.sendMessagePromise({
          type: 'mss/views/upload_background',

          filename: file.name,

          data: base64Data,
        });

        if (!result?.url) {
          throw new Error('Upload returned no URL.');
        }

        // ======================================================
        // STORE PERMANENT BACKGROUND URL
        // ======================================================

        this.workingView.backgroundMediaContentId = '';
        this.workingView.backgroundMediaContentType = '';
        this.workingView.backgroundMediaTitle = '';

        this.workingView.imageUrl = result.url;

        // Keep the URL input synchronized.
        if (urlInput) {
          urlInput.value = result.url;
        }

        // ======================================================
        // UPDATE PREVIEW
        // ======================================================

        const image = this.shadowRoot?.querySelector('.mss-editor-stage-image');

        if (image) {
          image.src = result.url;
        }

        this.showSaveStatus('Background uploaded');
      } catch (error) {
        console.error('Could not upload MSS background image.', error);

        this.showSaveStatus('Background upload failed');
      } finally {
        // Allows selecting the same file again later.
        fileInput.value = '';
      }
    };
  }

  bindAutoRoutingEvents() {
    const conditionLogic = this.shadowRoot?.querySelector(
      '#editorAutoRoutingConditionLogic'
    );

    const routing = this.ensureAutoRoutingConfig();

    const enabled = this.shadowRoot?.querySelector('#editorAutoRoutingEnabled');

    const group = this.shadowRoot?.querySelector('#editorAutoRoutingGroup');

    const manualControlPlan = this.shadowRoot?.querySelector(
      '#editorAutoRoutingManualControlPlan'
    );

    const addCondition = this.shadowRoot?.querySelector(
      '#addAutoRoutingCondition'
    );

    if (enabled) {
      enabled.onchange = () => {
        routing.enabled = enabled.checked;

        this.renderPanels();
      };
    }

    if (group) {
      group.onchange = () => {
        if (group.value === '__custom__') {
          routing.sourceMode = 'custom';
          routing.manualControlPlan = '';
          routing.mssGroup = '';
        } else {
          routing.sourceMode = 'detected';
          routing.manualControlPlan = '';
          routing.mssGroup = group.value;
        }

        // Conditions belong to the selected source.
        routing.conditions = [];

        this.renderPanels();
      };
    }

    if (manualControlPlan) {
      manualControlPlan.oninput = () => {
        const controlPlan = manualControlPlan.value.trim();

        routing.sourceMode = 'custom';
        routing.manualControlPlan = controlPlan;

        routing.mssGroup = controlPlan ? `MSSReport_${controlPlan}` : '';
      };
    }

    if (conditionLogic) {
      conditionLogic.onchange = () => {
        routing.conditionLogic = conditionLogic.value === 'or' ? 'or' : 'and';
      };
    }

    if (addCondition) {
      addCondition.onclick = () => {
        this.addAutoRoutingCondition();
      };
    }

    // ==========================================================
    // EXACT FIELD SELECTOR
    // ==========================================================

    this.shadowRoot
      ?.querySelectorAll('[data-routing-field-option]')
      .forEach((button) => {
        button.onclick = () => {
          const index = Number(button.dataset.routingFieldOption);

          const condition = routing.conditions[index];

          if (!condition) {
            return;
          }

          // ======================================================
          // UPDATE SELECTED FIELD
          // ======================================================

          condition.field = button.dataset.routingFieldPath ?? '';

          // ======================================================
          // UPDATE SELECTION HIGHLIGHT
          // WITHOUT RE-RENDERING THE PANEL
          // ======================================================

          const list = this.shadowRoot?.querySelector(
            `[data-routing-field-list="${index}"]`
          );

          list
            ?.querySelectorAll('[data-routing-field-option]')
            .forEach((option) => {
              option.classList.toggle(
                'selected',
                option.dataset.routingFieldPath === condition.field
              );
            });

          // ======================================================
          // FIND FRIENDLY FIELD LABEL
          // ======================================================

          const fieldSource =
            routing.mssGroup || condition.exampleMssGroup || '';

          const selectedField = this.getMssFieldOptionsForGroup(
            fieldSource
          ).find((field) => field.path === condition.field);

          // ======================================================
          // UPDATE DYNAMIC MODE
          // ======================================================

          if (condition.matchMode === 'wildcard') {
            // Generate the new wildcard from the newly selected field.
            condition.pattern = this.createAutoRoutingWildcard(
              condition.field,
              routing.mssGroup || condition.exampleMssGroup || ''
            );
            // Update friendly Dynamic field label.
            const dynamicName = this.shadowRoot?.querySelector(
              `[data-routing-dynamic-name="${index}"]`
            );

            if (dynamicName) {
              dynamicName.textContent =
                selectedField?.label ??
                condition.field ??
                'Select a data field first';
            }

            // Update Advanced pattern textarea.
            const patternInput = this.shadowRoot?.querySelector(
              `[data-routing-pattern="${index}"]`
            );

            if (patternInput) {
              patternInput.value = condition.pattern;
            }
          }
        };
      });

    this.shadowRoot
      ?.querySelectorAll('[data-routing-field-search]')
      .forEach((input) => {
        input.oninput = () => {
          const index = Number(input.dataset.routingFieldSearch);

          const list = this.shadowRoot?.querySelector(
            `[data-routing-field-list="${index}"]`
          );

          this.filterMssFieldList({
            list,

            query: input.value,

            optionSelector: '[data-routing-field-option]',

            groupSelector: '[data-routing-field-group]',

            labelAttribute: 'data-routing-field-label',
          });
        };
      });

    // ==========================================================
    // MATCH MODE
    // ==========================================================

    this.shadowRoot
      ?.querySelectorAll('[data-routing-match-mode]')
      .forEach((select) => {
        select.onchange = () => {
          const index = Number(select.dataset.routingMatchMode);

          const condition = routing.conditions[index];

          if (!condition) {
            return;
          }

          condition.matchMode =
            select.value === 'wildcard' ? 'wildcard' : 'exact';

          if (
            condition.matchMode === 'wildcard' &&
            condition.field &&
            !condition.pattern
          ) {
            condition.pattern = this.createAutoRoutingWildcard(
              condition.field,
              routing.mssGroup || condition.exampleMssGroup || ''
            );
          }

          this.renderPanels();
        };
      });

    // ==========================================================
    // WILDCARD PATTERN INPUT
    // ==========================================================

    this.shadowRoot
      ?.querySelectorAll('[data-routing-pattern]')
      .forEach((input) => {
        input.oninput = () => {
          const index = Number(input.dataset.routingPattern);

          if (!routing.conditions[index]) {
            return;
          }

          routing.conditions[index].pattern = input.value;
        };
      });

    // ==========================================================
    // OPERATOR
    // ==========================================================

    this.shadowRoot
      ?.querySelectorAll('[data-routing-operator]')
      .forEach((select) => {
        select.onchange = () => {
          const index = Number(select.dataset.routingOperator);

          if (!routing.conditions[index]) {
            return;
          }

          routing.conditions[index].operator = select.value;
        };
      });

    // ==========================================================
    // COMPARE VALUE
    // ==========================================================

    this.shadowRoot
      ?.querySelectorAll('[data-routing-value]')
      .forEach((input) => {
        input.oninput = () => {
          const index = Number(input.dataset.routingValue);

          if (!routing.conditions[index]) {
            return;
          }

          routing.conditions[index].value = input.value;
        };
      });

    // ==========================================================
    // REMOVE CONDITION
    // ==========================================================

    this.shadowRoot
      ?.querySelectorAll('[data-remove-routing-condition]')
      .forEach((button) => {
        button.onclick = () => {
          const index = Number(button.dataset.removeRoutingCondition);

          this.removeAutoRoutingCondition(index);
        };
      });

    this.shadowRoot
      ?.querySelectorAll('[data-routing-example-group]')
      .forEach((select) => {
        select.onchange = () => {
          const index = Number(select.dataset.routingExampleGroup);

          const condition = routing.conditions[index];

          if (!condition) {
            return;
          }

          condition.exampleMssGroup = select.value;

          // The previously selected field belongs
          // to a different example source.
          condition.field = '';
          condition.pattern = '';

          this.renderPanels();
        };
      });
  }

  readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          reject(new Error('Invalid FileReader result.'));
        }
      };

      reader.onerror = () => {
        reject(reader.error ?? new Error('Could not read file.'));
      };

      reader.readAsDataURL(file);
    });
  }

  // Updates the editable View name.
  bindViewNameEvent() {
    const input = this.shadowRoot?.querySelector('#editorViewName');

    if (!input) {
      return;
    }

    input.oninput = () => {
      this.workingView.name = input.value;

      const heading = this.shadowRoot?.querySelector('.mss-editor-heading h2');

      if (heading) {
        heading.textContent = input.value || 'MSS View';
      }
    };
  }

  // Updates the selected overlay name in the model, object list and canvas.
  bindOverlayNameEvent() {
    const overlayName = this.shadowRoot?.querySelector('#editorOverlayName');

    if (!overlayName || !this.selectedOverlay) {
      return;
    }

    overlayName.oninput = () => {
      this.selectedOverlay.name = overlayName.value;

      const selectedCallout = this.shadowRoot?.querySelector(
        `.editor-callout[data-overlay="${this.selectedOverlay.id}"] .callout-title`
      );

      if (selectedCallout) {
        selectedCallout.textContent = overlayName.value || 'Overlay';
      }

      const selectedListName = this.shadowRoot?.querySelector(
        `[data-editor-overlay="${this.selectedOverlay.id}"] .mss-editor-object-name`
      );

      if (selectedListName) {
        selectedListName.textContent = overlayName.value || 'Overlay';
      }
    };
  }

  // Updates overlay position from the X and Y inputs.
  bindOverlayPositionEvents() {
    const overlay = this.selectedOverlay;

    if (!overlay) {
      return;
    }

    const xInput = this.shadowRoot?.querySelector('#editorOverlayX');

    const yInput = this.shadowRoot?.querySelector('#editorOverlayY');

    const updatePosition = () => {
      const x = Math.max(0, Math.min(100, Number(xInput?.value) || 0));

      const y = Math.max(0, Math.min(100, Number(yInput?.value) || 0));

      overlay.position = {
        x,
        y,
      };

      const callout = this.shadowRoot?.querySelector(
        `.editor-callout[data-overlay="${overlay.id}"]`
      );

      if (callout) {
        callout.style.left = `${x}%`;
        callout.style.top = `${y}%`;
      }
    };

    if (xInput) {
      xInput.oninput = updatePosition;
    }

    if (yInput) {
      yInput.oninput = updatePosition;
    }
  }

  bindShapeSelectionEvents() {
    // ==========================================================
    // SIDEBAR SHAPE SELECTION + DRAG / DROP
    // ==========================================================

    this.shadowRoot?.querySelectorAll('[data-editor-shape]').forEach((item) => {
      // ------------------------------------------------------
      // SELECT
      // ------------------------------------------------------

      item.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();

        const shapeId = item.dataset.editorShape;

        this.selectShape(shapeId);
      };

      // ------------------------------------------------------
      // DRAG START
      // ------------------------------------------------------

      item.ondragstart = (event) => {
        this.draggedShapeId = item.dataset.editorShape;

        this.shapeDropCompleted = false;

        item.classList.add('dragging');

        event.dataTransfer.effectAllowed = 'move';

        event.dataTransfer.setData('text/plain', this.draggedShapeId);
      };

      // ------------------------------------------------------
      // DRAG OVER
      // ------------------------------------------------------

      item.ondragover = (event) => {
        event.preventDefault();

        event.dataTransfer.dropEffect = 'move';

        item.classList.add('drag-over');
      };

      // ------------------------------------------------------
      // DRAG LEAVE
      // ------------------------------------------------------

      item.ondragleave = () => {
        item.classList.remove('drag-over');
      };

      // ------------------------------------------------------
      // DROP
      // ------------------------------------------------------

      item.ondrop = (event) => {
        event.preventDefault();
        event.stopPropagation();

        const draggedId = this.draggedShapeId;

        const targetId = item.dataset.editorShape;

        if (!draggedId || !targetId) {
          return;
        }

        const rect = item.getBoundingClientRect();

        const placeAfter = event.clientY > rect.top + rect.height / 2;

        this.shapeDropCompleted = this.reorderShape(
          draggedId,
          targetId,
          placeAfter
        );
      };

      // ------------------------------------------------------
      // DRAG END
      // ------------------------------------------------------

      item.ondragend = () => {
        this.draggedShapeId = null;

        this.shadowRoot
          ?.querySelectorAll('[data-editor-shape]')
          .forEach((shapeItem) => {
            shapeItem.classList.remove('dragging', 'drag-over');
          });

        if (this.shapeDropCompleted) {
          this.shapeDropCompleted = false;

          this.render();

          this.viewDirty = true;
        }
      };
    });

    // ==========================================================
    // CANVAS SHAPE SELECTION
    // ==========================================================

    this.shadowRoot
      ?.querySelectorAll('.editor-shape[data-shape]')
      .forEach((shapeElement) => {
        shapeElement.onclick = (event) => {
          event.preventDefault();
          event.stopPropagation();

          /*
           * Ignore clicks generated from resize
           * or endpoint handles.
           */
          if (
            event.target.closest?.(
              '.mss-shape-resize-handle, .mss-line-endpoint-handle'
            )
          ) {
            return;
          }

          const shapeId = shapeElement.dataset.shape;

          this.selectShape(shapeId);
        };
      });
  }

  // Updates pointer visibility for the currently selected overlay.
  bindPointerVisibilityEvent() {
    const pointerVisible = this.shadowRoot?.querySelector(
      '#editorPointerVisible'
    );

    if (!pointerVisible || !this.selectedOverlay) {
      return;
    }

    pointerVisible.onchange = () => {
      this.selectedOverlay.pointerVisible = pointerVisible.checked;

      this.render();
    };
  }

  // Changes the selected element between Text and Status.
  bindElementTypeEvent() {
    const input = this.shadowRoot?.querySelector('#editorElementType');

    if (!input || !this.selectedOverlayElement) {
      return;
    }

    input.onchange = () => {
      this.selectedOverlayElement.elementType = Number(input.value);

      if (this.selectedOverlayElement.elementType === 1) {
        this.selectedOverlayElement.operator ??= 'equals';

        this.selectedOverlayElement.compareValue ??= '';

        this.selectedOverlayElement.trueText ??= 'OK';

        this.selectedOverlayElement.falseText ??= 'NOK';
      }

      this.refreshSelectedOverlayPreview();
      this.renderPanels();
    };
  }

  // Updates the selected overlay element name and visible labels.
  bindElementNameEvent() {
    const elementName = this.shadowRoot?.querySelector('#editorElementName');

    if (!elementName || !this.selectedOverlayElement) {
      return;
    }

    elementName.oninput = () => {
      this.selectedOverlayElement.name = elementName.value;

      const elementListLabel = this.shadowRoot?.querySelector(
        `[data-editor-element="${this.selectedOverlayElement.id}"] strong`
      );

      if (elementListLabel) {
        elementListLabel.textContent =
          elementName.value || this.selectedOverlayElement.path || 'Element';
      }

      const elementPreview = this.shadowRoot?.querySelector(
        `[data-element-preview="${this.selectedOverlayElement.id}"]`
      );

      if (elementPreview) {
        const nameElement = elementPreview.querySelector(
          '.editor-callout-element-name'
        );

        if (nameElement) {
          nameElement.textContent = elementName.value || 'Element';
        }
      }
    };
  }

  bindElementPathEvent() {
    const container = this.shadowRoot?.querySelector(
      '#editorElementPathContainer'
    );

    const element = this.selectedOverlayElement;

    if (!container || !element || !this._hass) {
      return;
    }

    const wrapper = document.createElement('div');

    wrapper.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 5px;
    width: 100%;
    min-width: 0;
  `;

    const picker = document.createElement('ha-entity-picker');

    picker.hass = this._hass;

    picker.value = element.path ?? '';

    picker.allowCustomEntity = true;

    picker.includeDomains = [
      'sensor',
      'binary_sensor',
      'input_text',
      'input_number',
      'input_boolean',
    ];

    picker.style.width = '100%';

    const entityId = document.createElement('div');

    entityId.style.cssText = `
    color: var(--secondary-text-color);
    font-family: var(--code-font-family, monospace);
    font-size: 10px;
    line-height: 1.35;
    overflow-wrap: anywhere;
    padding: 0 3px;
  `;

    const updateEntityId = (value) => {
      entityId.textContent = value || 'No entity selected';
    };

    updateEntityId(element.path);

    picker.addEventListener('value-changed', (event) => {
      const value = event.detail?.value ?? '';

      element.path = value;

      updateEntityId(value);

      // Changing the source entity invalidates the
      // previously selected nested data field.
      element.dataPath = '';

      this.refreshSelectedOverlayPreview();

      // Rebuild the inspector so Data Field options
      // correspond to the newly selected entity.
      this.renderPanels();
    });

    wrapper.append(picker, entityId);

    container.replaceChildren(wrapper);
  }

  // Updates the selected overlay element font size and canvas preview.
  bindElementFontSizeEvent() {
    const fontSizeInput = this.shadowRoot?.querySelector(
      '#editorElementFontSize'
    );

    if (!fontSizeInput || !this.selectedOverlayElement) {
      return;
    }

    fontSizeInput.oninput = () => {
      if (fontSizeInput.value === '') {
        return;
      }

      const fontSize = Number(fontSizeInput.value);

      if (!Number.isFinite(fontSize)) {
        return;
      }

      this.selectedOverlayElement.fontSize = fontSize;

      const elementPreview = this.shadowRoot?.querySelector(
        `[data-element-preview="${this.selectedOverlayElement.id}"]`
      );

      if (elementPreview) {
        elementPreview.style.fontSize = `${fontSize}px`;
      }
    };
  }

  // Updates the rule settings of the selected Status element.
  bindElementStatusEvents() {
    const element = this.selectedOverlayElement;

    if (!element || Number(element.elementType) !== 1) {
      return;
    }

    const operator = this.shadowRoot?.querySelector('#editorElementOperator');

    const compareValue = this.shadowRoot?.querySelector('#editorCompareValue');

    const trueText = this.shadowRoot?.querySelector('#editorTrueText');

    const falseText = this.shadowRoot?.querySelector('#editorFalseText');

    if (operator) {
      operator.onchange = () => {
        element.operator = operator.value;

        this.refreshSelectedOverlayPreview();
      };
    }

    if (compareValue) {
      compareValue.oninput = () => {
        element.compareValue = compareValue.value;

        this.refreshSelectedOverlayPreview();
      };
    }

    if (trueText) {
      trueText.oninput = () => {
        element.trueText = trueText.value;

        this.refreshSelectedOverlayPreview();
      };
    }

    if (falseText) {
      falseText.oninput = () => {
        element.falseText = falseText.value;

        this.refreshSelectedOverlayPreview();
      };
    }
  }

  // Handles Data Field searching and selection.
  bindElementDataPathEvent() {
    const search = this.shadowRoot?.querySelector(
      '#editorElementDataFieldSearch'
    );

    const options = Array.from(
      this.shadowRoot?.querySelectorAll('.mss-data-field-option') ?? []
    );

    const groups = Array.from(
      this.shadowRoot?.querySelectorAll('[data-data-group]') ?? []
    );

    const element = this.selectedOverlayElement;

    if (!element) {
      return;
    }

    // ==========================================================
    // NORMALIZE SEARCH TEXT
    // ==========================================================

    const normalizeSearchText = (value) =>
      String(value ?? '')
        .toLowerCase()

        // Treat technical separators as spaces.
        .replace(/[_./\\›\-]+/g, ' ')

        // Collapse whitespace.
        .replace(/\s+/g, ' ')

        .trim();

    // ==========================================================
    // FILTER
    // ==========================================================

    const updateFiltering = () => {
      const query = normalizeSearchText(search?.value);

      const tokens = query ? query.split(' ') : [];

      // --------------------------------------------------------
      // INDIVIDUAL FIELDS
      // --------------------------------------------------------

      options.forEach((option) => {
        const searchable = normalizeSearchText(
          option.dataset.dataLabel ?? option.textContent ?? ''
        );

        /*
         * Every word entered by the user must occur somewhere.
         *
         * "blob area"
         *
         * will therefore match:
         *
         * Blob Detection 2 › Blobs 0 › Area
         */
        const matches =
          tokens.length === 0 ||
          tokens.every((token) => searchable.includes(token));

        option.style.display = matches ? '' : 'none';
      });

      // --------------------------------------------------------
      // GROUPS
      // --------------------------------------------------------

      groups.forEach((group) => {
        const groupTitle = normalizeSearchText(
          group.querySelector('.mss-data-field-group-title')?.textContent
        );

        const groupOptions = Array.from(
          group.querySelectorAll('.mss-data-field-option')
        );

        /*
         * Searching:
         *
         * statistics
         *
         * should show the complete Statistics Evaluation group.
         */
        const groupMatches =
          tokens.length > 0 &&
          tokens.every((token) => groupTitle.includes(token));

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

    // ==========================================================
    // SEARCH EVENT
    // ==========================================================

    if (search) {
      search.oninput = updateFiltering;
    }

    // ==========================================================
    // FIELD SELECTION
    // ==========================================================

    const smartOptions = this.getMssSmartDataFieldOptions();

    const smartOptionsByKey = new Map(
      smartOptions.map((item) => [item.smartKey, item])
    );

    options.forEach((option) => {
      option.onclick = () => {
        const bindingType = option.dataset.bindingType ?? '';

        const smartKey = option.dataset.smartKey ?? '';

        // ========================================================
        // COMPOSITE
        // ========================================================

        if (bindingType === 'composite') {
          const smartOption = smartOptionsByKey.get(smartKey);

          if (!smartOption) {
            return;
          }

          element.bindingType = 'composite';

          element.mssGroup = smartOption.mssGroup;

          element.composite = {
            type: smartOption.compositeType,
            basePath: smartOption.basePath,
            components: structuredClone(smartOption.components),
            format: smartOption.format,
            decimals: null,
          };

          /*
           * A composite has multiple exact source fields,
           * therefore there is no single dataEntity/dataPath.
           */
          delete element.dataEntity;
          delete element.dataPath;

          delete element.measurement;
        }

        // ========================================================
        // MEASUREMENT
        // ========================================================
        else if (bindingType === 'measurement') {
          const smartOption = smartOptionsByKey.get(smartKey);

          if (!smartOption) {
            return;
          }

          element.bindingType = 'measurement';

          element.mssGroup = smartOption.mssGroup;

          element.dataEntity = smartOption.dataEntity;

          element.dataPath = smartOption.dataPath;

          element.measurement = {
            unit: smartOption.unit,
            decimals: null,
          };

          delete element.composite;
        }

        // ========================================================
        // NORMAL MSS FIELD
        // ========================================================
        else {
          /*
           * Preserve the original editor behaviour.
           */

          element.dataPath = option.dataset.dataPath ?? '';

          element.dataEntity = option.dataset.dataEntity ?? '';

          /*
           * Normal fields don't need an explicit binding type.
           * This keeps old Views backwards-compatible.
           */
          delete element.bindingType;
          delete element.composite;
          delete element.measurement;
        }

        this.refreshSelectedOverlayPreview();

        options.forEach((item) => {
          item.classList.toggle('selected', item === option);
        });
      };
    });

    updateFiltering();
  }

  // Binds controls recreated when the side panels refresh.
  bindPanelEvents() {
    this.shadowRoot
      ?.querySelectorAll('[data-editor-overlay]')
      .forEach((button) => {
        button.onclick = () => {
          this.selectOverlay(button.dataset.editorOverlay, false);

          this.updateCanvasSelection(this.selectedOverlay?.id);

          this.renderPanels();
        };

        button.ondragstart = (event) => {
          this.draggedOverlayId = button.dataset.editorOverlay;

          this.overlayDropCompleted = false;

          button.classList.add('dragging');

          event.dataTransfer.effectAllowed = 'move';

          event.dataTransfer.setData('text/plain', this.draggedOverlayId);
        };

        button.ondragover = (event) => {
          event.preventDefault();

          event.dataTransfer.dropEffect = 'move';

          button.classList.add('drag-over');
        };

        button.ondragleave = () => {
          button.classList.remove('drag-over');
        };

        button.ondrop = (event) => {
          event.preventDefault();

          const targetId = button.dataset.editorOverlay;

          const draggedId =
            this.draggedOverlayId || event.dataTransfer.getData('text/plain');

          const rect = button.getBoundingClientRect();

          const placeAfter = event.clientY > rect.top + rect.height / 2;

          this.overlayDropCompleted = this.reorderOverlay(
            draggedId,
            targetId,
            placeAfter
          );
        };

        button.ondragend = () => {
          this.draggedOverlayId = null;

          this.shadowRoot
            ?.querySelectorAll('[data-editor-overlay]')
            .forEach((overlay) => {
              overlay.classList.remove('dragging', 'drag-over');
            });

          if (this.overlayDropCompleted) {
            this.overlayDropCompleted = false;

            this.render();
          }
        };
      });

    this.shadowRoot
      ?.querySelectorAll('[data-editor-element]')
      .forEach((button) => {
        button.onclick = () => {
          const elementId = button.dataset.editorElement;

          this.selectedOverlayElement =
            this.selectedOverlay?.elements?.find(
              (element) => String(element.id) === String(elementId)
            ) ?? null;

          this.renderPanels();
        };

        button.ondragstart = (event) => {
          this.elementDropCompleted = false;
          this.draggedElementId = button.dataset.editorElement;

          button.classList.add('dragging');

          event.dataTransfer.effectAllowed = 'move';

          event.dataTransfer.setData('text/plain', this.draggedElementId);
        };

        button.ondragover = (event) => {
          event.preventDefault();

          event.dataTransfer.dropEffect = 'move';

          button.classList.add('drag-over');
        };

        button.ondragleave = () => {
          button.classList.remove('drag-over');
        };

        button.ondrop = (event) => {
          event.preventDefault();

          const targetId = button.dataset.editorElement;

          const draggedId =
            this.draggedElementId || event.dataTransfer.getData('text/plain');

          button.classList.remove('drag-over');

          const rect = button.getBoundingClientRect();

          const placeAfter = event.clientY > rect.top + rect.height / 2;

          this.elementDropCompleted = this.reorderElement(
            draggedId,
            targetId,
            placeAfter
          );
        };

        button.ondragend = () => {
          this.draggedElementId = null;

          this.shadowRoot
            ?.querySelectorAll('[data-editor-element]')
            .forEach((element) => {
              element.classList.remove('dragging', 'drag-over');
            });

          if (this.elementDropCompleted) {
            this.elementDropCompleted = false;

            this.refreshSelectedOverlayPreview();
            this.renderPanels();
          }
        };
      });

    // Rebinds property inputs after the right panel is rebuilt.
    this.bindViewNameEvent();
    this.bindBackgroundImageEvent();
    this.bindBackgroundBrowseEvent();
    this.bindViewerScaleEvent();
    this.bindAutoRoutingEvents();

    this.bindOverlayNameEvent();
    this.bindOverlayPositionEvents();
    this.bindOverlaySizeEvents();
    this.bindOverlayTitleSizeEvent();

    this.bindRectangleShapeEvent();
    this.bindRectangleShapePropertiesEvents();

    this.bindCircleShapeEvent();
    this.bindCircleShapePropertiesEvents();

    this.bindShapeSelectionEvents();

    this.bindImageShapeEvent();
    this.bindImageShapePropertiesEvents();

    this.bindLineShapeEvent();
    this.bindLineShapePropertiesEvents();

    this.bindArrowShapeEvent();
    this.bindArrowShapePropertiesEvents();

    this.bindTextShapeEvent();
    this.bindTextShapePropertiesEvents();

    this.bindLineEndpointEvents();
    this.bindLineBodyDragEvents();

    this.bindPointerVisibilityEvent();
    this.bindPointerSizeEvent();

    this.bindReferenceLineVisibilityEvent();
    this.bindReferenceLineThicknessEvent();

    this.bindElementTypeEvent();

    this.bindElementNameEvent();

    this.bindElementMssGroupEvent();

    this.bindElementDataPathEvent();

    this.bindElementFontSizeEvent();

    this.bindElementStatusEvents();

    const deleteOverlayButton =
      this.shadowRoot?.querySelector('#deleteMssOverlay');

    const duplicateOverlayButton = this.shadowRoot?.querySelector(
      '#duplicateMssOverlay'
    );

    const addElementButton = this.shadowRoot?.querySelector('#addMssElement');

    const duplicateElementButton = this.shadowRoot?.querySelector(
      '#duplicateMssElement'
    );

    const deleteElementButton =
      this.shadowRoot?.querySelector('#deleteMssElement');

    const duplicateShapeButton = this.shadowRoot?.querySelector(
      '#duplicateSelectedShape'
    );

    const deleteShapeButton = this.shadowRoot?.querySelector(
      '#deleteSelectedShape'
    );

    if (deleteOverlayButton) {
      deleteOverlayButton.onclick = () => {
        this.deleteSelectedOverlay();
      };
    }

    if (duplicateOverlayButton) {
      duplicateOverlayButton.onclick = () => {
        this.duplicateSelectedOverlay();
      };
    }

    if (duplicateShapeButton) {
      duplicateShapeButton.onclick = () => {
        this.duplicateSelectedShape();
      };
    }

    if (deleteShapeButton) {
      deleteShapeButton.onclick = () => {
        this.deleteSelectedShape();
      };
    }

    if (addElementButton) {
      addElementButton.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();

        this.createElement();
      };
    }

    if (duplicateElementButton) {
      duplicateElementButton.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();

        this.duplicateSelectedElement();
      };
    }

    if (deleteElementButton) {
      deleteElementButton.onclick = () => {
        this.deleteSelectedElement();
      };
    }
  }

  // Attaches the fullscreen Editor controls, property inputs and canvas interactions.
  bindEvents() {
    const cancelButton = this.shadowRoot?.querySelector('#cancelMssEditor');

    const applyButton = this.shadowRoot?.querySelector('#applyMssEditor');

    const addOverlayButton = this.shadowRoot?.querySelector('#addMssOverlay');

    const duplicateOverlayButton = this.shadowRoot?.querySelector(
      '#duplicateMssOverlay'
    );

    const deleteOverlayButton =
      this.shadowRoot?.querySelector('#deleteMssOverlay');

    const addElementButton = this.shadowRoot?.querySelector('#addMssElement');

    const deleteElementButton =
      this.shadowRoot?.querySelector('#deleteMssElement');

    if (cancelButton) {
      cancelButton.onclick = () => {
        this.cancel();
      };
    }

    if (applyButton) {
      applyButton.onclick = () => {
        this.apply();
      };
    }

    if (addOverlayButton) {
      addOverlayButton.onclick = () => {
        this.createOverlay();
      };
    }

    if (duplicateOverlayButton) {
      duplicateOverlayButton.onclick = () => this.duplicateSelectedOverlay();
    }

    if (deleteOverlayButton) {
      deleteOverlayButton.onclick = () => this.deleteSelectedOverlay();
    }

    if (addElementButton) {
      addElementButton.onclick = () => {
        this.createElement();
      };
    }

    if (deleteElementButton) {
      deleteElementButton.onclick = () => {
        this.deleteSelectedElement();
      };
    }

    this.shadowRoot
      ?.querySelectorAll('[data-editor-overlay]')
      .forEach((button) => {
        button.onclick = () => {
          this.selectOverlay(button.dataset.editorOverlay, false);

          this.updateCanvasSelection(this.selectedOverlay?.id);

          this.renderPanels();
        };

        button.ondragstart = (event) => {
          this.draggedOverlayId = button.dataset.editorOverlay;

          this.overlayDropCompleted = false;

          button.classList.add('dragging');

          event.dataTransfer.effectAllowed = 'move';

          event.dataTransfer.setData('text/plain', this.draggedOverlayId);
        };

        button.ondragover = (event) => {
          event.preventDefault();

          event.dataTransfer.dropEffect = 'move';

          button.classList.add('drag-over');
        };

        button.ondragleave = () => {
          button.classList.remove('drag-over');
        };

        button.ondrop = (event) => {
          event.preventDefault();

          const targetId = button.dataset.editorOverlay;

          const draggedId =
            this.draggedOverlayId || event.dataTransfer.getData('text/plain');

          const rect = button.getBoundingClientRect();

          const placeAfter = event.clientY > rect.top + rect.height / 2;

          this.overlayDropCompleted = this.reorderOverlay(
            draggedId,
            targetId,
            placeAfter
          );
        };

        button.ondragend = () => {
          this.draggedOverlayId = null;

          this.shadowRoot
            ?.querySelectorAll('[data-editor-overlay]')
            .forEach((overlay) => {
              overlay.classList.remove('dragging', 'drag-over');
            });

          if (this.overlayDropCompleted) {
            this.overlayDropCompleted = false;

            this.render();
          }
        };
      });

    this.shadowRoot
      ?.querySelectorAll('[data-editor-element]')
      .forEach((button) => {
        button.onclick = () => {
          const elementId = button.dataset.editorElement;

          this.selectedOverlayElement =
            this.selectedOverlay?.elements?.find(
              (element) => String(element.id) === String(elementId)
            ) ?? null;

          this.renderPanels();
        };
      });

    this.bindBackgroundImageEvent();
    this.bindPointerVisibilityEvent();
    this.bindElementFontSizeEvent();
    this.bindBackgroundBrowseEvent();
    this.bindViewerScaleEvent();
    this.bindPanelEvents();
    this.bindCalloutEvents();
    this.bindPointerEvents();
    this.bindOverlayResizeEvents();
    this.bindRectangleShapeEvent();

    this.bindShapeCanvasEvents();
    this.bindShapeResizeEvents();
    this.bindEditorCanvasControls();
    this.bindCanvasDeselectionEvent();

    const updateAllReferenceLines = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          (this.workingView?.overlays ?? []).forEach((overlay) => {
            this.updateReferenceLine(overlay);
          });
        });
      });
    };

    const stageImage = this.shadowRoot?.querySelector(
      '.mss-editor-stage-image'
    );

    if (stageImage?.complete) {
      updateAllReferenceLines();
    } else if (stageImage) {
      stageImage.addEventListener('load', updateAllReferenceLines, {
        once: true,
      });
    } else {
      updateAllReferenceLines();
    }

    this.onkeydown = (event) => {
      if (event.key === 'Escape') {
        this.cancel();
      }
    };

    const canvas = this.shadowRoot?.querySelector('.mss-editor-canvas-shell');

    const stage = this.shadowRoot?.querySelector('.mss-editor-stage');

    const clearSelection = (event) => {
      const clickedOverlay = event.target.closest?.(
        '.editor-callout, .editor-point'
      );

      if (clickedOverlay) {
        return;
      }

      this.selectedOverlay = null;
      this.selectedOverlayElement = null;

      this.updateCanvasSelection(null);
      this.renderPanels();
    };

    canvas?.addEventListener('pointerdown', clearSelection);

    stage?.addEventListener('pointerdown', clearSelection);

    const image = this.shadowRoot?.querySelector('.mss-editor-stage-image');

    if (image && stage) {
      const showStage = () => {
        stage.style.opacity = '1';
      };

      if (image.complete) {
        showStage();
      } else {
        image.onload = showStage;
      }
    }

    this.tabIndex = -1;
    this.focus();
  }

  // Updates the default Viewer image scale and previews it in the Editor.
  bindViewerScaleEvent() {
    const slider = this.shadowRoot?.querySelector('#editorViewerScale');

    const label = this.shadowRoot?.querySelector('#editorViewerScaleLabel');

    const stage = this.shadowRoot?.querySelector('.mss-editor-stage');

    if (!slider) {
      return;
    }

    const applyScale = () => {
      const scale = Number(slider.value);

      this.workingView.viewerScale = scale;

      if (label) {
        label.textContent = `${Math.round(scale * 100)}%`;
      }

      if (stage) {
        stage.style.transform = `scale(${scale})`;
      }

      requestAnimationFrame(() => {
        for (const overlay of this.workingView?.overlays ?? []) {
          this.updateReferenceLine(overlay);
        }
      });
    };

    slider.oninput = applyScale;

    applyScale();
  }

  // Changes the MSS source used by the selected element.
  bindElementMssGroupEvent() {
    const select = this.shadowRoot?.querySelector('#editorElementMssGroup');

    const element = this.selectedOverlayElement;

    if (!select || !element) {
      return;
    }

    // ==========================================================
    // LEGACY INITIALIZATION
    // ==========================================================

    if (!element.mssGroup && element.path) {
      const legacyGroup = this.getMssStateGroup(
        this._hass?.states?.[element.path]
      );

      if (legacyGroup) {
        element.mssGroup = legacyGroup;

        select.value = legacyGroup;
      }
    }

    select.onchange = () => {
      element.mssGroup = select.value;

      /*
       * Changing MSS source invalidates the previously selected
       * field because that field may belong to another plan.
       */
      element.dataEntity = '';

      element.dataPath = '';

      delete element.bindingType;
      delete element.composite;
      delete element.measurement;

      this.refreshSelectedOverlayPreview();

      /*
       * Re-render the properties so Data Field immediately shows
       * the entities belonging to the newly selected MSS group.
       */
      this.renderPanels();
    };
  }

  // Refreshes the selected overlay contents without rebuilding
  // the callout itself or removing its resize handles.
  refreshSelectedOverlayPreview() {
    if (!this.selectedOverlay) {
      return;
    }

    const callout = this.shadowRoot?.querySelector(
      `.editor-callout[data-overlay="${this.selectedOverlay.id}"]`
    );

    if (!callout) {
      return;
    }

    // ==========================================================
    // TITLE
    // ==========================================================

    const title = callout.querySelector('.callout-title');

    if (title) {
      title.textContent = this.selectedOverlay.name ?? 'Overlay';
    }

    // ==========================================================
    // ELEMENT VALUES
    // ==========================================================

    const elementsContainer = callout.querySelector('.editor-callout-elements');

    if (elementsContainer) {
      elementsContainer.innerHTML = (this.selectedOverlay.elements ?? [])
        .map((element) => {
          // -----------------------------------------------
          // GET CURRENT MSS / HA VALUE
          // -----------------------------------------------

          const currentValue = this.resolveOverlayElementValue(element);

          // -----------------------------------------------
          // STATUS ELEMENT
          // -----------------------------------------------

          let displayValue = currentValue;

          if (Number(element.elementType) === 1) {
            const condition = this.evaluateOverlayCondition(element);

            displayValue = condition
              ? (element.trueText ?? 'OK')
              : (element.falseText ?? 'NOK');
          }

          // -----------------------------------------------
          // TEXT ELEMENT
          // -----------------------------------------------

          const label = element.name ?? 'Element';

          return `
            <div
              class="editor-callout-element"

              data-element-preview="${element.id}"

              style="
                font-size:
                  ${element.fontSize ?? 14}px;
              ">

              <span
                class="editor-callout-element-name">
                ${label}
              </span>

              <span
                class="editor-callout-element-value">
                ${displayValue}
              </span>

            </div>
          `;
        })
        .join('');
    }

    this.updateReferenceLine(this.selectedOverlay);
  }

  // Refreshes only the sidebars without rebuilding the image canvas.
  renderPanels() {
    const leftSidebar = this.shadowRoot?.querySelector(
      '.mss-editor-sidebar.left'
    );

    const rightSidebar = this.shadowRoot?.querySelector(
      '.mss-editor-sidebar.right'
    );

    if (!leftSidebar || !rightSidebar) {
      this.render();
      return;
    }

    const leftScroll = leftSidebar.scrollTop;

    const rightScroll = rightSidebar.scrollTop;

    const sectionStates = {};

    rightSidebar
      .querySelectorAll('details[data-editor-section]')
      .forEach((section) => {
        sectionStates[section.dataset.editorSection] = section.open;
      });

    const overlayList = leftSidebar.querySelector('#mssOverlayList');

    const shapeList = leftSidebar.querySelector('#mssShapeList');

    if (overlayList) {
      overlayList.innerHTML = this.renderOverlayList();
    }

    if (shapeList) {
      shapeList.innerHTML = this.renderShapeList();
    }

    rightSidebar.innerHTML = this.renderProperties();

    rightSidebar
      .querySelectorAll('details[data-editor-section]')
      .forEach((section) => {
        const savedState = sectionStates[section.dataset.editorSection];

        if (savedState !== undefined) {
          section.open = savedState;
        }
      });

    this.bindPanelEvents();

    const selectedElement = rightSidebar.querySelector(
      '.mss-editor-object.selected'
    );

    selectedElement?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    });

    leftSidebar.scrollTop = leftScroll;

    rightSidebar.scrollTop = rightScroll;

    requestAnimationFrame(() => {
      const selectedElement = rightSidebar.querySelector(
        '[data-editor-element].selected'
      );

      selectedElement?.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    });
  }

  // Creates a signature of all currently available dynamic
  // MSS entities.
  //
  // The editor automatically refreshes if MSS creates/removes
  // fields, without depending on sensor.mss_report.rootNode.
  getMssDataSchemaSignature() {
    if (!this._hass) {
      return '';
    }

    const schema = [];

    for (const [entityId, state] of Object.entries(this._hass.states)) {
      const attributes = state?.attributes ?? {};

      if (!attributes.mss_group || !attributes.mss_source_path) {
        continue;
      }

      schema.push(
        [attributes.mss_group, attributes.mss_source_path, entityId].join('|')
      );
    }

    return schema.sort().join('||');
  }

  // Updates the selected overlay dimensions.
  bindOverlaySizeEvents() {
    const overlay = this.selectedOverlay;

    if (!overlay) {
      return;
    }

    const widthInput = this.shadowRoot?.querySelector('#editorOverlayWidth');

    const heightInput = this.shadowRoot?.querySelector('#editorOverlayHeight');

    const updateSize = () => {
      overlay.size = {
        width: Number(widthInput?.value) || 220,

        height: Number(heightInput?.value) || 120,
      };

      const callout = this.shadowRoot?.querySelector(
        `.editor-callout[data-overlay="${overlay.id}"]`
      );

      if (callout) {
        callout.style.width = `${overlay.size.width}px`;

        callout.style.minHeight = `${overlay.size.height}px`;
      }

      this.updateReferenceLine(overlay);
    };

    if (widthInput) {
      widthInput.oninput = updateSize;
    }

    if (heightInput) {
      heightInput.oninput = updateSize;
    }
  }

  // Updates the selected Reference Point size.
  bindPointerSizeEvent() {
    const overlay = this.selectedOverlay;

    const input = this.shadowRoot?.querySelector('#editorPointerSize');

    if (!overlay || !input) {
      return;
    }

    input.oninput = () => {
      const size = Math.max(4, Math.min(40, Number(input.value) || 10));

      overlay.pointerSize = size;

      const point = this.shadowRoot?.querySelector(
        `[data-overlay-pointer="${overlay.id}"]`
      );

      if (point) {
        point.style.width = `${size}px`;

        point.style.height = `${size}px`;
      }

      this.updateReferenceLine(overlay);
    };
  }

  removeOverlayFromCanvas(overlayId) {
    const callout = this.shadowRoot?.querySelector(
      `.editor-callout[data-overlay="${overlayId}"]`
    );

    const point = this.shadowRoot?.querySelector(
      `[data-overlay-point="${overlayId}"]`
    );

    const line = this.shadowRoot?.querySelector(
      `[data-overlay-reference-line="${overlayId}"]`
    );

    callout?.remove();
    point?.remove();
    line?.remove();
  }

  // Updates Reference Line visibility.
  bindReferenceLineVisibilityEvent() {
    const overlay = this.selectedOverlay;

    const input = this.shadowRoot?.querySelector('#editorReferenceLineVisible');

    if (!overlay || !input) {
      return;
    }

    input.onchange = () => {
      overlay.referenceLineVisible = input.checked;

      const line = this.shadowRoot?.querySelector(
        `[data-overlay-reference-line="${overlay.id}"]`
      );

      if (line) {
        line.style.display = input.checked ? '' : 'none';
      }
    };
  }

  // Updates Reference Line thickness.
  bindReferenceLineThicknessEvent() {
    const overlay = this.selectedOverlay;

    const input = this.shadowRoot?.querySelector(
      '#editorReferenceLineThickness'
    );

    if (!overlay || !input) {
      return;
    }

    input.oninput = () => {
      const thickness = Math.max(1, Math.min(12, Number(input.value) || 5));

      overlay.referenceLineThickness = thickness;

      const line = this.shadowRoot?.querySelector(
        `[data-overlay-reference-line="${overlay.id}"]`
      );

      if (line) {
        line.style.height = `${thickness}px`;
      }
    };
  }

  bindPercentDrag({
    element,
    stage,
    getPosition,
    getBounds,
    setPosition,
    onStart,
    onMove,
    onEnd,
    dragMode = 'position',
  }) {
    if (!element || !stage) {
      return;
    }

    element.onpointerdown = (event) => {
      // Resize handles manage their own pointer events.
      if (
        event.target.closest?.(
          '.mss-overlay-resize-handle, .mss-shape-resize-handle'
        )
      ) {
        return;
      }

      // Only respond to the primary mouse button.
      if (event.button !== undefined && event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const stageRect = stage.getBoundingClientRect();

      if (stageRect.width <= 0 || stageRect.height <= 0) {
        return;
      }

      const startMouseX = event.clientX;

      const startMouseY = event.clientY;

      const startPosition = getPosition();

      let currentPosition = {
        ...startPosition,
      };

      const bounds = getBounds?.() ?? {
        minX: 0,
        minY: 0,
        maxX: 100,
        maxY: 100,
      };

      // Used only by transform-mode dragging.
      let animationFrameId = null;

      let pendingTranslateX = 0;
      let pendingTranslateY = 0;

      const applyVisualTransform = () => {
        animationFrameId = null;

        element.style.transform = `translate3d(
          ${pendingTranslateX}px,
          ${pendingTranslateY}px,
          0
        )`;
      };

      onStart?.();

      element.classList.add('dragging');

      try {
        element.setPointerCapture(event.pointerId);
      } catch {}

      // ========================================================
      // POINTER MOVE
      // ========================================================

      const handlePointerMove = (moveEvent) => {
        if (moveEvent.pointerId !== event.pointerId) {
          return;
        }

        moveEvent.preventDefault();
        moveEvent.stopPropagation();

        const deltaX =
          ((moveEvent.clientX - startMouseX) / stageRect.width) * 100;

        const deltaY =
          ((moveEvent.clientY - startMouseY) / stageRect.height) * 100;

        const nextX = Math.max(
          bounds.minX ?? 0,
          Math.min(bounds.maxX ?? 100, Number(startPosition.x ?? 0) + deltaX)
        );

        const nextY = Math.max(
          bounds.minY ?? 0,
          Math.min(bounds.maxY ?? 100, Number(startPosition.y ?? 0) + deltaY)
        );

        currentPosition = {
          x: nextX,
          y: nextY,
        };

        // ======================================================
        // POSITION MODE
        // ======================================================
        //
        // Used by overlays.
        //
        // Their actual left/top and logical position are updated
        // continuously because reference lines depend on the
        // real rendered DOM geometry.
        // ======================================================

        if (dragMode === 'position') {
          setPosition(currentPosition);

          element.style.left = `${nextX}%`;

          element.style.top = `${nextY}%`;

          onMove?.(currentPosition);

          return;
        }

        // ======================================================
        // TRANSFORM MODE
        // ======================================================
        //
        // Used by Shapes.
        //
        // Logical position is NOT committed during the drag.
        // The Shape is visually translated instead.
        //
        // This avoids continuously changing left/top while
        // dragging image content.
        // ======================================================

        pendingTranslateX =
          ((nextX - Number(startPosition.x ?? 0)) / 100) * stageRect.width;

        pendingTranslateY =
          ((nextY - Number(startPosition.y ?? 0)) / 100) * stageRect.height;

        if (animationFrameId === null) {
          animationFrameId = requestAnimationFrame(applyVisualTransform);
        }

        onMove?.(currentPosition);
      };

      // ========================================================
      // POINTER END
      // ========================================================

      const handlePointerEnd = (endEvent) => {
        if (endEvent.pointerId !== event.pointerId) {
          return;
        }

        element.removeEventListener('pointermove', handlePointerMove);

        element.removeEventListener('pointerup', handlePointerEnd);

        element.removeEventListener('pointercancel', handlePointerEnd);

        // Cancel pending visual frame.
        if (animationFrameId !== null) {
          cancelAnimationFrame(animationFrameId);

          animationFrameId = null;
        }

        try {
          if (element.hasPointerCapture(event.pointerId)) {
            element.releasePointerCapture(event.pointerId);
          }
        } catch {}

        // ======================================================
        // COMMIT FINAL POSITION
        // ======================================================

        setPosition(currentPosition);

        // Transform mode uses temporary visual movement.
        // Convert that into permanent left/top now.
        if (dragMode === 'transform') {
          element.style.transform = '';

          element.style.left = `${currentPosition.x}%`;

          element.style.top = `${currentPosition.y}%`;
        }

        element.classList.remove('dragging');

        onEnd?.(currentPosition);
      };

      element.addEventListener('pointermove', handlePointerMove);

      element.addEventListener('pointerup', handlePointerEnd);

      element.addEventListener('pointercancel', handlePointerEnd);
    };
  }

  render() {
    if (!this.shadowRoot || !this.workingView) {
      return;
    }

    const leftSidebar = this.shadowRoot.querySelector(
      '.mss-editor-sidebar.left'
    );

    const rightSidebar = this.shadowRoot.querySelector(
      '.mss-editor-sidebar.right'
    );

    const canvas = this.shadowRoot.querySelector('.mss-editor-canvas-shell');

    const scrollState = {
      leftTop: leftSidebar?.scrollTop ?? 0,
      rightTop: rightSidebar?.scrollTop ?? 0,
      canvasTop: canvas?.scrollTop ?? 0,
      canvasLeft: canvas?.scrollLeft ?? 0,
    };

    this.shadowRoot.innerHTML = `
  <div class="mss-editor-backdrop">

    <section
      class="mss-editor-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="MSS View Editor">

      <!-- ================================================= -->
      <!-- HEADER                                            -->
      <!-- ================================================= -->

      <header class="mss-editor-header">

        <button
          id="cancelMssEditor"
          class="mss-editor-back-button mss-tooltip-trigger"
          type="button"
          data-tooltip="Back"
          aria-label="Close Editor">
          ${mssIcon('flipBack', 20)}
        </button>

        <div class="mss-editor-heading">

          <div class="mss-editor-kicker">
            MSS VIEW EDITOR
          </div>

          <h2>
            ${this.workingView.name ?? 'MSS View'}
          </h2>

          <div
            id="mssEditorSaveStatus"
            class="mss-editor-save-status"
            aria-live="polite">
          </div>

        </div>

        <button
          id="applyMssEditor"
          class="mss-editor-button primary"
          type="button">
          Apply
        </button>

      </header>


      <!-- ================================================= -->
      <!-- MAIN LAYOUT                                       -->
      <!-- ================================================= -->

      <main class="mss-editor-layout">


        <!-- =============================================== -->
        <!-- LEFT SIDEBAR                                    -->
        <!-- =============================================== -->

        <aside class="mss-editor-sidebar left">


          <!-- ============================================= -->
          <!-- OVERLAYS                                      -->
          <!-- ============================================= -->

          <div class="mss-editor-panel-header">

            <h3>Overlays</h3>

            <div class="mss-editor-panel-actions">

              <!-- Overlay actions -->
                <button
                  id="addMssOverlay"
                  class="mss-editor-icon-button mss-tooltip-trigger"
                  type="button"
                  data-tooltip="New overlay"
                  aria-label="New overlay">
                  ${mssIcon('add', 18)}
                </button>

              <button
                id="duplicateMssOverlay"
                class="mss-editor-icon-button mss-tooltip-trigger"
                type="button"
                data-tooltip="Duplicate overlay"
                aria-label="Duplicate overlay"
                ${this.selectedOverlay ? '' : 'disabled'}>
                ${mssIcon('copy', 18)}
              </button>

             <button
              id="deleteMssOverlay"
              class="mss-editor-icon-button danger mss-tooltip-trigger"
              type="button"
              data-tooltip="Delete overlay"
              aria-label="Delete overlay"
              ${this.selectedOverlay ? '' : 'disabled'}>
              ${mssIcon('trash', 18)}
            </button>

            </div>

          </div>


          <div
            id="mssOverlayList"
            class="mss-editor-object-list">
            ${this.renderOverlayList()}
          </div>


          <!-- ============================================= -->
          <!-- SHAPES                                        -->
          <!-- ============================================= -->

          <section class="mss-editor-shapes-section">

            <div class="mss-editor-panel-header">

              <h3>Shapes</h3>

              <div class="mss-editor-panel-actions">

                <!-- Shape actions -->
                <button
                  id="duplicateSelectedShape"
                  class="mss-editor-icon-button mss-tooltip-trigger"
                  type="button"
                  data-tooltip="Duplicate shape"
                  aria-label="Duplicate shape"
                  ${this.selectedShape ? '' : 'disabled'}>
                  ${mssIcon('copy', 18)}
                </button>

                <button
                  id="deleteSelectedShape"
                  class="mss-editor-icon-button danger mss-tooltip-trigger"
                  type="button"
                  data-tooltip="Delete shape"
                  aria-label="Delete shape"
                  ${this.selectedShape ? '' : 'disabled'}>
                  ${mssIcon('trash', 18)}
                </button>

              </div>

            </div>


            <!-- =========================================== -->
            <!-- SHAPE TOOLS                                 -->
            <!-- =========================================== -->

            <div class="mss-editor-shape-tools">

              <span class="mss-editor-shape-tools-label">
                Shape tools
              </span>

              <div class="mss-editor-tool-grid">

                <button
                  id="addRectangleShape"
                  class="mss-editor-action-button"
                  type="button">
                  Rectangle
                </button>

                <button
                  id="addImageShape"
                  class="mss-editor-action-button"
                  type="button">
                  Image
                </button>

                <button
                  id="addCircleShape"
                  class="mss-editor-action-button"
                  type="button">
                  Circle
                </button>

                <button
                  id="addLineShape"
                  class="mss-editor-action-button"
                  type="button">
                  Line
                </button>

                <button
                  id="addArrowShape"
                  class="mss-editor-action-button"
                  type="button">
                  Arrow
                </button>

                <button
                  id="addTextShape"
                  class="mss-editor-action-button"
                  type="button">
                  Text
                </button>

              </div>

            </div>


            <!-- =========================================== -->
            <!-- SHAPE LIST                                  -->
            <!-- =========================================== -->

            <div
              id="mssShapeList"
              class="
                mss-editor-object-list
                mss-editor-shape-list
              ">
              ${this.renderShapeList()}
            </div>

          </section>

        </aside>


        <!-- =============================================== -->
        <!-- WORKSPACE                                       -->
        <!-- =============================================== -->

        <section class="mss-editor-workspace">

          <div class="mss-editor-workspace-toolbar">

            <span>Canvas</span>

            <div class="mss-editor-canvas-controls">

              <button
                id="toggleEditorGrid"
                class="${this.gridEnabled ? 'active' : ''}"
                type="button">
                Grid
              </button>

             <button
                id="editorZoomOut"
                class="mss-tooltip-trigger mss-tooltip-down"
                type="button"
                data-tooltip="Zoom out"
                aria-label="Zoom out">
                ${mssIcon('minus', 15)}
              </button>

              <button
                id="editorZoomReset"
                class="mss-editor-zoom-value mss-tooltip-trigger mss-tooltip-down"
                type="button"
                data-tooltip="Reset zoom">
                ${Math.round(this.editorZoom * 100)}%
              </button>

              <button
                id="editorZoomIn"
                class="mss-tooltip-trigger mss-tooltip-down"
                type="button"
                data-tooltip="Zoom in"
                aria-label="Zoom in">
                ${mssIcon('plus', 15)}
              </button>

            </div>

          </div>

          ${this.renderCanvas()}

        </section>


        <!-- =============================================== -->
        <!-- RIGHT SIDEBAR                                   -->
        <!-- =============================================== -->

        <aside class="mss-editor-sidebar right">
          ${this.renderProperties()}
        </aside>

      </main>

    </section>

  </div>

  ${panelStyles()}


  <style>

    /* ============================================================
       HOST / DIALOG SHELL
       ============================================================ */

    :host {
      position: fixed;
      inset: 0;
      z-index: 10000;

      display: block;
    }


    .mss-editor-backdrop {
      position: fixed;
      inset: 0;

      padding: 12px;
      box-sizing: border-box;

      background: rgba(0, 0, 0, 0.78);
      backdrop-filter: blur(4px);

      overscroll-behavior: contain;
    }


    .mss-editor-dialog {
      width: 100%;
      height: 100%;

      display: flex;
      flex-direction: column;

      overflow: hidden;

      color: #f7f9fb;
      background: #0f1724;

      border: 1px solid #2e3c52;
      border-radius: 16px;

      box-shadow:
        0 24px 80px
        rgba(0, 0, 0, 0.58);
    }


    /* ============================================================
       HEADER
       ============================================================ */

    .mss-editor-header {
      flex: 0 0 auto;

      display: grid;
      grid-template-columns: 1fr auto 1fr;

      align-items: center;
      gap: 20px;

      min-height: 70px;

      padding: 10px 18px;
      box-sizing: border-box;

      background: #182233;
      border-bottom: 1px solid #2e3c52;
    }


    .mss-editor-heading {
      text-align: center;
    }


    .mss-editor-heading h2 {
      margin: 3px 0 0;

      font-size: 20px;
    }


    .mss-editor-kicker {
      color: #00a586;

      font-size: 10px;
      font-weight: 800;

      letter-spacing: 0.14em;
    }


    .mss-editor-header
    #applyMssEditor {
      justify-self: end;
    }


    /* ============================================================
       HEADER BACK BUTTON
       ============================================================ */

    .mss-editor-back-button {
      width: 40px;
      height: 40px;

      display: inline-flex;
      align-items: center;
      justify-content: center;

      padding: 0;

      color: #00a586;
      background: transparent;

      border: 1px solid transparent;
      border-radius: 8px;

      cursor: pointer;

      transition:
        background 0.14s ease,
        border-color 0.14s ease,
        opacity 0.14s ease,
        transform 0.1s ease;
    }


    .mss-editor-back-button:hover {
      background: rgba(0, 165, 134, 0.12);
      border-color: #00a586;
    }


    /* ============================================================
       GENERAL BUTTONS
       ============================================================ */

    .mss-editor-button {
      width: fit-content;

      padding: 10px 18px;

      border-radius: 8px;

      cursor: pointer;
      font-weight: 800;
    }


    .mss-editor-button.secondary {
      color: #f7f9fb;
      background: #223047;

      border: 1px solid #2e3c52;
    }


    .mss-editor-button.primary {
      color: #ffffff;
      background: #00a586;

      border: 1px solid #00a586;
    }


    .mss-editor-button.primary:hover {
      background: #00b896;
    }


    .mss-editor-icon-button {
      width: 30px;
      height: 30px;

      display: inline-flex;
      align-items: center;
      justify-content: center;

      padding: 0;

      color: #f7f9fb;
      background: #223047;

      border: 1px solid #2e3c52;
      border-radius: 7px;

      cursor: pointer;

      transition:
        background 0.14s ease,
        border-color 0.14s ease,
        opacity 0.14s ease,
        transform 0.1s ease;
    }


    .mss-editor-icon-button:not(:disabled):hover {
      background: rgba(0, 165, 134, 0.12);
      border-color: rgba(0, 165, 134, 0.7);
    }


    .mss-editor-icon-button:not(:disabled):active,
    .mss-editor-back-button:active {
      transform: scale(0.94);
    }


    .mss-action-icon {
      display: block;
      flex: 0 0 auto;

      object-fit: contain;

      filter: brightness(0) invert(1);
    }


    .mss-editor-icon-button.danger .mss-action-icon {
      opacity: .9;
    }


    .mss-editor-icon-button.danger {
      color: #ff8d8d;
    }


    .mss-editor-icon-button:disabled {
      opacity: 0.4;

      cursor: not-allowed;
    }


    /* ============================================================
       MAIN EDITOR LAYOUT
       ============================================================ */

    .mss-editor-layout {
      flex: 1;
      min-height: 0;

      display: grid;

      grid-template-columns:
        260px
        minmax(0, 1fr)
        300px;

      overflow: hidden;
    }


    /* ============================================================
       SIDEBARS
       ============================================================ */

    .mss-editor-sidebar {
      min-height: 0;

      padding: 16px;
      box-sizing: border-box;

      overflow-y: auto;

      background: #182233;
    }


    .mss-editor-sidebar.left {
      border-right: 1px solid #2e3c52;
    }


    .mss-editor-sidebar.right {
      border-left: 1px solid #2e3c52;
    }


    /* ============================================================
       PANEL HEADERS / ACTIONS
       ============================================================ */

    .mss-editor-panel-header {
      display: flex;

      align-items: center;
      justify-content: space-between;

      gap: 12px;

      margin-bottom: 14px;
    }


    .mss-editor-panel-header h3,
    .mss-editor-property-group h3 {
      margin: 0;

      font-size: 15px;
    }


    .mss-editor-panel-actions {
      display: flex;

      gap: 6px;
    }


    /* ============================================================
       OBJECT LIST
       ============================================================ */

    .mss-editor-object-list {
      display: flex;
      flex-direction: column;

      gap: 7px;

      margin-bottom: 14px;
    }


    .mss-editor-object {
      width: 100%;

      display: flex;
      align-items: center;

      gap: 10px;

      padding: 10px;

      color: #aeb8c5;
      background: transparent;

      border: 1px solid transparent;
      border-radius: 8px;

      text-align: left;

      cursor: pointer;

      transition:
        background 0.14s ease,
        border-color 0.14s ease,
        color 0.14s ease,
        transform 0.12s ease;
    }


    .mss-editor-object:hover {
      background: rgba(0, 165, 134, 0.08);
      transform: translateX(2px);
    }


    .mss-editor-object.selected {
      color: #f7f9fb;

      background: rgba(0, 165, 134, 0.15);

      border-color: #00a586;
    }


    .mss-editor-object-icon {
      color: #00a586;
    }


    /* ============================================================
       SHAPES
       ============================================================ */

    .mss-editor-shapes-section {
      margin-top: 24px;
      padding-top: 18px;

      border-top: 1px solid #2e3c52;
    }


    /*
     * Shape tools belong to the Shapes section itself.
     * There is deliberately no additional divider here.
     */
    .mss-editor-shape-tools {
      margin-top: 2px;
    }


    .mss-editor-shape-tools-label {
      display: block;

      color: #7d8794;

      font-size: 11px;

      text-transform: uppercase;
      letter-spacing: 0.08em;
    }


    .mss-editor-tool-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;

      gap: 7px;

      margin-top: 10px;
    }


    /*
     * Give the resulting Shape list more separation from the
     * creation tools without creating another visual section.
     */
    .mss-editor-shape-list {
      margin-top: 24px;
    }


    /* ============================================================
       OBJECT LIST DRAG / DROP
       ============================================================ */

    .mss-editor-object[draggable="true"] {
      cursor: grab;
    }


    .mss-editor-object[draggable="true"]:active {
      cursor: grabbing;
    }


    .mss-editor-object.dragging {
      opacity: 0.45;
    }


    .mss-editor-object.drag-over {
      border-color: #00a586;

      box-shadow:
        0 -2px 0
        #00a586;
    }


    /* ============================================================
       DATA FIELD LIST
       ============================================================ */

    .mss-data-field-list {
      display: flex;
      flex-direction: column;

      gap: 4px;

      max-height: 420px;

      margin-top: 8px;
      padding-right: 4px;

      overflow-x: hidden;
      overflow-y: auto;

      scrollbar-width: thin;
    }


    .mss-editor-selected-field {
      padding: 8px 10px;

      color: #f7f9fb;
      background: rgba(0, 165, 134, 0.1);

      border: 1px solid
        rgba(0, 165, 134, 0.35);

      border-radius: 7px;

      font-size: 12px;
      line-height: 1.4;
    }


    /* ============================================================
       DATA FIELD OPTION
       ============================================================ */

    .mss-data-field-option {
      width: 100%;
      min-height: 36px;

      display: flex;
      flex-direction: column;

      align-items: flex-start;
      justify-content: center;

      box-sizing: border-box;

      padding: 8px 10px;

      color: #aeb8c5;
      background: transparent;

      border: 1px solid transparent;
      border-radius: 7px;

      font-size: 13px;
      line-height: 1.35;

      text-align: left;

      cursor: pointer;

      transition:
        background 0.12s ease,
        border-color 0.12s ease,
        color 0.12s ease;
    }


    .mss-data-field-option:hover {
      color: #f7f9fb;

      background: rgba(0, 165, 134, 0.08);
    }


    .mss-data-field-option.selected {
      color: #f7f9fb;

      background: rgba(0, 165, 134, 0.15);

      border-color: #00a586;
    }


    .mss-data-field-option-label {
      display: block;

      width: 100%;
      min-width: 0;

      white-space: normal;

      overflow-wrap: anywhere;
    }


    .mss-data-field-option-secondary {
      display: block;

      width: 100%;

      margin-top: 2px;

      font-size: 11px;

      opacity: 0.6;

      text-align: left;
    }


    .mss-data-field-unavailable {
      display: block;

      margin-top: 3px;

      color: #7d8794;

      font-size: 10px;
    }


    /* ============================================================
       DATA FIELD GROUPS
       ============================================================ */

    .mss-data-field-group {
      display: flex;
      flex-direction: column;

      gap: 3px;
    }


    .mss-data-field-group
    + .mss-data-field-group {
      margin-top: 14px;
    }


    .mss-data-field-group-title {
      position: sticky;

      top: 0;

      z-index: 2;

      padding: 8px 10px;
      margin-bottom: 2px;

      color: #00c3a0;
      background: #182233;

      border-bottom:
        1px solid
        rgba(255, 255, 255, 0.05);

      font-size: 11px;
      font-weight: 800;

      text-transform: uppercase;

      letter-spacing: 0.07em;
    }


    /* ============================================================
       SAVE STATUS
       ============================================================ */

    .mss-editor-save-status {
      min-height: 16px;

      margin-top: 4px;

      color: #54d38a;

      font-size: 11px;
      font-weight: 700;

      opacity: 0;

      transition: opacity 0.16s ease;
    }


    .mss-editor-save-status.visible {
      opacity: 1;
    }


    /* ============================================================
       WORKSPACE
       ============================================================ */

    .mss-editor-workspace {
      min-width: 0;
      min-height: 0;

      display: flex;
      flex-direction: column;

      background: #0b111c;
    }


    .mss-editor-workspace-toolbar {
      flex: 0 0 auto;

      min-height: 46px;

      display: flex;

      align-items: center;
      justify-content: space-between;

      gap: 12px;

      padding: 8px 14px;
      box-sizing: border-box;

      color: #aeb8c5;
      background: #151f2f;

      border-bottom: 1px solid #2e3c52;
    }


    .mss-editor-workspace-toolbar div {
      display: flex;

      gap: 6px;
    }


    .mss-editor-workspace-toolbar button,
    .mss-editor-tool-grid button {
      padding: 7px 9px;

      color: #7d8794;
      background: #223047;

      border: 1px solid #2e3c52;
      border-radius: 6px;

      transition:
        background 0.14s ease,
        border-color 0.14s ease,
        color 0.14s ease,
        transform 0.1s ease;
    }


    .mss-editor-tool-grid button:hover {
      color: #f7f9fb;
      background: rgba(0, 165, 134, 0.1);
      border-color: rgba(0, 165, 134, 0.65);
    }


    .mss-editor-tool-grid button:active {
      transform: scale(0.97);
    }


    /* ============================================================
       CANVAS SHELL
       ============================================================ */

    .mss-editor-canvas-shell {
      flex: 1;
      min-height: 0;

      display: flex;

      align-items: center;
      justify-content: center;

      padding: 20px;
      box-sizing: border-box;

      overflow: auto;

      overscroll-behavior: contain;
    }


    /* ============================================================
       EDITOR STAGE
       ============================================================ */

    .mss-editor-stage {
      position: relative;

      display: inline-block;

      width: fit-content;
      height: fit-content;

      max-width: 100%;
      max-height: 100%;

      line-height: 0;

      background: #ffffff;

      box-shadow:
        0 12px 38px
        rgba(0, 0, 0, 0.32);

      transform-origin: center center;

      touch-action: none;
      user-select: none;

      opacity: 0;

      transition:
        opacity 0.08s ease,
        transform 0.12s ease;
    }


    .mss-editor-stage-image {
      display: block;

      width: auto;
      height: auto;

      max-width: 100%;
      max-height: calc(100vh - 170px);

      object-fit: contain;

      pointer-events: none;
      user-select: none;
    }


    /* ============================================================
       EDITOR CANVAS — OVERLAY INTERACTION
       ============================================================ */

    .mss-editor-stage
    .overlay.callout.editor-callout {
      pointer-events: auto;

      touch-action: none;

      cursor: grab;
    }


    .mss-editor-stage
    .overlay.callout.editor-callout.dragging {
      cursor: grabbing;
    }


    .mss-editor-stage
    .overlay.point.editor-point {
      pointer-events: auto;

      touch-action: none;

      cursor: grab;
    }


    .mss-editor-stage
    .overlay.point.editor-point.dragging {
      cursor: grabbing;
    }


    /* ============================================================
       EDITOR CANVAS — SHAPE INTERACTION
       ============================================================ */

    .mss-editor-stage
    .editor-shape {
      pointer-events: auto;

      touch-action: none;

      cursor: grab;
    }


    .mss-editor-stage
    .editor-shape.dragging {
      cursor: grabbing;
    }


    /* ============================================================
       EDITOR CANVAS — SELECTION STATES
       ============================================================ */

    .mss-editor-stage
    .overlay.callout.editor-callout.selected {
      outline: 2px solid #00a586;
      outline-offset: 3px;
    }


    .mss-editor-stage
    .overlay.point.editor-point.selected {
      box-shadow:
        0 0 0 4px
        rgba(0, 165, 134, 0.28);
    }


    .mss-editor-stage
    .editor-shape.selected {
      outline: 1px solid #00a586;
      outline-offset: 2px;
    }


    .mss-editor-stage
    .editor-shape.selected,
    .mss-editor-stage
    .overlay.callout.editor-callout.selected {
      filter:
        drop-shadow(
          0 0 4px
          rgba(0, 165, 134, 0.25)
        );
    }


    /* ============================================================
       GENERIC RESIZE HANDLES
       ============================================================ */

    .mss-resize-handle {
      position: absolute;

      width: 10px;
      height: 10px;

      box-sizing: border-box;

      background: #0b1420;

      border: 2px solid #00a586;

      z-index: 20;

      pointer-events: auto;
      touch-action: none;

      display: none;
    }


    .mss-resize-handle.top-left {
      left: -5px;
      top: -5px;

      cursor: nwse-resize;
    }


    .mss-resize-handle.top-right {
      right: -5px;
      top: -5px;

      cursor: nesw-resize;
    }


    .mss-resize-handle.bottom-left {
      left: -5px;
      bottom: -5px;

      cursor: nesw-resize;
    }


    .mss-resize-handle.bottom-right {
      right: -5px;
      bottom: -5px;

      cursor: nwse-resize;
    }


    .editor-callout.selected
    > .mss-resize-handle,
    .editor-shape.selected
    > .mss-resize-handle {
      display: block;
    }


    /* ============================================================
       IMAGE SHAPES
       ============================================================ */

    .mss-shape-image {
      overflow: visible;
    }


    .mss-shape-image-content {
      width: 100%;
      height: 100%;

      overflow: hidden;

      pointer-events: none;
    }


    .mss-shape-image-content img {
      display: block;

      width: 100%;
      height: 100%;

      pointer-events: none;
      user-select: none;

      -webkit-user-drag: none;
    }


    /* ============================================================
       REFERENCE LINE
       ============================================================ */

    .mss-reference-line {
      position: absolute;

      background: #00a586;

      transform-origin: left center;

      pointer-events: none;

      z-index: 2;
    }


    /* ============================================================
       PROPERTY GROUPS
       ============================================================ */

    .mss-editor-property-group {
      margin-bottom: 22px;
      padding-bottom: 20px;

      border-bottom: 1px solid #2e3c52;
    }


    .mss-editor-property-group summary {
      margin-bottom: 14px;

      color: #00a586;

      cursor: pointer;

      font-size: 15px;
      font-weight: 700;

      opacity: 0.92;
    }


    .mss-editor-summary-row {
      display: flex;

      align-items: center;
      justify-content: space-between;

      gap: 8px;
    }


    .mss-editor-summary-row
    .mss-editor-icon-button {
      flex: 0 0 auto;
    }


    .mss-editor-property-content {
      padding-top: 4px;
    }


    .mss-editor-property-group h3 {
      margin-bottom: 14px;

      color: #00a586;
    }


    /* ============================================================
       PROPERTY FIELDS
       ============================================================ */

    .mss-editor-field {
      display: flex;
      flex-direction: column;

      gap: 7px;

      margin-bottom: 14px;
    }


    .mss-editor-field
    > span {
      color: #aeb8c5;

      font-size: 12px;
      font-weight: 700;
    }


    .mss-editor-input {
      width: 100%;

      box-sizing: border-box;

      padding: 9px 10px;

      color: #f7f9fb;
      background: #0f1724;

      border: 1px solid #2e3c52;
      border-radius: 7px;

      transition:
        border-color 0.14s ease,
        box-shadow 0.14s ease,
        background 0.14s ease;
    }


    .mss-editor-input:focus {
      outline: none;

      border-color: #00a586;

      box-shadow:
        0 0 0 3px
        rgba(0, 165, 134, 0.12);
    }


    .mss-editor-input:disabled {
      color: #aeb8c5;

      opacity: 0.82;
    }


    #editorElementPath {
      display: block;

      width: 100%;
      min-height: 48px;
    }


    .mss-editor-property-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;

      gap: 8px;
    }


    /* ============================================================
       VIEW ACTIONS
       ============================================================ */

    .mss-editor-view-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;

      gap: 10px;
    }


    .mss-editor-view-actions
    .mss-editor-action-button {
      width: 100%;
      height: 46px;

      margin: 0;

      box-sizing: border-box;
    }


    /* ============================================================
       ACTION BUTTONS
       ============================================================ */

    .mss-editor-action-button {
      flex: 1;

      padding: 9px 10px;

      color: #f7f9fb;
      background: #223047;

      border: 1px solid #2e3c52;
      border-radius: 7px;

      cursor: pointer;
    }


    .mss-editor-action-button.danger {
      color: #ff8d8d;

      border-color: #7a3939;
    }


    /* ============================================================
       CHECKBOX
       ============================================================ */

    .mss-editor-checkbox {
      display: flex;

      align-items: center;

      gap: 8px;

      color: #aeb8c5;

      font-size: 13px;
    }


    /* ============================================================
       OVERLAY ACTIONS
       ============================================================ */

    .mss-editor-overlay-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;

      gap: 10px;

      margin-top: 16px;
    }


    .mss-editor-overlay-actions
    .mss-editor-action-button {
      width: 100%;
      height: 46px;

      margin: 0;

      box-sizing: border-box;
    }


    #deleteMssOverlay {
      margin: 0;
    }


    /* ============================================================
       OVERLAY ELEMENT LIST
       ============================================================ */

    .mss-editor-element-list {
      display: flex;
      flex-direction: column;

      gap: 6px;
    }


    .mss-editor-element {
      width: 100%;

      padding: 10px 8px;

      color: #f7f9fb;
      background: transparent;

      border: 1px solid transparent;
      border-bottom-color: #2e3c52;

      text-align: left;

      cursor: pointer;
    }


    .mss-editor-element:hover {
      background: rgba(0, 165, 134, 0.07);
    }


    .mss-editor-element.selected {
      background: rgba(0, 165, 134, 0.12);

      border-color: #00a586;
      border-radius: 7px;
    }


    .mss-editor-element strong,
    .mss-editor-element span {
      display: block;
    }


    .mss-editor-element span {
      margin-top: 4px;

      color: #7d8794;

      font-size: 11px;
    }


    /* ============================================================
       ENTITY PICKER
       ============================================================ */

    .mss-editor-entity-picker {
      width: 100%;
      min-height: 40px;

      padding: 2px;

      background: #0f1724;

      border: 1px solid #2e3c52;
      border-radius: 8px;

      box-sizing: border-box;

      font-size: 13px;
    }


    .mss-editor-entity-picker:focus-within {
      border-color: #00a586;

      box-shadow:
        0 0 0 1px
        rgba(0, 165, 134, 0.25);
    }


    .mss-editor-entity-picker
    ha-entity-picker {
      display: block;

      width: 100%;

      --mdc-typography-subtitle1-font-size: 13px;
      --mdc-typography-body1-font-size: 12px;
    }


    /* ============================================================
       EMPTY / PLACEHOLDER STATES
       ============================================================ */

    .mss-editor-empty,
    .mss-editor-placeholder {
      color: #7d8794;

      font-size: 13px;
    }


    /* ============================================================
       COLLAPSED ELEMENT SECTION
       ============================================================ */

    details[data-editor-section="elements"]:not([open])
    #addMssElement {
      display: none;
    }


    /* ============================================================
       AUTO ROUTING CONDITIONS
       ============================================================ */

    .mss-routing-condition {
      position: relative;

      display: flex;
      flex-direction: column;

      gap: 14px;

      margin-top: 10px;
      padding: 16px;

      border: 1px solid var(--divider-color);
      border-radius: 10px;
    }


    .mss-routing-field-group,
    .mss-routing-condition-value {
      display: flex;
      flex-direction: column;

      gap: 6px;

      min-width: 0;
    }


    .mss-routing-label {
      color: var(--secondary-text-color);

      font-size: 11px;
      font-weight: 600;

      text-transform: uppercase;

      letter-spacing: 0.04em;
    }


    .mss-routing-condition-value-row {
      display: grid;

      grid-template-columns:
        150px
        minmax(0, 1fr);

      gap: 8px;

      min-width: 0;
    }


    .mss-routing-condition-value-row
    .mss-editor-input {
      width: 100%;
      min-width: 0;
    }


    .mss-routing-remove {
      position: absolute;

      top: 8px;
      right: 8px;

      width: 28px;
      height: 28px;

      display: inline-flex;
      align-items: center;
      justify-content: center;

      padding: 0;

      color: var(--error-color);
      background: transparent;

      border: 0;
      border-radius: 6px;

      cursor: pointer;
    }


    .mss-routing-remove:hover {
      background:
        color-mix(
          in srgb,
          var(--error-color) 12%,
          transparent
        );
    }


    /* ============================================================
       AUTO ROUTING — DYNAMIC INFORMATION
       ============================================================ */

    .mss-routing-dynamic {
      padding: 10px 12px;

      border-radius: 8px;

      background:
        color-mix(
          in srgb,
          var(--primary-color) 7%,
          transparent
        );
    }


    .mss-routing-dynamic-title {
      color: var(--secondary-text-color);

      font-size: 11px;
      font-weight: 600;
    }


    .mss-routing-dynamic-name {
      line-height: 1.45;

      overflow-wrap: anywhere;
    }


    /* ============================================================
       AUTO ROUTING — ADVANCED
       ============================================================ */

    .mss-routing-advanced {
      margin-top: 10px;
    }


    .mss-routing-advanced summary {
      color: var(--secondary-text-color);

      cursor: pointer;

      font-size: 12px;
    }


    .mss-routing-advanced
    .mss-editor-input {
      width: 100%;

      margin-top: 8px;
    }


    .mss-routing-pattern-input {
      width: 100%;
      min-width: 0;

      min-height: 72px;
      max-height: 160px;

      box-sizing: border-box;

      resize: vertical;

      font-family: monospace;
      font-size: 11px;
      line-height: 1.4;

      overflow-wrap: anywhere;
      word-break: break-all;
    }


    /* ============================================================
       CANVAS LAYER ORDER
       ============================================================ */

    .mss-editor-stage
    .overlay.callout {
      z-index: 3;
    }


    .mss-editor-stage
    .overlay.point {
      z-index: 4;
    }


    /* ============================================================
       RESPONSIVE — TABLET
       ============================================================ */

    @media (max-width: 950px) {

      .mss-editor-layout {
        grid-template-columns:
          220px
          minmax(0, 1fr);
      }

      .mss-editor-sidebar.right {
        display: none;
      }
    }


    /* ============================================================
       RESPONSIVE — MOBILE
       ============================================================ */

    @media (max-width: 700px) {

      .mss-editor-backdrop {
        padding: 0;
      }

      .mss-editor-dialog {
        border-radius: 0;
      }

      .mss-editor-layout {
        grid-template-columns: 1fr;
      }

      .mss-editor-sidebar {
        display: none;
      }

      .mss-routing-condition-action {
        display: flex;
        flex-direction: column;

        align-items: flex-start;

        gap: 8px;
      }

      .mss-editor-help {
        display: block;

        line-height: 1.4;
      }
    }


    .mss-editor-color-input {
      width: 100%;
      height: 38px;

      padding: 4px;

      box-sizing: border-box;

      border:
        1px solid
        var(--divider-color);

      border-radius: 6px;

      background:
        var(--card-background-color);

      cursor: pointer;
    }


    .mss-editor-color-input::-webkit-color-swatch-wrapper {
      padding: 0;
    }


    .mss-editor-color-input::-webkit-color-swatch {
      border: 0;
      border-radius: 4px;
    }


    /* ============================================================
       CHECKBOX PROPERTY FIELD
       ============================================================ */

    .mss-editor-field.checkbox {
      display: flex;
      flex-direction: row;

      align-items: center;

      gap: 9px;

      width: 100%;
    }


    .mss-editor-field.checkbox
    input[type='checkbox'] {
      width: 16px;
      height: 16px;

      flex: 0 0 auto;

      margin: 0;

      accent-color: #00a586;

      cursor: pointer;
    }


    .mss-editor-field.checkbox span {
      margin: 0;

      cursor: pointer;
    }


    /* ============================================================
       CONDITIONAL PROPERTY SECTION
       ============================================================ */

    .mss-editor-conditional-section {
      display: flex;
      flex-direction: column;

      gap: 14px;

      margin-top: 8px;
      padding-top: 14px;

      border-top:
        1px solid
        rgba(255, 255, 255, 0.08);
    }


    .mss-editor-conditional-content {
      display: flex;
      flex-direction: column;

      gap: 14px;
    }


    /* ============================================================
       GRID
       ============================================================ */

    .mss-editor-grid-overlay {
      position: absolute;
      inset: 0;

      display: none;

      pointer-events: none;
      z-index: 1;

      background-image:
        linear-gradient(
          to right,
          rgba(255, 255, 255, 0.08) 1px,
          transparent 1px
        ),
        linear-gradient(
          to bottom,
          rgba(255, 255, 255, 0.08) 1px,
          transparent 1px
        ),
        linear-gradient(
          to right,
          rgba(0, 165, 134, 0.28) 1px,
          transparent 1px
        ),
        linear-gradient(
          to bottom,
          rgba(0, 165, 134, 0.28) 1px,
          transparent 1px
        );

      background-size:
        20px 20px,
        20px 20px,
        100px 100px,
        100px 100px;
    }


    .mss-editor-stage.grid-enabled
    .mss-editor-grid-overlay {
      display: block;
    }


    /* ============================================================
       EDITOR ZOOM
       ============================================================ */

    .mss-editor-stage-zoom {
      display: inline-block;

      transform-origin: center center;

      transition:
        transform 0.12s ease;
    }


    .mss-editor-canvas-controls {
      display: flex;
      align-items: center;

      gap: 6px;
    }


    .mss-editor-canvas-controls button {
      min-width: 34px;
      height: 32px;

      display: inline-flex;
      align-items: center;
      justify-content: center;
    }


    .mss-editor-canvas-controls button.active {
      color: #ffffff;

      background: rgba(0, 165, 134, 0.18);

      border-color: #00a586;
    }


    .mss-editor-zoom-value {
      min-width: 58px !important;

      font-variant-numeric: tabular-nums;
    }


    /* ============================================================
       LINE / ARROW ENDPOINT HANDLES
       ============================================================ */

    .mss-line-endpoint-handle {
      display: none;

      position: absolute;

      width: 12px;
      height: 12px;

      box-sizing: border-box;

      border: 2px solid #00a586;
      border-radius: 50%;

      background: #ffffff;

      transform:
        translate(-50%, -50%);

      cursor: move;

      z-index: 10;
    }


    .editor-shape.selected
    > .mss-line-endpoint-handle {
      display: block;
    }


    .mss-line-endpoint-handle:hover {
      transform:
        translate(-50%, -50%)
        scale(1.15);
    }


    .mss-editor-back-button .mss-action-icon,
    .mss-routing-remove .mss-action-icon {
      display: block;
    }


    /* ============================================================
       LINE / ARROW SELECTION
       ============================================================ */

    .editor-shape.mss-shape-line.selected,
    .editor-shape.mss-shape-arrow.selected {
      outline: none;
      box-shadow: none;
    }

    .mss-tooltip {
        position: fixed;
        z-index: 20000;

        padding: 6px 9px;

        color: #f7f9fb;
        background: rgba(15, 23, 36, 0.96);

        border: 1px solid #2e3c52;
        border-radius: 7px;

        box-shadow:
          0 8px 24px
          rgba(0, 0, 0, 0.35);

        font-size: 11px;
        font-weight: 600;

        pointer-events: none;

        opacity: 0;
        transform: translateY(4px) scale(0.98);

        transition:
          opacity 0.12s ease,
          transform 0.12s ease;
      }

      .mss-tooltip.visible {
        opacity: 1;
        transform: translateY(0) scale(1);
      }

      /* ============================================================
        TOOLTIPS
        ============================================================ */

      .mss-tooltip-trigger {
        position: relative;
      }

      .mss-tooltip-trigger::after {
        content: attr(data-tooltip);

        position: absolute;

        left: 50%;
        bottom: calc(100% + 9px);

        z-index: 100;

        padding: 6px 9px;

        color: #f7f9fb;
        background: rgba(15, 23, 36, 0.97);

        border: 1px solid #2e3c52;
        border-radius: 7px;

        box-shadow:
          0 8px 24px
          rgba(0, 0, 0, 0.35);

        font-size: 11px;
        font-weight: 600;
        line-height: 1.2;

        white-space: nowrap;

        pointer-events: none;

        opacity: 0;

        transform:
          translateX(-50%)
          translateY(4px)
          scale(0.98);

        transition:
          opacity 0.12s ease,
          transform 0.12s ease;

        transition-delay: 0s;
      }

      .mss-tooltip-trigger:hover::after,
      .mss-tooltip-trigger:focus-visible::after {
        opacity: 1;

        transform:
          translateX(-50%)
          translateY(0)
          scale(1);

        transition-delay: 0.35s;
      }

      .mss-tooltip-trigger::before {
        content: '';

        position: absolute;

        left: 50%;
        bottom: calc(100% + 4px);

        z-index: 101;

        width: 7px;
        height: 7px;

        background: #0f1724;

        border-right: 1px solid #2e3c52;
        border-bottom: 1px solid #2e3c52;

        pointer-events: none;

        opacity: 0;

        transform:
          translateX(-50%)
          rotate(45deg);

        transition:
          opacity 0.12s ease;

        transition-delay: 0s;
      }

      .mss-tooltip-trigger:hover::before,
      .mss-tooltip-trigger:focus-visible::before {
        opacity: 1;

        transition-delay: 0.35s;
      }

      /* Sidebar tooltips open downward so they don't get clipped */
        .mss-editor-sidebar
        .mss-tooltip-trigger::after {
          top: calc(100% + 9px);
          bottom: auto;

          transform:
            translateX(-50%)
            translateY(-4px)
            scale(0.98);
        }

        .mss-editor-sidebar
        .mss-tooltip-trigger:hover::after,
        .mss-editor-sidebar
        .mss-tooltip-trigger:focus-visible::after {
          transform:
            translateX(-50%)
            translateY(0)
            scale(1);
        }


        /* Arrow */
        .mss-editor-sidebar
        .mss-tooltip-trigger::before {
          top: calc(100% + 4px);
          bottom: auto;

          border-right: 0;
          border-bottom: 0;

          border-left: 1px solid #2e3c52;
          border-top: 1px solid #2e3c52;

          transform:
            translateX(-50%)
            rotate(45deg);
        }

        .mss-tooltip-down::after {
          top: calc(100% + 9px);
          bottom: auto;

          transform:
            translateX(-50%)
            translateY(-4px)
            scale(0.98);
        }

        .mss-tooltip-down:hover::after,
        .mss-tooltip-down:focus-visible::after {
          transform:
            translateX(-50%)
            translateY(0)
            scale(1);
        }

        .mss-tooltip-down::before {
          top: calc(100% + 4px);
          bottom: auto;

          border-right: 0;
          border-bottom: 0;

          border-left: 1px solid #2e3c52;
          border-top: 1px solid #2e3c52;

          transform:
            translateX(-50%)
            rotate(45deg);
        }

  </style>
`;

    // ============================================================
    // EVENTS
    // ============================================================

    this.bindEvents();

    // ============================================================
    // RESTORE SCROLL POSITION
    // ============================================================

    requestAnimationFrame(() => {
      const newLeftSidebar = this.shadowRoot?.querySelector(
        '.mss-editor-sidebar.left'
      );

      const newRightSidebar = this.shadowRoot?.querySelector(
        '.mss-editor-sidebar.right'
      );

      const newCanvas = this.shadowRoot?.querySelector(
        '.mss-editor-canvas-shell'
      );

      if (newLeftSidebar) {
        newLeftSidebar.scrollTop = scrollState.leftTop;
      }

      if (newRightSidebar) {
        newRightSidebar.scrollTop = scrollState.rightTop;
      }

      if (newCanvas) {
        newCanvas.scrollTop = scrollState.canvasTop;
        newCanvas.scrollLeft = scrollState.canvasLeft;
      }
    });
  }
}

Object.assign(MSSViewEditorDialog.prototype, overlayRenderMethods);

if (!customElements.get('mss-view-editor-dialog')) {
  customElements.define('mss-view-editor-dialog', MSSViewEditorDialog);
}
