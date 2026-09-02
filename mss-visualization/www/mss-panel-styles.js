export function panelStyles() {
  return `
      <style>
        /* Global theme and app shell */
        .mss-app {
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

          --mss-shadow: 0 8px 24px rgba(0,0,0,.18);

          min-height: calc(100vh - 64px);
          display: flex;
          background: var(--mss-bg);
          color: var(--mss-text);
          font-family: "Segoe UI", Inter, Arial, sans-serif;
        }

        /* Sidebar and navigation */
        .mss-sidebar {
          width: 236px;
          flex: 0 0 236px;

          background: var(--mss-surface);
          border-right: 1px solid var(--mss-border);

          padding: 22px 14px;
          box-sizing: border-box;

          transition:
              width .22s ease,
              flex-basis .22s ease;
        }

        .mss-sidebar.collapsed {
          width: 76px;
          flex-basis: 76px;
        }

        .mss-sidebar-header{
            display:flex;
            justify-content:space-between;
            align-items:flex-start;
            gap:10px;
            margin-bottom:30px;
        }

        .mss-sidebar-toggle{
            width:30px;
            height:30px;
            border-radius:8px;
            border:1px solid var(--mss-border);

            background:var(--mss-surface-soft);
            color:var(--mss-text);

            cursor:pointer;

            font-size:18px;
            font-weight:700;

            transition:.15s;
        }

        .mss-sidebar-toggle:hover{
            border-color:var(--mss-primary);
            color:var(--mss-primary);
        }


        .mss-brand {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 32px;
        }

        .mss-brand-mark {
          width: 42px;
          height: 42px;
          border-radius: 12px;
          background: var(--mss-primary);
          color: white;
          display: grid;
          place-items: center;
          font-weight: 800;
          font-size: 22px;
        }

        .mss-brand-title {
          font-weight: 800;
          font-size: 22px;
        }

        .mss-brand-subtitle {
          color: var(--mss-text-secondary);
          font-size: 12px;
        }

        .mss-nav {
          width: 100%;
          border: 0;
          background: transparent;
          color: var(--mss-text-secondary);
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 13px 14px;
          border-radius: var(--mss-radius-md);
          margin-bottom: 8px;
          cursor: pointer;
          font-size: 15px;
          text-align: left;
        }

        .mss-nav-icon{
            width:24px;
            min-width:24px;
            text-align:center;
            font-size:18px;
        }

        .mss-nav-label{
            white-space:nowrap;
        }

        .mss-nav:hover,
        .mss-nav.active {
          background: rgba(0,165,134,.14);
          color: var(--mss-primary);
        }


        .mss-sidebar.collapsed .mss-brand-text{
            display:none;
        }

        .mss-sidebar.collapsed .mss-nav-label{
            display:none;
        }

        .mss-sidebar.collapsed .mss-brand{
            justify-content:center;
            margin-bottom:22px;
        }

        .mss-sidebar.collapsed .mss-sidebar-header{
            flex-direction:column;
            align-items:center;
        }

        .mss-sidebar.collapsed .mss-nav{
            justify-content:center;
            padding-left:10px;
            padding-right:10px;
        }

        .mss-main {
          flex: 1;
          padding: 32px;
          overflow: auto;
          box-sizing: border-box;
        }

        .mss-topbar {
          display: flex;
          justify-content: space-between;
          gap: 24px;
          align-items: center;
          margin-bottom: 28px;
        }

        .mss-topbar h1 {
          margin: 0;
          font-size: 32px;
          font-weight: 700;
        }

        .mss-topbar p {
          margin: 6px 0 0;
          color: var(--mss-text-secondary);
          font-size: 14px;
        }

        .mss-topbar-actions {
          display: flex;
          gap: 10px;
          align-items: center;
        }

        .mss-kicker {
            color: var(--mss-primary);
            font-size: 12px;
            font-weight: 800;
            letter-spacing: .14em;
            text-transform: uppercase;
            margin-bottom: 6px;
        }

        .mss-grid {
          display: grid;
          gap: 18px;
          margin-bottom: 18px;
        }

        .mss-grid.metrics {
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        }

        .mss-grid.two {
          grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
        }

        .mss-card {
          background: var(--mss-surface);
          border: 1px solid var(--mss-border);
          border-radius: var(--mss-radius-lg);
          padding: 24px;
          box-shadow: var(--mss-shadow);
          box-sizing: border-box;
        }

        .mss-card.full {
          width: 100%;
        }

        .mss-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 18px;
        }

        .mss-card h2 {
          margin: 0;
          font-size: 20px;
          font-weight: 700;
        }

        .metric-card .mss-label {
          display: block;
          color: var(--mss-text-secondary);
          font-size: 13px;
          margin-bottom: 8px;
        }

        .metric-card strong {
          color: var(--mss-primary);
          font-size: 30px;
          font-weight: 800;
        }

        .mss-info-row {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          padding: 12px 0;
          border-bottom: 1px solid var(--mss-border);
        }

        .mss-info-row:last-child {
          border-bottom: 0;
        }

        .mss-info-row span {
          color: var(--mss-text-secondary);
        }

        .mss-badge {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          padding: 6px 12px;
          font-size: 13px;
          font-weight: 700;
          white-space: nowrap;
        }

        .mss-badge.live,
        .mss-badge.info {
          background: rgba(0,165,134,.15);
          color: var(--mss-primary);
          border: 1px solid var(--mss-primary);
        }

        .mss-badge.success {
          background: rgba(84,211,138,.15);
          color: var(--mss-success);
          border: 1px solid var(--mss-success);
        }

        .mss-badge.neutral {
          background: var(--mss-surface-soft);
          color: var(--mss-text-secondary);
          border: 1px solid var(--mss-border);
        }

        .mss-filters {
          display: grid;
          grid-template-columns: repeat(5, minmax(160px, 1fr)) auto;
          gap: 12px;
          margin-bottom: 20px;
        }

        .mss-input {
          background: var(--mss-bg);
          color: var(--mss-text);
          border: 1px solid var(--mss-border);
          border-radius: var(--mss-radius-sm);
          padding: 11px 14px;
          outline: none;
        }

        .mss-input:focus {
          border-color: var(--mss-primary);
        }

        .mss-button {
          background: var(--mss-primary);
          color: white;
          border: none;
          border-radius: var(--mss-radius-sm);
          padding: 10px 18px;
          cursor: pointer;
          font-weight: 700;
        }

        .mss-button:hover {
          background: var(--mss-primary-hover);
        }

        .mss-table-wrap {
          border: 1px solid var(--mss-border);
          border-radius: var(--mss-radius-md);
          overflow: hidden;
        }

        .mss-table {
          width: 100%;
          border-collapse: collapse;
        }

        .mss-table th,
        .mss-table td {
          padding: 13px 14px;
          border-bottom: 1px solid var(--mss-border);
          text-align: left;
        }

        .mss-table th {
          background: var(--mss-surface-soft);
          color: var(--mss-primary);
          font-weight: 700;
        }

        .mss-table tr:hover td {
          background: rgba(0,165,134,.06);
        }

        .mss-table .empty {
          color: var(--mss-text-muted);
          text-align: center;
          padding: 32px;
        }

        .mss-muted {
          color: var(--mss-text-muted);
        }

        .measurement-row {
            cursor:pointer;
            transition:.15s;
        }

        .measurement-row:hover td{
            background:rgba(0,165,134,.08);
        }

        .measurement-row.selected td{
            background:rgba(0,165,134,.18);
        }

        /* Measurements drawer */
        .mss-drawer {
            position: fixed;
            top: 64px;
            right: 0;

            width: 420px;
            height: calc(100vh - 64px);

            background: var(--mss-surface);

            border-left: 1px solid var(--mss-border);

            box-shadow: -10px 0 35px rgba(0,0,0,.35);

            padding: 24px;
            box-sizing: border-box;

            z-index: 50;

            animation: drawerIn .25s ease;
        }
        .mss-drawer h2 {
          margin: 0;
          font-size: 24px;
        }

        .mss-drawer h3 {
          margin: 0 0 12px;
          color: var(--mss-primary);
          font-size: 15px;
          text-transform: uppercase;
          letter-spacing: .08em;
        }


        @keyframes drawerIn {

            from{
                transform:translateX(100%);
                opacity:.3;
            }

            to{
                transform:translateX(0);
                opacity:1;
            }
        }

        .mss-drawer-header {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
        margin-bottom: 20px;
        }

        .mss-drawer-section {
          margin-top: 24px;
          padding-top: 18px;
          border-top: 1px solid var(--mss-border);
        }

        .mss-pagination {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        margin-top: 18px;
        }

        .mss-button.secondary {
        background: var(--mss-surface-soft);
        color: var(--mss-text);
        border: 1px solid var(--mss-border);
        }

        .mss-error {
        color: var(--mss-error);
        margin-bottom: 12px;
        }

        /* View and inspection experience */
        .mss-view-layout {
        display: grid;
        grid-template-columns: 320px 1fr;
        gap: 20px;
        }

        .mss-view-side {
          background: var(--mss-surface-soft);
          border: 1px solid var(--mss-border);
          border-radius: var(--mss-radius-md);
          padding: 18px;
        }

        .mss-view-side h3 {
          color: var(--mss-primary);
          margin: 18px 0 12px;
        }

        .mss-view-side h3:first-child {
          margin-top: 0;

        }
        .mss-view-variable {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          border-bottom: 1px solid var(--mss-border);
          padding: 10px 0;
        }

        .mss-view-canvas {
          position: relative;
          min-height: 520px;
          background: #ffffff;
          border-radius: var(--mss-radius-md);
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .mss-view-image {
          display: block;
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
        }

        /* Overlays */
        .overlay {
          position: absolute;
          z-index: 10;
          pointer-events: none;
        }

        .mss-editor-canvas .overlay.callout {
          pointer-events: auto;
          cursor: pointer;
        }

        /* Circle overlay */
        .overlay.circle {
          border: 3px solid;
          border-radius: 50%;
          background: rgba(37, 99, 235, 0.15);
          transform: translate(-50%, -50%);
        }

        /* Point overlay */
        .overlay.point {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          transform: translate(-50%, -50%);
          box-shadow: 0 0 0 4px rgba(0, 0, 0, 0.15);
        }

        /* Text overlay */
        .overlay.text {
          border: 2px solid;
          border-radius: 8px;
          padding: 6px 10px;
          background: white;
          font-weight: 700;
          white-space: nowrap;
          transform: translate(-50%, -50%);
        }


        /* Arrows overlay */

        .overlay.arrow {
          height: 4px;
          transform-origin: left center;
        }

        .overlay.arrow span {
          position: absolute;
          right: -2px;
          top: 50%;
          transform: translateY(-50%);
          width: 0;
          height: 0;
          border-top: 7px solid transparent;
          border-bottom: 7px solid transparent;
          border-left: 12px solid;
        }


        /* Rectangle overlay */

        .overlay.rectangle {
        border: 3px solid;
        background: rgba(0,165,134,.12);
        transform: translate(-50%, -50%);
        }


        /* Measurement overlay */
        .mss-checkbox-field {
          display: flex;
          align-items: center;
          gap: 9px;
          margin-bottom: 16px;
          color: var(--mss-text-secondary);
          cursor: pointer;
        }

        .mss-checkbox-field input {
          width: 17px;
          height: 17px;
          accent-color: var(--mss-primary);
        }

         .overlay.measurement-value {
          border: 2px solid;
          border-radius: 10px;
          background: rgba(15, 23, 36, .92);
          color: white;
          padding: 8px 12px;
          transform: translate(-50%, -50%);
          min-width: 120px;
        }

        .overlay.measurement-value span {
          display: block;
          font-size: 11px;
          color: var(--mss-text-secondary);
        }

        .overlay.measurement-value strong {
          display: block;
          margin-top: 3px;
          color: var(--mss-primary);
        }

        .overlay.callout {
          border: 2px solid var(--mss-primary);
          border-radius: 10px;
          background: rgba(15, 23, 36, .92);
          color: var(--mss-text);

          padding: 10px 12px;
          min-width: 170px;

          transform: translate(-50%, -50%);

          font-family: "Segoe UI", Inter, Arial, sans-serif;
          line-height: 1.2;
        }

        .callout-title {
            font-family: inherit;
            font-size: 15px;
            font-weight: 700;
            line-height: 1.2;

            margin-bottom: 8px;
            padding-bottom: 6px;

            border-bottom: 1px solid rgba(255,255,255,.14);
          }


        .callout-row {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          margin-top: 6px;
        }

        .callout-row span {
          color: var(--mss-text-secondary);
        }

        .callout-row.status-row {
          justify-content: space-between;
          gap: 12px;
            align-items: center;
          }


        .mss-tabs {
          display: flex;
          gap: 8px;
          margin-bottom: 20px;
        }

        .mss-tab {
          background: var(--mss-surface-soft);
          color: var(--mss-text-secondary);
          border: 1px solid var(--mss-border);
          border-radius: 8px;
          padding: 9px 16px;
          cursor: pointer;
          font-weight: 700;
        }

        .mss-tab.active {
          background: var(--mss-primary);
          color: white;
          border-color: var(--mss-primary);
        }

        .mss-inspection {
        display: flex;
        flex-direction: column;
        gap: 18px;
      }

      .mss-inspection-canvas {
        position: relative;
        min-height: 68vh;
        background: #ffffff;
        border-radius: var(--mss-radius-md);
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .mss-inspection-canvas .mss-view-image {
        max-width: 100%;
        max-height: 68vh;
        object-fit: contain;
      }

      .mss-inspection-footer {
        background: var(--mss-surface-soft);
        border: 1px solid var(--mss-border);
        border-radius: var(--mss-radius-md);
        padding: 16px;
      }

      .mss-inspection-nav {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        margin-bottom: 14px;
      }

      .mss-inspection-details {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 16px;
      }

      /* Removes the minimum panel height when the Viewer is used inside a dashboard card. */
      .mss-inspection-compact .mss-inspection-canvas {
        min-height: 0;
        height: 100%;
      }

      /* Allows the compact Viewer to fill the dashboard card container. */
      .mss-inspection-compact {
        width: 100%;
        height: 100%;
        min-height: 220px;
      }

      /* Lets the compact image stage scale within the card's available space. */
      .mss-inspection-compact .mss-image-stage {
        max-width: 100%;
        max-height: 100%;
      }

      /* Prevents the compact Viewer image from using the full panel viewport height. */
      .mss-inspection-compact .mss-stage-image {
        max-height: 100%;
      }

      .status-pill {
        border-radius: 999px;
        padding: .35em .8em;
        font-weight: 900;
        line-height: 1;
      }

      .status-pill.ok {
        background: rgba(84,211,138,.16);
        color: var(--mss-success);
        border: 1px solid var(--mss-success);
      }

     .status-pill.nok {
        background: rgba(255,107,107,.16);
        color: var(--mss-error);
        border: 1px solid var(--mss-error);
      }

      /* Editor layout */

      .mss-editor {
        display: grid;
        grid-template-columns: 320px minmax(0, 1fr);
        gap: 20px;
        align-items: start;
      }

      .mss-editor-side {
        background: var(--mss-surface-soft);
        border: 1px solid var(--mss-border);
        border-radius: var(--mss-radius-md);
        padding: 18px;

        height: 72vh;
        overflow-y:auto;
        overflow-x:hidden;
        box-sizing: border-box;
      }

      .mss-editor-toolbar {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 20px;
      }

      .mss-overlay-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .overlay-item {
        padding: 10px 12px;
        cursor: pointer;
        border-radius: 8px;
        border-left: 4px solid transparent;
        transition: background .15s ease, border-color .15s ease;
      }

      .overlay-item:hover {
        background: rgba(0,165,134,.10);
      }

      .overlay-item.selected {
        background: rgba(0,165,134,.18);
        border-left-color: var(--mss-primary);
      }

      .mss-editor-properties {
        margin-top: 24px;
        padding-top: 18px;
        border-top: 1px solid var(--mss-border);
      }

      .mss-editor-property {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 8px 0;
      }

      .mss-editor-property span {
        color: var(--mss-text-secondary);
      }

      .mss-editor-properties details {
        margin-top: 14px;
        padding-top: 12px;
        border-top: 1px solid var(--mss-border);
      }

      .mss-editor-properties summary {
        cursor: pointer;
        color: var(--mss-primary);
        font-weight: 700;
      }

      .mss-editor-canvas {
            height: 72vh;
            min-height: 72vh;

            background: #ffffff;

            border-radius: var(--mss-radius-md);

            display: flex;
            justify-content: center;
            align-items: center;

            overflow: hidden;

            padding: 0;

            box-sizing: border-box;

            position: sticky;
            top: 16px;
        }

      /* Coordinate system for overlays. */
      .mss-image-stage {
          position: relative;

          display: inline-block;

          line-height: 0;

          width: fit-content;
          height: fit-content;

          max-width: 100%;
          max-height: 100%;
      }

      /* Shared image styling for Viewer and Editor. */
        .mss-stage-image {
            display: block;

            width: auto;
            height: auto;

            max-width: 100%;
            max-height: 72vh;

            object-fit: contain;
        }

      .mss-editor-image-stage .overlay.callout {
        pointer-events: auto;
        cursor: pointer;
      }

      .overlay.callout.selected {
        box-shadow:
          0 0 0 3px rgba(0,165,134,.45),
          0 10px 26px rgba(0,0,0,.35);
      }

      .overlay.editor-callout.selected{
            cursor:move;
            opacity:.92;
      }

     .editor-callout {
            pointer-events: auto;
            cursor: grab;
            touch-action: none;
            user-select: none;

            transition:
                box-shadow .15s,
                transform .15s;
        }
        .editor-callout.dragging {
            cursor: grabbing;

            transform: translate(-50%, -50%) scale(1.05);

            transition: none;

            z-index: 30;

            opacity: .94;

            box-shadow:
                0 0 0 3px rgba(0,165,134,.40),
                0 12px 28px rgba(0,0,0,.36);
        }

      .editor-callout.selected {
          box-shadow:
            0 0 0 3px rgba(0,165,134,.35),
            0 8px 20px rgba(0,0,0,.28);
      }

      .editor-callout-title {
        font-size: 13px;
        font-weight: 800;
        line-height: 1.2;
        padding-bottom: 5px;
        margin-bottom: 5px;
        border-bottom: 1px solid rgba(255,255,255,.15);
      }

      .editor-callout-elements {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .editor-callout-element {
          color: var(--mss-text-secondary);
          font-family: inherit;
          font-weight: 600;
          line-height: 1.2;
          white-space: nowrap;
        }

      .editor-point {
          pointer-events: auto;
          cursor: grab;
          touch-action: none;
          user-select: none;
        }

        .editor-point.dragging {
          cursor: grabbing;
          z-index: 31;
          transform: translate(-50%, -50%) scale(1.35);
        }

      .editor-point.selected {
          box-shadow:
            0 0 0 4px rgba(0,165,134,.30),
            0 0 0 7px rgba(0,165,134,.12);
      }

      .editor-callout,
      .overlay.callout {
        font-family: "Segoe UI", Inter, Arial, sans-serif;
      }

      .editor-callout-element,
      .callout-row {
        font-weight: 600;
        line-height: 1.2;
      }

      .mss-save-state {
        margin-bottom: 16px;
        font-size: 12px;
        font-weight: 700;
      }

      .mss-save-state.dirty {
        color: var(--mss-warning);
      }

      .mss-save-state.saved {
        color: var(--mss-success);
      }

      .mss-button:disabled {
        opacity: .45;
        cursor: not-allowed;
      }
      .mss-field {
        display: flex;
        flex-direction: column;
        gap: 7px;
        margin-bottom: 16px;
      }

      .mss-field > span {
        color: var(--mss-text-secondary);
        font-size: 13px;
        font-weight: 700;
      }

      .mss-element-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin: 12px 0;
      }

     .mss-element-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          border: 1px solid var(--mss-border);
          border-radius: 8px;
          padding: 9px 10px;

          cursor: pointer;
          transition: .15s;
      }

      .mss-element-item.selected{
          border-color: var(--mss-primary);
          background: rgba(0,165,134,.12);
      }

      .mss-element-properties{
          margin-top:20px;
          padding-top:18px;
          border-top:1px solid var(--mss-border);
      }
      .mss-element-item div {
        min-width: 0;
      }

      .mss-element-item strong,
      .mss-element-item span {
        display: block;
      }

      .mss-element-item div > span {
        color: var(--mss-text-muted);
        font-size: 11px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .mss-element-actions {
          margin-top: 18px;
        }


        .mss-overlay-actions {
          margin-top: 20px;
          padding-top: 18px;
          border-top: 1px solid var(--mss-border);
        }
        .mss-button.danger {
          background: #b42318;
          color: white;
        }

        .mss-button.danger:hover {
          background: #912018;
        }

        /* Makes destructive editor-sidebar actions fill the available sidebar width. */
      .mss-element-actions .mss-button.danger,
      .mss-overlay-actions .mss-button.danger {
        width: 100%;
      }

      .mss-add-element-row {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 8px;
        margin-top: 12px;
        margin-bottom: 18px;
      }

      .full-width {
        width: 100%;
      }

      .mss-advanced {
        margin-top: 18px;
      }

      .mss-view-toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        margin-bottom: 20px;
      }

      .mss-view-toolbar .mss-tabs {
        margin-bottom: 0;
      }

      .mss-view-selector {
        width: auto;
        min-width: 180px;
      }

      /* Responsive behavior */
      @media (max-width: 900px) {
        .mss-app {
          flex-direction: column;
        }

        .mss-sidebar {
          width: 100%;
          flex-basis: auto;
          border-right: 0;
          border-bottom: 1px solid var(--mss-border);
        }

        .mss-sidebar.collapsed {
          width: 100%;
          flex-basis: auto;
        }

        .mss-filters {
          grid-template-columns: 1fr;
        }

        .mss-topbar {
          align-items: flex-start;
          flex-direction: column;
        }
      }

      @media (max-width: 1000px) {
        .mss-editor {
          grid-template-columns: 1fr;
        }

        .mss-editor-side {
          order: 2;
        }

        .mss-editor-canvas {
          order: 1;
          min-height: 55vh;
        }
      }

      </style>


    `;
}
