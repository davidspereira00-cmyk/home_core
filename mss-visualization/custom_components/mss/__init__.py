"""MSS visualization integration."""

import json
import logging

from homeassistant.components import mqtt
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, callback

from .websocket import async_register_websocket_commands

DOMAIN = "mss"
DATA_MANAGER = "entity_manager"

PLATFORMS: list[Platform] = [
    Platform.SENSOR,
]

_LOGGER = logging.getLogger(__name__)


# ============================================================
# BASE INTEGRATION SETUP
# ============================================================


async def async_setup(
    hass: HomeAssistant,
    config: dict,
) -> bool:
    """Set up the MSS Visualization integration."""

    hass.data.setdefault(
        DOMAIN,
        {},
    )

    # Register MSS websocket commands used by the frontend.
    async_register_websocket_commands(hass)

    return True


# ============================================================
# CONFIG ENTRY SETUP
# ============================================================


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
) -> bool:
    """Set up MSS Visualization from a config entry."""

    hass.data.setdefault(
        DOMAIN,
        {},
    )

    # --------------------------------------------------------
    # LOAD SENSOR PLATFORM
    # --------------------------------------------------------
    #
    # This calls:
    #
    # sensor.async_setup_entry(...)
    #
    # The sensor platform creates MSSDynamicEntityManager
    # and stores it in hass.data[DOMAIN][DATA_MANAGER].
    # --------------------------------------------------------

    await hass.config_entries.async_forward_entry_setups(
        entry,
        PLATFORMS,
    )

    manager = hass.data.get(
        DOMAIN,
        {},
    ).get(DATA_MANAGER)

    if manager is None:
        _LOGGER.error("MSS sensor platform loaded but entity manager was not created")

        return False

    # --------------------------------------------------------
    # MQTT MESSAGE CALLBACK
    # --------------------------------------------------------

    @callback
    def handle_mss_report(
        message,
    ) -> None:
        """Handle one complete MSSReport MQTT message."""

        try:
            payload = json.loads(message.payload)

        except (
            json.JSONDecodeError,
            TypeError,
        ):
            _LOGGER.warning("Received invalid MSSReport JSON")

            return

        manager = hass.data.get(
            DOMAIN,
            {},
        ).get(DATA_MANAGER)

        if manager is None:
            _LOGGER.warning(
                "Received MSSReport but MSS entity manager is not available"
            )

            return

        # One call = one complete MQTT report.
        manager.process_report(payload)

    # --------------------------------------------------------
    # MQTT SUBSCRIPTION
    # --------------------------------------------------------

    unsubscribe = await mqtt.async_subscribe(
        hass,
        "MSSReport",
        handle_mss_report,
        qos=0,
    )

    # Home Assistant automatically calls this when the
    # config entry is unloaded.
    entry.async_on_unload(unsubscribe)

    _LOGGER.info("MSS Visualization subscribed to MQTT topic MSSReport")

    return True


# ============================================================
# CONFIG ENTRY UNLOAD
# ============================================================


async def async_unload_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
) -> bool:
    """Unload MSS Visualization."""

    unload_ok = await hass.config_entries.async_unload_platforms(
        entry,
        PLATFORMS,
    )

    if unload_ok:
        hass.data.get(
            DOMAIN,
            {},
        ).pop(
            DATA_MANAGER,
            None,
        )

    return unload_ok
