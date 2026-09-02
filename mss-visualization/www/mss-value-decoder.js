import { wildcardToRegex } from './mss-field-resolver.js';

export function decodeMssValue(value) {
  if (
    value &&
    typeof value === 'object' &&
    value.image &&
    typeof value.image === 'object' &&
    typeof value.image.mimetype === 'string' &&
    typeof value.image.data === 'string'
  ) {
    return {
      type: 'image',
      mimeType: value.image.mimetype,
      data: value.image.data,
      src: `data:${value.image.mimetype};base64,${value.image.data}`,
    };
  }

  if (typeof value === 'number') {
    return {
      type: 'number',
      value,
    };
  }

  if (typeof value === 'boolean') {
    return {
      type: 'boolean',
      value,
    };
  }

  return {
    type: 'text',
    value: value == null ? '' : String(value),
  };
}

export async function loadMssImage(hass, { group, path }) {
  if (!hass?.connection || !group || !path) {
    return null;
  }

  try {
    const result = await hass.connection.sendMessagePromise({
      type: 'mss/images/get',
      group,
      path,
    });

    if (!result?.mimetype || !result?.data) {
      return null;
    }

    return {
      type: 'image',
      mimetype: result.mimetype,
      data: result.data,
      url: `data:${result.mimetype};base64,${result.data}`,
    };
  } catch (error) {
    if (error?.code !== 'image_not_found') {
      console.error('Could not load MSS image.', error);
    }

    return null;
  }
}

export async function hydrateMssViewImages(hass, view) {
  if (!view || !hass?.connection) {
    return;
  }

  // ==========================================================
  // VIEW BACKGROUND — HA MEDIA LIBRARY
  // ==========================================================

  if (view.backgroundMediaContentId) {
    try {
      const resolved = await hass.connection.sendMessagePromise({
        type: 'media_source/resolve_media',

        media_content_id: view.backgroundMediaContentId,
      });

      view.imageUrl = resolved?.url ?? '';
    } catch (error) {
      console.error(
        'Could not resolve Home Assistant background image.',
        error
      );

      view.imageUrl = '';
    }
  }

  const images = (view.shapes ?? []).filter((shape) => shape.type === 'image');

  await Promise.all(
    images.map(async (shape) => {
      // ========================================================
      // MQTT IMAGE
      // ========================================================

      if (shape.imageSource === 'mqtt') {
        const binding = await resolveMssImageBinding(hass, shape);

        if (!binding) {
          shape.liveImageUrl = '';

          return;
        }

        const result = await loadMssImage(hass, binding);

        shape.liveImageUrl = result?.url ?? '';

        return;
      }

      // ========================================================
      // LOCAL MEDIA LIBRARY IMAGE
      // ========================================================

      if (shape.imageSource === 'local' && shape.mediaContentId) {
        /*
         * Media Library URLs contain an authentication
         * signature and must therefore be resolved again
         * whenever the View is loaded.
         */

        try {
          const resolved = await hass.connection.sendMessagePromise({
            type: 'media_source/resolve_media',

            media_content_id: shape.mediaContentId,
          });

          shape.imageUrl = resolved?.url ?? '';

          shape.liveImageUrl = '';
        } catch (error) {
          console.error('Could not resolve Home Assistant media image.', error);

          shape.imageUrl = '';
          shape.liveImageUrl = '';
        }

        return;
      }

      // ========================================================
      // NORMAL LOCAL UPLOAD
      // ========================================================
      //
      // Existing MSS-uploaded local images already have a
      // permanent imageUrl, so nothing needs to be hydrated.
      // ========================================================

      if (shape.imageSource === 'local') {
        shape.liveImageUrl = '';
      }
    })
  );
}

export async function listMssImages(hass) {
  if (!hass?.connection) {
    return [];
  }

  try {
    const result = await hass.connection.sendMessagePromise({
      type: 'mss/images/list',
    });

    return result?.images ?? [];
  } catch (error) {
    console.error('Could not list MSS image fields.', error);

    return [];
  }
}

export async function resolveMssImageBinding(hass, shape) {
  if (!shape || shape.type !== 'image' || shape.imageSource !== 'mqtt') {
    return null;
  }

  // ==========================================================
  // EXACT
  // ==========================================================

  if (shape.bindingMode !== 'dynamic') {
    if (!shape.mssGroup || !shape.dataPath) {
      return null;
    }

    return {
      group: shape.mssGroup,
      path: shape.dataPath,
    };
  }

  // ==========================================================
  // DYNAMIC
  // ==========================================================

  if (!shape.groupPattern || !shape.pathPattern) {
    return null;
  }

  const images = await listMssImages(hass);

  const groupRegex = wildcardToRegex(shape.groupPattern);

  const pathRegex = wildcardToRegex(shape.pathPattern);

  const matches = images.filter(
    (image) =>
      image.available !== false &&
      groupRegex.test(image.group) &&
      pathRegex.test(image.path)
  );

  // No current matching image.
  // ==========================================================
  // NO LIVE MATCH
  // ==========================================================

  if (matches.length === 0) {
    return null;
  }

  // ==========================================================
  // SELECT LATEST MATCHING IMAGE
  // ==========================================================
  //
  // Multiple MSS sources may match a dynamic binding.
  //
  // Example:
  //
  //   MSSReport_Test1
  //   MSSReport_Test2
  //
  // The image that was updated most recently wins.
  // ==========================================================

  matches.sort((a, b) => Number(b.updated ?? 0) - Number(a.updated ?? 0));

  const latest = matches[0] ?? null;

  if (!latest) {
    return null;
  }

  // ==========================================================
  // RESOLVED
  // ==========================================================

  return {
    group: latest.group,
    path: latest.path,
  };
}
