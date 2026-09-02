"""Config flow for the MSS visualization integration."""

from typing import Any

from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResult

DOMAIN = "mss"


class MSSConfigFlow(
    config_entries.ConfigFlow,
    domain=DOMAIN,
):
    """Handle the MSS Visualization config flow."""

    VERSION = 1

    async def async_step_user(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> FlowResult:
        """Handle setup initiated by the user."""

        # Only allow one MSS Visualization config entry.
        await self.async_set_unique_id("mss_visualization")

        self._abort_if_unique_id_configured()

        if user_input is not None:
            return self.async_create_entry(
                title="MSS Visualization",
                data={},
            )

        return self.async_show_form(
            step_id="user",
            data_schema=None,
        )
