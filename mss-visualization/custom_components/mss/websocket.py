"""WebSocket commands for the MSS visualization integration."""

import base64
import binascii
import hashlib
from pathlib import Path
from uuid import uuid4

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .sensor import DATA_MANAGER, DOMAIN, create_entity_manager_key

# ============================================================
# STORAGE
# ============================================================

STORAGE_VERSION = 1
STORAGE_KEY = "mss.views"

# Persistent folder:
# /config/www/mss-view-backgrounds/
BACKGROUND_FOLDER = "www/mss-view-backgrounds"

ALLOWED_BACKGROUND_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
}

MAX_BACKGROUND_SIZE = 10 * 1024 * 1024  # 10 MB


# Persistent folder:
# /config/www/mss-view-images/
IMAGE_FOLDER = "www/mss-view-images"

ALLOWED_IMAGE_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
}

MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10 MB


# ============================================================
# STORAGE HELPERS
# ============================================================


def get_store(
    hass: HomeAssistant,
) -> Store:
    """Return the MSS view storage instance."""

    return Store(
        hass,
        STORAGE_VERSION,
        STORAGE_KEY,
    )


def ensure_background_directory(
    path: Path,
) -> None:
    """Ensure the MSS background directory exists."""

    path.mkdir(
        parents=True,
        exist_ok=True,
    )


def write_background(
    path: Path,
    data: bytes,
) -> None:
    """Write an MSS background image to disk."""

    path.write_bytes(data)


def ensure_image_directory(
    path: Path,
) -> None:
    """Ensure the MSS image directory exists."""

    path.mkdir(
        parents=True,
        exist_ok=True,
    )


def write_image(
    path: Path,
    data: bytes,
) -> None:
    """Write an MSS image to disk."""

    path.write_bytes(data)


# ============================================================
# GET VIEWS
# ============================================================


@websocket_api.websocket_command(
    {
        vol.Required("type"): "mss/views/get",
    }
)
@websocket_api.async_response
async def websocket_get_views(
    hass: HomeAssistant,
    connection,
    msg: dict,
) -> None:
    """Return the saved MSS views."""

    store = get_store(hass)

    data = await store.async_load()

    connection.send_result(
        msg["id"],
        {
            "views": data.get("views", []) if data else [],
        },
    )


# ============================================================
# SAVE VIEWS
# ============================================================


@websocket_api.websocket_command(
    {
        vol.Required("type"): "mss/views/save",
        vol.Required("views"): list,
    }
)
@websocket_api.async_response
async def websocket_save_views(
    hass: HomeAssistant,
    connection,
    msg: dict,
) -> None:
    """Save MSS views."""

    store = get_store(hass)

    await store.async_save(
        {
            "views": msg["views"],
        }
    )

    connection.send_result(
        msg["id"],
        {
            "success": True,
        },
    )


# ============================================================
# UPLOAD PERSISTENT VIEW BACKGROUND
# ============================================================


@websocket_api.websocket_command(
    {
        vol.Required("type"): "mss/views/upload_background",
        vol.Required("filename"): str,
        vol.Required("data"): str,
    }
)
@websocket_api.async_response
async def websocket_upload_background(
    hass: HomeAssistant,
    connection,
    msg: dict,
) -> None:
    """Upload a persistent MSS view background."""

    original_filename = msg["filename"]
    encoded_data = msg["data"]

    # ========================================================
    # VALIDATE EXTENSION
    # ========================================================

    extension = Path(original_filename).suffix.lower()

    if extension not in ALLOWED_BACKGROUND_EXTENSIONS:
        connection.send_error(
            msg["id"],
            "invalid_file_type",
            "Unsupported image type. Allowed: JPG, JPEG, PNG and WEBP.",
        )
        return

    # ========================================================
    # DECODE BASE64
    # ========================================================

    try:
        background_bytes = base64.b64decode(
            encoded_data,
            validate=True,
        )

    except (
        ValueError,
        binascii.Error,
    ):
        connection.send_error(
            msg["id"],
            "invalid_image_data",
            "Invalid background image data.",
        )
        return

    # ========================================================
    # VALIDATE SIZE
    # ========================================================

    if not background_bytes:
        connection.send_error(
            msg["id"],
            "empty_file",
            "Background image is empty.",
        )
        return

    if len(background_bytes) > MAX_BACKGROUND_SIZE:
        connection.send_error(
            msg["id"],
            "file_too_large",
            "Background image exceeds the 10 MB limit.",
        )
        return

    # ========================================================
    # CREATE PERSISTENT DIRECTORY
    # ========================================================

    background_directory = Path(hass.config.path(BACKGROUND_FOLDER))

    try:
        await hass.async_add_executor_job(
            ensure_background_directory,
            background_directory,
        )

    except OSError:
        connection.send_error(
            msg["id"],
            "directory_error",
            "Could not create the MSS background directory.",
        )
        return

    # ========================================================
    # GENERATE UNIQUE FILENAME
    # ========================================================

    stored_filename = f"{uuid4().hex}{extension}"

    background_path = background_directory / stored_filename

    # ========================================================
    # WRITE IMAGE
    # ========================================================

    try:
        await hass.async_add_executor_job(
            write_background,
            background_path,
            background_bytes,
        )

    except OSError:
        connection.send_error(
            msg["id"],
            "write_error",
            "Could not save the MSS background image.",
        )
        return

    # ========================================================
    # PERMANENT HOME ASSISTANT URL
    # ========================================================

    background_url = f"/local/mss-view-backgrounds/{stored_filename}"

    # ========================================================
    # RETURN RESULT
    # ========================================================

    connection.send_result(
        msg["id"],
        {
            "success": True,
            "url": background_url,
            "filename": stored_filename,
        },
    )


# ============================================================
# UPLOAD PERSISTENT LOCAL IMAGE SHAPE
# ============================================================


@websocket_api.websocket_command(
    {
        vol.Required("type"): "mss/images/upload_local",
        vol.Required("filename"): str,
        vol.Required("data"): str,
    }
)
@websocket_api.async_response
async def websocket_upload_local_image(
    hass: HomeAssistant,
    connection,
    msg: dict,
) -> None:
    """Upload a persistent local MSS image."""

    original_filename = msg["filename"]

    encoded_data = msg["data"]

    # ========================================================
    # VALIDATE EXTENSION
    # ========================================================

    extension = Path(original_filename).suffix.lower()

    if extension not in ALLOWED_IMAGE_EXTENSIONS:
        connection.send_error(
            msg["id"],
            "invalid_file_type",
            "Unsupported image type. Allowed: JPG, JPEG, PNG and WEBP.",
        )

        return

    # ========================================================
    # DECODE BASE64
    # ========================================================

    try:
        image_bytes = base64.b64decode(
            encoded_data,
            validate=True,
        )

    except (
        ValueError,
        binascii.Error,
    ):
        connection.send_error(
            msg["id"],
            "invalid_image_data",
            "Invalid image data.",
        )

        return

    # ========================================================
    # VALIDATE SIZE
    # ========================================================

    if not image_bytes:
        connection.send_error(
            msg["id"],
            "empty_file",
            "Image is empty.",
        )

        return

    if len(image_bytes) > MAX_IMAGE_SIZE:
        connection.send_error(
            msg["id"],
            "file_too_large",
            "Image exceeds the 10 MB limit.",
        )

        return

    # ========================================================
    # CREATE PERSISTENT DIRECTORY
    # ========================================================

    image_directory = Path(hass.config.path(IMAGE_FOLDER))

    try:
        await hass.async_add_executor_job(
            ensure_image_directory,
            image_directory,
        )

    except OSError:
        connection.send_error(
            msg["id"],
            "directory_error",
            "Could not create the MSS image directory.",
        )

        return

    # ========================================================
    # GENERATE UNIQUE FILENAME
    # ========================================================

    content_hash = hashlib.sha256(image_bytes).hexdigest()

    stored_filename = f"{content_hash}{extension}"

    image_path = image_directory / stored_filename

    # ========================================================
    # WRITE IMAGE
    # ========================================================

    if not image_path.exists():
        try:
            await hass.async_add_executor_job(
                write_image,
                image_path,
                image_bytes,
            )

        except OSError:
            connection.send_error(
                msg["id"],
                "write_error",
                "Could not save the MSS image.",
            )
            return

    # ========================================================
    # PERMANENT HOME ASSISTANT URL
    # ========================================================

    image_url = f"/local/mss-view-images/{stored_filename}"

    # ========================================================
    # RETURN RESULT
    # ========================================================

    connection.send_result(
        msg["id"],
        {
            "success": True,
            "url": image_url,
            "filename": stored_filename,
        },
    )


# ============================================================
# GET LIVE MSS IMAGE
# ============================================================


@websocket_api.websocket_command(
    {
        vol.Required("type"): "mss/images/get",
        vol.Required("group"): str,
        vol.Required("path"): str,
    }
)
@websocket_api.async_response
async def websocket_get_mss_image(
    hass: HomeAssistant,
    connection,
    msg: dict,
) -> None:
    """Return a live MSS image."""

    group = msg["group"]
    path = msg["path"]

    # ========================================================
    # GET MSS ENTITY MANAGER
    # ========================================================

    manager = hass.data.get(
        DOMAIN,
        {},
    ).get(DATA_MANAGER)

    if manager is None:
        connection.send_error(
            msg["id"],
            "manager_unavailable",
            "MSS entity manager is not available.",
        )
        return

    # ========================================================
    # FIND IMAGE
    # ========================================================

    key = create_entity_manager_key(
        group=group,
        path=path,
    )

    image = manager.images.get(key)

    if image is None:
        connection.send_error(
            msg["id"],
            "image_not_found",
            "No live MSS image is available for this field.",
        )
        return

    # ========================================================
    # RETURN IMAGE
    # ========================================================

    connection.send_result(
        msg["id"],
        {
            "mimetype": image["mimetype"],
            "data": image["data"],
        },
    )


# ============================================================
# LIST LIVE MSS IMAGES
# ============================================================


# ============================================================
# LIST KNOWN MSS IMAGE FIELDS
# ============================================================


@websocket_api.websocket_command(
    {
        vol.Required("type"): "mss/images/list",
    }
)
@websocket_api.async_response
async def websocket_list_mss_images(
    hass: HomeAssistant,
    connection,
    msg: dict,
) -> None:
    """List known MSS image fields."""

    manager = hass.data.get(
        DOMAIN,
        {},
    ).get(DATA_MANAGER)

    if manager is None:
        connection.send_error(
            msg["id"],
            "manager_unavailable",
            "MSS entity manager is not available.",
        )
        return

    images = []

    for key, definition in manager.image_schema.items():
        live_image = manager.images.get(key)

        images.append(
            {
                "group": definition["group"],
                "path": definition["path"],
                "mimetype": definition.get(
                    "mimetype",
                    "image/png",
                ),
                "control_plan": definition.get("control_plan"),
                "generic": bool(
                    definition.get(
                        "generic",
                        False,
                    )
                ),
                "type": "image",
                "available": live_image is not None,
                "message_id": (live_image.get("message_id") if live_image else None),
                "updated": (live_image.get("updated", 0) if live_image else 0),
            }
        )

    images.sort(
        key=lambda item: (
            item["group"],
            item["path"],
        )
    )

    connection.send_result(
        msg["id"],
        {
            "images": images,
        },
    )


# ============================================================
# REGISTER WEBSOCKET COMMANDS
# ============================================================


def async_register_websocket_commands(
    hass: HomeAssistant,
) -> None:
    """Register MSS WebSocket commands."""

    websocket_api.async_register_command(
        hass,
        websocket_get_views,
    )

    websocket_api.async_register_command(
        hass,
        websocket_save_views,
    )

    websocket_api.async_register_command(
        hass,
        websocket_upload_background,
    )

    websocket_api.async_register_command(
        hass,
        websocket_upload_local_image,
    )

    websocket_api.async_register_command(
        hass,
        websocket_get_mss_image,
    )

    websocket_api.async_register_command(
        hass,
        websocket_list_mss_images,
    )
