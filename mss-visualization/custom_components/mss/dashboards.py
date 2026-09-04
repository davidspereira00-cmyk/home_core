"""Create the default MSS dashboards."""

import logging
from typing import Any

from homeassistant.components import frontend
from homeassistant.components.lovelace import dashboard as lovelace_dashboard
from homeassistant.components.lovelace.const import (
    CONF_ALLOW_SINGLE_WORD,
    CONF_ICON,
    CONF_REQUIRE_ADMIN,
    CONF_SHOW_IN_SIDEBAR,
    CONF_TITLE,
    CONF_URL_PATH,
    LOVELACE_DATA,
    MODE_STORAGE,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.setup import async_setup_component

_LOGGER = logging.getLogger(__name__)

STORAGE_VERSION = 1
STORAGE_KEY = "mss.dashboard_setup"

MSS_DASHBOARDS: tuple[dict[str, Any], ...] = (
    {
        "url_path": "mss-viewer",
        "title": "MSS Viewer",
        "icon": "mdi:monitor-dashboard",
        "config": {
            "views": [
                {
                    "type": "sections",
                    "sections": [
                        {
                            "type": "grid",
                            "column_span": 3,
                            "cards": [
                                {
                                    "type": "custom:mss-view-card",
                                    "grid_options": {
                                        "columns": 22,
                                        "rows": 10,
                                    },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    },
    {
        "url_path": "mss-measurements",
        "title": "MSS Measurements",
        "icon": "mdi:table",
        "config": {
            "views": [
                {
                    "type": "sections",
                    "sections": [
                        {
                            "type": "grid",
                            "column_span": 3,
                            "cards": [
                                {
                                    "type": "custom:mss-measurements-card",
                                    "grid_options": {
                                        "columns": 22,
                                        "rows": 10,
                                    },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    },
)


async def async_ensure_mss_dashboards(hass: HomeAssistant) -> None:
    """Create the default MSS dashboards when they do not already exist."""

    store = Store[dict[str, bool]](
        hass,
        STORAGE_VERSION,
        STORAGE_KEY,
    )

    stored = await store.async_load()

    if stored and stored.get("seeded"):
        return

    # Make sure Lovelace has completed its backend setup.
    if not await async_setup_component(hass, "lovelace", {}):
        _LOGGER.warning("Could not set up Lovelace for MSS dashboards")
        return

    lovelace_data = hass.data.get(LOVELACE_DATA)

    if lovelace_data is None:
        _LOGGER.warning("Lovelace data is not available")
        return

    dashboards_collection = lovelace_dashboard.DashboardsCollection(hass)

    await dashboards_collection.async_load()

    existing_paths = {
        item.get(CONF_URL_PATH) for item in dashboards_collection.async_items()
    }

    for definition in MSS_DASHBOARDS:
        url_path = definition["url_path"]

        if url_path in existing_paths:
            continue

        item = await dashboards_collection.async_create_item(
            {
                CONF_ALLOW_SINGLE_WORD: True,
                CONF_URL_PATH: url_path,
                CONF_TITLE: definition["title"],
                CONF_ICON: definition["icon"],
                CONF_SHOW_IN_SIDEBAR: True,
                CONF_REQUIRE_ADMIN: False,
            }
        )

        # Create the actual Lovelace dashboard configuration.
        dashboard = lovelace_dashboard.LovelaceStorage(
            hass,
            item,
        )

        await dashboard.async_save(definition["config"])

        # Make it immediately available during this HA session.
        lovelace_data.dashboards[url_path] = dashboard

        frontend.async_register_built_in_panel(
            hass,
            "lovelace",
            frontend_url_path=url_path,
            require_admin=False,
            show_in_sidebar=True,
            sidebar_title=definition["title"],
            sidebar_icon=definition["icon"],
            config={
                "mode": MODE_STORAGE,
            },
        )

        existing_paths.add(url_path)

        _LOGGER.info(
            "Created default MSS dashboard: %s",
            definition["title"],
        )
