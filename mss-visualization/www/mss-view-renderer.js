export const viewRenderMethods = {
  // Renders a View for either the full MSS panel or a compact dashboard card.
  renderViewViewer(view, options = {}) {
    const {
      compact = false,
      showNavigation = !compact,
      showDetails = !compact,
    } = options;

    const measurement = this.selectedViewMeasurement ?? null;

    const measurementCount = this.viewMeasurements?.length ?? 0;

    const measurementNumber =
      measurementCount > 0 ? (this.selectedViewMeasurementIndex ?? 0) + 1 : 0;

    return `
        <div class="
        mss-inspection
        ${compact ? 'mss-inspection-compact' : ''}
        ">

        <div class="mss-inspection-canvas">
            <div
                class="mss-image-stage"
                style="
                    transform: scale(${
                      compact ? 1 : Number(view.viewerScale) || 1
                    });
                    transform-origin: center center;
                ">

            <img
                src="${view.imageUrl ?? '/local/views/body.jpg'}"
                class="mss-stage-image">

            ${(view.overlays ?? [])
              .map((overlay) => this.renderOverlay(overlay, false))
              .join('')}

            ${(view.shapes ?? []).map((shape) => this.renderShape(shape, false)).join('')}

            </div>
        </div>

        ${
          showNavigation || showDetails
            ? `
                <div class="mss-inspection-footer">

                ${
                  showNavigation
                    ? `
                        <div class="mss-inspection-nav">
                        <button
                            class="mss-button secondary"
                            id="viewPrev">
                            ◀ Previous
                        </button>

                        <span class="mss-muted">
                            Measurement
                            ${measurementNumber}
                            /
                            ${measurementCount}
                        </span>

                        <button
                            class="mss-button secondary"
                            id="viewNext">
                            Next ▶
                        </button>
                        </div>
                    `
                    : ''
                }

                ${
                  showDetails
                    ? `
                        <div class="mss-inspection-details">
                        ${this.infoRow(
                          'Product ID',
                          measurement?.productId ?? 'Unavailable'
                        )}

                        ${this.infoRow(
                          'Station ID',
                          measurement?.stationId ?? 'Unavailable'
                        )}

                        ${this.infoRow(
                          'Control Plan',
                          measurement?.controlPlan ?? 'Unavailable'
                        )}

                        ${this.infoRow(
                          'Timestamp',
                          measurement?.timestamp ?? 'Unavailable'
                        )}
                        </div>
                    `
                    : ''
                }

                </div>
            `
            : ''
        }

        </div>
    `;
  },
};
