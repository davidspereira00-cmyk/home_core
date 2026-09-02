export const overlayRenderMethods = {
  // Renders an overlay for either the Viewer or the Editor.
  renderOverlay(overlay, editable = false) {
    if (overlay.position && overlay.pointer) {
      const selected = this.selectedOverlay?.id === overlay.id;
      return `
      ${
        overlay.referenceLineVisible !== false
          ? `
            <div
              class="mss-reference-line"
              data-overlay-reference-line="${overlay.id}"
              style="
                position:absolute;
                height:${overlay.referenceLineThickness ?? 4}px;
                background:#00a586;
                transform-origin:left center;
                pointer-events:none;
                z-index:2;
              ">
            </div>
          `
          : ''
      }

      <div
        class="
          overlay
          callout
          ${editable ? 'editor-callout' : ''}
          ${selected ? 'selected' : ''}
        "
        data-overlay="${overlay.id}"
        style="
          left:${overlay.position.x}%;
          top:${overlay.position.y}%;
          width:${overlay.size?.width ?? 220}px;
          min-height:${overlay.size?.height ?? 120}px;
        ">

        <div
          class="callout-title"
          style="
            font-size:${overlay.titleFontSize ?? 16}px;
          ">
          ${overlay.name ?? 'Overlay'}
        </div>

        ${
          editable
            ? `
              <div class="editor-callout-elements">
                ${(overlay.elements ?? [])
                  .map(
                    (element) => `
                      <div
                        class="editor-callout-element"
                        data-element-preview="${element.id}"
                        style="
                          font-size:${element.fontSize ?? 14}px;
                        ">
                        ${element.name ?? element.path ?? 'Element'}
                      </div>
                    `
                  )
                  .join('')}
              </div>

              ${this.renderResizeHandles({
                id: overlay.id,
                type: 'overlay',
                editable,
              })}
            `
            : `
              ${(overlay.elements ?? [])
                .map((element) => this.renderOverlayElement(element))
                .join('')}
            `
        }
      </div>

      ${
        overlay.pointerVisible !== false
          ? `
          <div
            class="
              overlay
              point
              ${editable ? 'editor-point' : ''}
              ${selected ? 'selected' : ''}
            "
            data-overlay-point="${overlay.id}"
            ${editable ? `data-overlay-pointer="${overlay.id}"` : ''}
              style="
                left:${overlay.pointer.x}%;
                top:${overlay.pointer.y}%;
                width:${overlay.pointerSize ?? 10}px;
                height:${overlay.pointerSize ?? 10}px;
                background:#00a586;
              ">
            </div>
          `
          : ''
      }
    `;
    }

    if (overlay.type === 'circle') {
      return `
      <div
        class="overlay circle"
        style="
          left:${overlay.x}%;
          top:${overlay.y}%;
          width:${overlay.w}%;
          height:${overlay.h}%;
          border-color:${overlay.color};
        ">
      </div>
    `;
    }

    if (overlay.type === 'point') {
      return `
      <div
        class="overlay point"
        style="
          left:${overlay.x}%;
          top:${overlay.y}%;
          background:${overlay.color};
        ">
      </div>
    `;
    }

    if (overlay.type === 'text') {
      return `
      <div
        class="overlay text"
        style="
          left:${overlay.x}%;
          top:${overlay.y}%;
          color:${overlay.color};
          border-color:${overlay.color};
        ">
        ${overlay.label}
      </div>
    `;
    }

    if (overlay.type === 'arrow') {
      const dx = overlay.x2 - overlay.x1;

      const dy = overlay.y2 - overlay.y1;

      const length = Math.sqrt(dx * dx + dy * dy);

      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

      return `
      <div
        class="overlay arrow"
        style="
          left:${overlay.x1}%;
          top:${overlay.y1}%;
          width:${length}%;
          background:${overlay.color};
          transform:rotate(${angle}deg);
        ">
        <span
          style="
            border-left-color:${overlay.color};
          ">
        </span>
      </div>
    `;
    }

    if (overlay.type === 'rectangle') {
      return `
    <div
      class="overlay rectangle"
      style="
        position:absolute;
        left:${overlay.x}%;
        top:${overlay.y}%;
        width:${overlay.w}%;
        height:${overlay.h}%;
        box-sizing:border-box;
        border:3px solid ${overlay.color ?? '#00a586'};
        background:transparent;
        pointer-events:none;
        z-index:3;
      ">
    </div>
  `;
    }

    if (overlay.type === 'measurementValue') {
      const value = this.resolveMeasurementField(overlay.field);

      return `
      <div
        class="overlay measurement-value"
        style="
          left:${overlay.x}%;
          top:${overlay.y}%;
          border-color:${overlay.color};
        ">
        <span>
          ${overlay.label}
        </span>

        <strong>
          ${value}
        </strong>
      </div>
    `;
    }

    return '';
  },

  renderShape(shape, editable = false) {
    if (!shape) {
      return '';
    }

    const selected = this.selectedShape?.id === shape.id;

    // ==========================================================
    // RECTANGLE
    // ==========================================================

    if (shape.type === 'rectangle') {
      const fillColor = shape.fillTransparent
        ? 'transparent'
        : this.resolveShapeColor(shape);

      const borderColor = shape.borderColor ?? '#000000';

      const borderWidth = Number(shape.borderWidth ?? 0);

      const borderRadius = Number(shape.borderRadius ?? 0);

      const opacity = Number(shape.opacity ?? 1);

      return `
    <div
      class="
        mss-shape
        mss-shape-rectangle
        ${editable ? 'editor-shape' : ''}
        ${selected ? 'selected' : ''}
      "
      data-shape="${shape.id}"
      style="
        position:absolute;
        left:${shape.position?.x ?? 30}%;
        top:${shape.position?.y ?? 30}%;
        width:${shape.size?.width ?? 20}%;
        height:${shape.size?.height ?? 15}%;

        box-sizing:border-box;

        background:${fillColor};

        border:
          ${borderWidth}px
          solid
          ${borderColor};

        border-radius:${borderRadius}px;

        opacity:${opacity};

        pointer-events:${editable ? 'auto' : 'none'};

        z-index:3;
      ">

      ${this.renderResizeHandles({
        id: shape.id,
        type: 'shape',
        editable,
      })}

    </div>
  `;
    }

    // ==========================================================
    // LINE
    // ==========================================================

    if (shape.type === 'line') {
      const strokeColor = this.resolveShapeColor(shape);

      const strokeWidth = Number(shape.strokeWidth ?? 3);

      const opacity = Number(shape.opacity ?? 1);

      const start = shape.start ?? {
        x: 30,
        y: 30,
      };

      const end = shape.end ?? {
        x: 55,
        y: 30,
      };

      const minX = Math.min(start.x, end.x);

      const minY = Math.min(start.y, end.y);

      const maxX = Math.max(start.x, end.x);

      const maxY = Math.max(start.y, end.y);

      const width = Math.max(maxX - minX, 0.01);

      const height = Math.max(maxY - minY, 0.01);

      const x1 = ((start.x - minX) / width) * 100;

      const y1 = ((start.y - minY) / height) * 100;

      const x2 = ((end.x - minX) / width) * 100;

      const y2 = ((end.y - minY) / height) * 100;

      return `
    <div
      class="
        mss-shape
        mss-shape-line
        ${editable ? 'editor-shape' : ''}
        ${selected ? 'selected' : ''}
      "
      data-shape="${shape.id}"
      style="
        position:absolute;

        left:${minX}%;
        top:${minY}%;

        width:${width}%;
        height:${height}%;

        box-sizing:border-box;

        overflow:visible;

        pointer-events:${editable ? 'auto' : 'none'};

        z-index:3;
      ">

      <svg
        class="mss-shape-line-svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style="
          position:absolute;
          inset:0;

          width:100%;
          height:100%;

          overflow:visible;

          pointer-events:auto;
        ">

        <line
          class="mss-shape-line-content"
          x1="${x1}"
          y1="${y1}"
          x2="${x2}"
          y2="${y2}"
          vector-effect="non-scaling-stroke"
          stroke="${strokeColor}"
          stroke-width="${strokeWidth}"
          stroke-linecap="round"
          opacity="${opacity}"
          pointer-events="none">
        </line>

        <line
          class="mss-shape-line-hit-area"
          x1="${x1}"
          y1="${y1}"
          x2="${x2}"
          y2="${y2}"
          vector-effect="non-scaling-stroke"
          stroke="transparent"
          stroke-width="16"
          stroke-linecap="round"
          pointer-events="stroke">
        </line>

      </svg>

      ${
        editable
          ? `
              <div
                class="mss-line-endpoint-handle start"
                data-line-endpoint="start"
                data-shape="${shape.id}"
                style="
                  left:${x1}%;
                  top:${y1}%;
                ">
              </div>

              <div
                class="mss-line-endpoint-handle end"
                data-line-endpoint="end"
                data-shape="${shape.id}"
                style="
                  left:${x2}%;
                  top:${y2}%;
                ">
              </div>
            `
          : ''
      }

    </div>
  `;
    }

    // ==========================================================
    // ARROW
    // ==========================================================

    if (shape.type === 'arrow') {
      const strokeColor = this.resolveShapeColor(shape);

      const strokeWidth = Number(shape.strokeWidth ?? 3);

      const arrowHeadSize = Number(shape.arrowHeadSize ?? 12);

      const opacity = Number(shape.opacity ?? 1);

      const start = shape.start ?? {
        x: 30,
        y: 30,
      };

      const end = shape.end ?? {
        x: 55,
        y: 30,
      };

      const minX = Math.min(start.x, end.x);

      const minY = Math.min(start.y, end.y);

      const maxX = Math.max(start.x, end.x);

      const maxY = Math.max(start.y, end.y);

      const width = Math.max(maxX - minX, 0.01);

      const height = Math.max(maxY - minY, 0.01);

      const x1 = ((start.x - minX) / width) * 100;

      const y1 = ((start.y - minY) / height) * 100;

      const x2 = ((end.x - minX) / width) * 100;

      const y2 = ((end.y - minY) / height) * 100;

      return `
    <div
      class="
        mss-shape
        mss-shape-arrow
        ${editable ? 'editor-shape' : ''}
        ${selected ? 'selected' : ''}
      "
      data-shape="${shape.id}"
      style="
        position:absolute;

        left:${minX}%;
        top:${minY}%;

        width:${width}%;
        height:${height}%;

        overflow:visible;

        pointer-events:${editable ? 'auto' : 'none'};

        z-index:3;
      ">

      <svg
        class="mss-shape-line-svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style="
          position:absolute;
          inset:0;

          width:100%;
          height:100%;

          overflow:visible;

          pointer-events:auto;
        ">

        <line
          class="mss-shape-line-content"
          x1="${x1}"
          y1="${y1}"
          x2="${x2}"
          y2="${y2}"
          vector-effect="non-scaling-stroke"
          stroke="${strokeColor}"
          stroke-width="${strokeWidth}"
          stroke-linecap="round"
          opacity="${opacity}"
          pointer-events="none">
        </line>

        <line
            class="mss-shape-line-hit-area"
            x1="${x1}"
            y1="${y1}"
            x2="${x2}"
            y2="${y2}"
            vector-effect="non-scaling-stroke"
            stroke="transparent"
            stroke-width="16"
            stroke-linecap="round"
            pointer-events="stroke">
          </line>

      </svg>

      <div
        class="mss-arrow-head"
        style="
          position:absolute;

          left:${x2}%;
          top:${y2}%;

          width:0;
          height:0;

          border-top:
            ${arrowHeadSize / 2}px
            solid transparent;

          border-bottom:
            ${arrowHeadSize / 2}px
            solid transparent;

          border-left:
            ${arrowHeadSize}px
            solid ${strokeColor};

          opacity:${opacity};

          transform-origin:0 50%;

          pointer-events:none;
        ">
      </div>

      ${
        editable
          ? `
              <div
                class="mss-line-endpoint-handle start"
                data-line-endpoint="start"
                data-shape="${shape.id}"
                style="
                  left:${x1}%;
                  top:${y1}%;
                ">
              </div>

              <div
                class="mss-line-endpoint-handle end"
                data-line-endpoint="end"
                data-shape="${shape.id}"
                style="
                  left:${x2}%;
                  top:${y2}%;
                ">
              </div>
            `
          : ''
      }

    </div>
  `;
    }

    // ==========================================================
    // CIRCLE
    // ==========================================================

    if (shape.type === 'circle') {
      const fillColor = shape.fillTransparent
        ? 'transparent'
        : this.resolveShapeColor(shape);

      const borderColor = shape.borderColor ?? '#000000';

      const borderWidth = Number(shape.borderWidth ?? 0);

      const opacity = Number(shape.opacity ?? 1);

      return `
    <div
      class="
        mss-shape
        mss-shape-circle
        ${editable ? 'editor-shape' : ''}
        ${selected ? 'selected' : ''}
      "
      data-shape="${shape.id}"
      style="
        position:absolute;

        left:${shape.position?.x ?? 30}%;

        top:${shape.position?.y ?? 30}%;

        width:${shape.size?.width ?? 15}%;

        height:${shape.size?.height ?? 15}%;

        box-sizing:border-box;

        background:${fillColor};

        border:
          ${borderWidth}px
          solid
          ${borderColor};

        border-radius:50%;

        opacity:${opacity};

        pointer-events:${editable ? 'auto' : 'none'};

        z-index:3;
      ">

      ${this.renderResizeHandles({
        id: shape.id,
        type: 'shape',
        editable,
      })}

    </div>
  `;
    }

    // ==========================================================
    // IMAGE
    // ==========================================================

    if (shape.type === 'image') {
      const imageSource =
        shape.imageSource === 'local' ? shape.imageUrl : shape.liveImageUrl;

      const fit = shape.fit ?? 'contain';

      return `
    <div
      class="
        mss-shape
        mss-shape-image
        ${editable ? 'editor-shape' : ''}
        ${selected ? 'selected' : ''}
      "
      data-shape="${shape.id}"
      style="
        position:absolute;
        left:${shape.position?.x ?? 30}%;
        top:${shape.position?.y ?? 30}%;
        width:${shape.size?.width ?? 30}%;
        height:${shape.size?.height ?? 20}%;
        box-sizing:border-box;
        pointer-events:${editable ? 'auto' : 'none'};
        z-index:3;
        overflow:visible;
      ">

      <div
        class="mss-shape-image-content"
        style="
          width:100%;
          height:100%;
          overflow:hidden;
          pointer-events:none;
        ">

        ${
          imageSource
            ? `
                <img
                  src="${imageSource}"
                  alt="${shape.name ?? 'Image'}"
                  draggable="false"
                  style="
                    display:block;
                    width:100%;
                    height:100%;
                    object-fit:${fit};
                    pointer-events:none;
                    user-select:none;
                  ">
              `
            : `
                ${
                  editable
                    ? `
                        <div
                          style="
                            width:100%;
                            height:100%;
                            display:flex;
                            align-items:center;
                            justify-content:center;
                            box-sizing:border-box;
                            border:1px dashed rgba(255,255,255,0.35);
                            color:rgba(255,255,255,0.65);
                            font-size:12px;
                            pointer-events:none;
                          ">
                          Select image
                        </div>
                      `
                    : ''
                }
              `
        }

      </div>

      ${this.renderResizeHandles({
        id: shape.id,
        type: 'shape',
        editable,
      })}

    </div>
  `;
    }

    // ==========================================================
    // TEXT
    // ==========================================================

    if (shape.type === 'text') {
      const textColor = this.resolveShapeColor(shape);

      const fontSize = Number(shape.fontSize ?? 16);

      const fontWeight = Number(shape.fontWeight ?? 400);

      const textAlign = shape.textAlign ?? 'left';

      const opacity = Number(shape.opacity ?? 1);

      return `
    <div
      class="
        mss-shape
        mss-shape-text
        ${editable ? 'editor-shape' : ''}
        ${selected ? 'selected' : ''}
      "
      data-shape="${shape.id}"
      style="
        position:absolute;

        left:${shape.position?.x ?? 30}%;
        top:${shape.position?.y ?? 30}%;

        width:${shape.size?.width ?? 20}%;
        height:${shape.size?.height ?? 10}%;

        box-sizing:border-box;

        pointer-events:${editable ? 'auto' : 'none'};

        z-index:3;
      ">

      <div
        class="mss-shape-text-content"
        style="
          width:100%;
          height:100%;

          box-sizing:border-box;

          display:flex;
          align-items:center;

          color:${textColor};
          font-family:Segoe UI, sans-serif;
          font-size:${fontSize}px;
          font-weight:${fontWeight};

          line-height:1.2;

          opacity:${opacity};

          white-space:pre-wrap;
          overflow:visible;

          pointer-events:none;
        ">

        <div
          class="mss-shape-text-value"
          style="
            width:100%;
            text-align:${textAlign};
          ">
          ${shape.text ?? ''}
        </div>

      </div>

    </div>
  `;
    }

    return '';
  },

  renderResizeHandles({ id, type, editable = true }) {
    if (!editable) {
      return '';
    }

    const isOverlay = type === 'overlay';

    const specificClass = isOverlay
      ? 'mss-overlay-resize-handle'
      : 'mss-shape-resize-handle';

    const dataAttribute = isOverlay
      ? 'data-overlay-resize'
      : 'data-shape-resize';

    const directions = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

    return directions
      .map(
        (direction) => `
        <div
          class="
            mss-resize-handle
            ${specificClass}
            ${direction}
          "
          ${dataAttribute}="${id}"
          data-resize-direction="${direction}">
        </div>
      `
      )
      .join('');
  },

  // Renders one overlay element using its configured type and font size.
  renderOverlayElement(element) {
    const fontSize = Number(element.fontSize) || 14;

    const isStatus =
      element.elementType === 1 ||
      String(element.elementType ?? '').toLowerCase() === 'status';

    if (isStatus) {
      const ok = this.evaluateOverlayCondition(element);

      return `
      <div
        class="callout-row status-row"
        data-mss-element="${element.id}"
        style="font-size:${fontSize}px;">

        <span>
          ${element.name ?? element.path}
        </span>

        <b
          data-mss-element-value
          class="status-pill ${ok ? 'ok' : 'nok'}"
          style="font-size:${fontSize}px;">

          ${ok ? (element.trueText ?? 'OK') : (element.falseText ?? 'NOK')}
        </b>
      </div>
    `;
    }

    return `
    <div
      class="callout-row"
      data-mss-element="${element.id}"
      style="font-size:${fontSize}px;">

      <span>
        ${element.name ?? element.path}
      </span>

      <b data-mss-element-value>
        ${this.resolveOverlayElementValue(element)}
      </b>
    </div>
  `;
  },

  // Updates visible overlay values from the latest HA state
  // without rebuilding the Viewer.
  refreshLiveOverlayValues(view = this.view) {
    if (!view || !this.shadowRoot) {
      return;
    }

    for (const overlay of view.overlays ?? []) {
      for (const element of overlay.elements ?? []) {
        const row = this.shadowRoot.querySelector(
          `[data-mss-element="${element.id}"]`
        );

        if (!row) {
          continue;
        }

        const valueElement = row.querySelector('[data-mss-element-value]');

        if (!valueElement) {
          continue;
        }

        const isStatus =
          element.elementType === 1 ||
          String(element.elementType ?? '').toLowerCase() === 'status';

        if (isStatus) {
          const ok = this.evaluateOverlayCondition(element);

          valueElement.textContent = ok
            ? (element.trueText ?? 'OK')
            : (element.falseText ?? 'NOK');

          valueElement.classList.toggle('ok', ok);

          valueElement.classList.toggle('nok', !ok);

          continue;
        }

        valueElement.textContent = this.resolveOverlayElementValue(element);
      }
    }
  },

  // Resolves an overlay element value.
  //
  // New MSS model:
  //   mssGroup   -> which MSS source/device was selected
  //   dataEntity -> actual HA entity containing the selected value
  //
  // Legacy model remains supported:
  //   path + dataPath
  resolveOverlayElementValue(element) {
    if (!element) {
      return 'Unavailable';
    }

    // ==========================================================
    // COMPOSITE MSS FIELD
    // ==========================================================
    //
    // Examples:
    //
    // Position 2D
    //   X + Y
    //
    // Size
    //   Width + Height
    //
    // Each component stores the exact HA entity and MSS path
    // selected when the View was configured.
    // ==========================================================

    if (element.bindingType === 'composite' && element.composite?.components) {
      const values = {};

      for (const [key, component] of Object.entries(
        element.composite.components
      )) {
        if (!component?.dataEntity) {
          return 'Unavailable';
        }

        const fieldState = this._hass?.states?.[component.dataEntity];

        if (!fieldState) {
          return 'Unavailable';
        }

        const value = fieldState.state;

        if (
          value === undefined ||
          value === null ||
          value === 'unknown' ||
          value === 'unavailable'
        ) {
          return 'Unavailable';
        }

        values[key] = value;
      }

      const format = element.composite.format ?? '';

      const decimals = element.composite.decimals ?? 2;

      return String(format).replace(/\{([^}]+)\}/g, (_, key) => {
        let value = values[key];

        if (value === undefined || value === null) {
          return '';
        }

        if (
          decimals !== null &&
          value !== '' &&
          Number.isFinite(Number(value))
        ) {
          value = Number(value).toFixed(Number(decimals));
        }

        return String(value);
      });
    }

    // ==========================================================
    // MEASUREMENT MSS FIELD
    // ==========================================================
    //
    // The value is the normal HA state.
    //
    // The unit is preferably read live from:
    //
    //   state.attributes.unit_of_measurement
    //
    // The stored unit is only a fallback.
    // ==========================================================

    if (element.bindingType === 'measurement' && element.dataEntity) {
      const fieldState = this._hass?.states?.[element.dataEntity];

      if (!fieldState) {
        return 'Unavailable';
      }

      let value = fieldState.state;

      if (
        value === undefined ||
        value === null ||
        value === 'unknown' ||
        value === 'unavailable'
      ) {
        return 'Unavailable';
      }

      const decimals = element.measurement?.decimals ?? 2;

      if (decimals !== null && value !== '' && Number.isFinite(Number(value))) {
        value = Number(value).toFixed(Number(decimals));
      }

      const liveUnit = fieldState.attributes?.unit_of_measurement;

      const unit = liveUnit ?? element.measurement?.unit ?? '';

      return unit ? `${value} ${unit}` : String(value);
    }

    // ==========================================================
    // NORMAL MSS DATA FIELD ENTITY
    // ==========================================================

    if (element.dataEntity) {
      const fieldState = this._hass?.states?.[element.dataEntity];

      if (!fieldState) {
        return 'Unavailable';
      }

      return fieldState.state;
    }

    // ==========================================================
    // LEGACY ENTITY
    // ==========================================================

    if (!element.path) {
      return 'Unavailable';
    }

    const state = this._hass?.states?.[element.path];

    if (!state) {
      return 'Unavailable';
    }

    // ==========================================================
    // LEGACY NESTED ATTRIBUTE PATH
    // ==========================================================

    const dataPath = this.resolveDynamicDataPath(element.dataPath?.trim());

    if (!dataPath) {
      return state.state;
    }

    let value = state.attributes;

    for (const key of dataPath.split('.')) {
      if (
        value === null ||
        value === undefined ||
        typeof value !== 'object' ||
        !(key in value)
      ) {
        return 'Unavailable';
      }

      value = value[key];
    }

    if (value === null || value === undefined) {
      return 'Unavailable';
    }

    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    return String(value);
  },
  // Resolves dynamic placeholders used in MSS data paths.
  resolveDynamicDataPath(dataPath) {
    if (!dataPath) {
      return '';
    }

    const report = this._hass?.states?.['sensor.mss_report'];

    const controlPlan =
      report?.attributes?.rootNode?.Identification?.ControlPlan;

    if (!controlPlan) {
      return dataPath;
    }

    return String(dataPath).replaceAll('{ControlPlan}', controlPlan);
  },

  // Positions one Reference Line using the rendered
  // overlay and Reference Point geometry.
  // Positions one Reference Line using the rendered
  // overlay and Reference Point geometry.
  updateReferenceLine(overlay) {
    if (!overlay || !this.shadowRoot) {
      return;
    }

    const callout = this.shadowRoot.querySelector(
      `[data-overlay="${overlay.id}"]`
    );

    const point = this.shadowRoot.querySelector(
      `[data-overlay-point="${overlay.id}"]`
    );

    const line = this.shadowRoot.querySelector(
      `[data-overlay-reference-line="${overlay.id}"]`
    );

    const stage = callout?.closest('.mss-editor-stage, .mss-image-stage');

    if (!callout || !point || !line || !stage) {
      return;
    }

    const stageRect = stage.getBoundingClientRect();

    const calloutRect = callout.getBoundingClientRect();

    const pointRect = point.getBoundingClientRect();

    /*
     * Determine how much the stage is currently
     * visually scaled.
     *
     * offsetWidth / offsetHeight are the logical,
     * untransformed dimensions.
     *
     * getBoundingClientRect() is the transformed
     * screen size.
     */
    const stageScaleX =
      stage.offsetWidth > 0 ? stageRect.width / stage.offsetWidth : 1;

    const stageScaleY =
      stage.offsetHeight > 0 ? stageRect.height / stage.offsetHeight : 1;

    /*
     * Convert all browser/screen coordinates back
     * into the stage's own coordinate system.
     */
    const left = (calloutRect.left - stageRect.left) / stageScaleX;

    const right = (calloutRect.right - stageRect.left) / stageScaleX;

    const top = (calloutRect.top - stageRect.top) / stageScaleY;

    const bottom = (calloutRect.bottom - stageRect.top) / stageScaleY;

    const pointX =
      (pointRect.left - stageRect.left + pointRect.width / 2) / stageScaleX;

    const pointY =
      (pointRect.top - stageRect.top + pointRect.height / 2) / stageScaleY;

    const centerX = (left + right) / 2;

    const centerY = (top + bottom) / 2;

    const dx = pointX - centerX;

    const dy = pointY - centerY;

    /*
     * The callout dimensions returned by
     * getBoundingClientRect() are also scaled,
     * so convert those back too.
     */
    const halfWidth = calloutRect.width / stageScaleX / 2;

    const halfHeight = calloutRect.height / stageScaleY / 2;

    const scaleX = dx !== 0 ? halfWidth / Math.abs(dx) : Infinity;

    const scaleY = dy !== 0 ? halfHeight / Math.abs(dy) : Infinity;

    const edgeScale = Math.min(scaleX, scaleY);

    /*
     * Point where the line exits the edge
     * of the callout.
     */
    const startX = centerX + dx * edgeScale;

    const startY = centerY + dy * edgeScale;

    const lineDx = pointX - startX;

    const lineDy = pointY - startY;

    const length = Math.sqrt(lineDx * lineDx + lineDy * lineDy);

    const angle = (Math.atan2(lineDy, lineDx) * 180) / Math.PI;

    /*
     * These values are now in logical stage
     * coordinates. The stage transform will scale
     * the completed line exactly once together
     * with the image and overlays.
     */
    line.style.left = `${startX}px`;

    line.style.top = `${startY}px`;

    line.style.width = `${length}px`;

    line.style.transform = `rotate(${angle}deg)`;

    line.style.transformOrigin = 'left center';
  },

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
  },

  getMssStateGroupForShape(state) {
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
  },

  resolveShapeConditionValue(shape) {
    const condition = shape?.conditionalStyle;

    if (!condition?.mssGroup || !condition?.dataPath) {
      return null;
    }

    const state = Object.values(this._hass?.states ?? {}).find((candidate) => {
      const attributes = candidate?.attributes ?? {};

      return (
        this.getMssStateGroupForShape(candidate) === condition.mssGroup &&
        attributes.mss_source_path === condition.dataPath
      );
    });

    return state?.state ?? null;
  },

  resolveShapeColor(shape) {
    const condition = shape?.conditionalStyle;

    // Normal static color.
    if (!condition?.enabled) {
      return shape.color ?? '#00a586';
    }

    const currentValue = this.resolveShapeConditionValue(shape);

    // No live value available:
    // fall back to normal color.
    if (currentValue === null) {
      return shape.color ?? '#00a586';
    }

    const matches = this.evaluateCondition({
      currentValue,

      operator: condition.operator ?? 'equals',

      compareValue: condition.compareValue ?? '',
    });

    return matches
      ? (condition.color ?? '#00a586')
      : (shape.color ?? '#00a586');
  },
};
