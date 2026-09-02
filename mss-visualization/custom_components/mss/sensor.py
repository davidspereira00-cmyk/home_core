"""Sensor platform for the MSS visualization integration."""

import logging
import math
import re
from time import time
from typing import Any
from uuid import uuid4

from homeassistant.components.sensor import SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.storage import Store

DOMAIN = "mss"
DATA_MANAGER = "entity_manager"

STORAGE_VERSION = 1
STORAGE_KEY = "mss.entity_schema"

_LOGGER = logging.getLogger(__name__)


# ============================================================
# SENSOR PLATFORM SETUP
# ============================================================


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up dynamically discovered MSS sensors."""

    manager = MSSDynamicEntityManager(
        hass,
        async_add_entities,
    )

    hass.data.setdefault(
        DOMAIN,
        {},
    )[DATA_MANAGER] = manager

    # Restore every MSS entity that has previously been
    # discovered.
    #
    # This happens BEFORE another MQTT report is required.
    #
    # Therefore after:
    #
    #   - HA restart
    #   - frontend reload
    #   - hard browser refresh
    #
    # the MSS source selector can immediately discover:
    #
    #   MSSReport
    #   MSSReport_Test1
    #   MSSReport_Test2
    #   ...
    #
    # together with all their known data fields.
    await manager.async_restore_schema()


# ============================================================
# DYNAMIC ENTITY MANAGER
# ============================================================


class MSSDynamicEntityManager:
    """Create, restore and update MSS entities dynamically."""

    def __init__(
        self,
        hass: HomeAssistant,
        async_add_entities: AddEntitiesCallback,
    ) -> None:
        """Initialize the MSS dynamic entity manager."""

        self.hass = hass

        self.async_add_entities = async_add_entities

        # ----------------------------------------------------
        # LIVE ENTITIES
        # ----------------------------------------------------
        #
        # Key examples:
        #
        # MSSReport::rootNode.Some.Path
        #
        # MSSReport_Test1::rootNode.Some_Test1.Path
        #
        # ----------------------------------------------------

        self.entities: dict[
            str,
            MSSDynamicSensor,
        ] = {}

        # ----------------------------------------------------
        # LIVE IMAGES
        # ----------------------------------------------------
        #
        # Image data is kept in memory instead of being placed
        # into Home Assistant sensor states.
        # ----------------------------------------------------

        self.images: dict[str, dict[str, str]] = {}

        # ----------------------------------------------------
        # PERSISTENT IMAGE SCHEMA
        # ----------------------------------------------------
        #
        # Stores image fields that have been discovered before.
        #
        # IMPORTANT:
        # This contains only structural metadata.
        # The Base64 image itself remains in self.images and is
        # never persisted here.
        # ----------------------------------------------------

        self.image_schema: dict[
            str,
            dict[str, Any],
        ] = {}

        # ----------------------------------------------------
        # PERSISTENT STRUCTURAL SCHEMA
        # ----------------------------------------------------
        #
        # Stores the structure of fields previously discovered.
        #
        # It deliberately does NOT store measurement values.
        #
        # This allows HA to reconstruct the MSS devices/entities
        # before another MQTT report arrives.
        # ----------------------------------------------------

        self.schema: dict[
            str,
            dict[str, Any],
        ] = {}

        self.store = Store[dict[str, Any]](
            hass,
            STORAGE_VERSION,
            STORAGE_KEY,
        )

    # ========================================================
    # STORE LIVE IMAGE
    # ========================================================

    def store_image(
        self,
        group: str,
        path: str,
        mimetype: str,
        data: str,
        control_plan: str | None = None,
        generic: bool = False,
        message_id: str | None = None,
    ) -> bool:
        """Store the latest live MSS image in memory.

        Returns True when the persistent image schema changed.
        """

        key = create_entity_manager_key(
            group=group,
            path=path,
        )

        # ========================================================
        # LIVE IMAGE VALUE
        # ========================================================

        self.images[key] = {
            "mimetype": mimetype,
            "data": data,
            "message_id": message_id,
            "updated": time(),
        }

        # ========================================================
        # PERSISTENT IMAGE STRUCTURE
        # ========================================================

        image_definition = {
            "group": group,
            "path": path,
            "mimetype": mimetype,
            "control_plan": control_plan,
            "generic": bool(generic),
        }

        schema_changed = self.image_schema.get(key) != image_definition

        if schema_changed:
            self.image_schema[key] = image_definition

        _LOGGER.info(
            ("Stored MSS image: group=%s path=%s mimetype=%s size=%d"),
            group,
            path,
            mimetype,
            len(data),
        )

        return schema_changed

    # ========================================================
    # RESTORE PREVIOUSLY DISCOVERED MSS SCHEMA
    # ========================================================

    async def async_restore_schema(
        self,
    ) -> None:
        """Restore previously discovered MSS entities.

        The entity structure is restored immediately.

        Historical/live state restoration is left to Home
        Assistant's normal entity/recorder lifecycle.

        A new MQTT message is therefore NOT required merely
        for MSS sources and Data Fields to exist.
        """

        stored = await self.store.async_load() or {}

        stored_entities = stored.get(
            "entities",
            [],
        )
        stored_images = stored.get(
            "images",
            [],
        )

        if not isinstance(
            stored_entities,
            list,
        ):
            stored_entities = []

        if not isinstance(
            stored_images,
            list,
        ):
            stored_images = []

        restored: list[MSSDynamicSensor] = []

        for definition in stored_entities:
            if not isinstance(
                definition,
                dict,
            ):
                continue

            path = definition.get("path")
            group = definition.get("group")

            if not path or not group:
                continue

            path = str(path)
            group = str(group)

            key = create_entity_manager_key(
                group=group,
                path=path,
            )

            if key in self.entities:
                continue

            entity_registry = er.async_get(self.hass)

            unique_id = create_grouped_unique_id(
                group=group,
                path=path,
            )

            registry_entry = entity_registry.async_get_entity_id(
                "sensor",
                DOMAIN,
                unique_id,
            )

            if registry_entry is None:
                continue

            normalized_definition = {
                "path": path,
                "group": group,
                "control_plan": definition.get("control_plan"),
                "generic": bool(
                    definition.get(
                        "generic",
                        False,
                    )
                ),
                "unit": definition.get("unit"),
                "numeric": bool(
                    definition.get(
                        "numeric",
                        False,
                    )
                ),
            }

            self.schema[key] = normalized_definition

            entity = MSSDynamicSensor(
                path=normalized_definition["path"],
                value=None,
                unit=normalized_definition["unit"],
                group=normalized_definition["group"],
                message_id=None,
                control_plan=normalized_definition["control_plan"],
                generic=normalized_definition["generic"],
                restored=True,
                numeric_hint=normalized_definition["numeric"],
            )

            self.entities[key] = entity

            restored.append(entity)

        if restored:
            self.async_add_entities(restored)

        # ========================================================
        # RESTORE PREVIOUSLY DISCOVERED IMAGE FIELDS
        # ========================================================

        for definition in stored_images:
            if not isinstance(
                definition,
                dict,
            ):
                continue

            path = definition.get("path")
            group = definition.get("group")

            if not path or not group:
                continue

            path = str(path)
            group = str(group)

            key = create_entity_manager_key(
                group=group,
                path=path,
            )

            self.image_schema[key] = {
                "path": path,
                "group": group,
                "mimetype": str(
                    definition.get(
                        "mimetype",
                        "image/png",
                    )
                ),
                "control_plan": definition.get("control_plan"),
                "generic": bool(
                    definition.get(
                        "generic",
                        False,
                    )
                ),
            }

    # ========================================================
    # SAVE DISCOVERED SCHEMA
    # ========================================================

    @callback
    def schedule_schema_save(
        self,
    ) -> None:
        """Schedule persistence of the MSS structural schema."""

        self.store.async_delay_save(
            self._serialize_schema,
            1.0,
        )

    @callback
    def _serialize_schema(
        self,
    ) -> dict[str, Any]:
        """Return MSS structural schema in JSON-serializable form.

        Normal entities and image fields are persisted separately.
        Image Base64 values are deliberately excluded.
        """

        return {
            "entities": list(self.schema.values()),
            "images": list(self.image_schema.values()),
        }

    # ========================================================
    # PROCESS MQTT REPORT
    # ========================================================

    @callback
    def process_report(
        self,
        report: dict[str, Any],
    ) -> None:
        """Process one complete MSSReport MQTT payload."""

        # Every MQTT report receives its own identifier.
        current_message_id = uuid4().hex

        # Flatten completely arbitrary MSS JSON.
        fields = flatten_mss_report(report)

        # Dynamically determine the report control plan.
        control_plan = extract_report_control_plan(fields)

        entity_updates: list[dict[str, Any]] = []

        schema_changed = False

        # ====================================================
        # GENERATE GENERIC + CONTROL PLAN VERSIONS
        # ====================================================

        for field in fields:
            path = field["path"]
            value = field["value"]
            unit = field.get("unit")

            # ------------------------------------------------
            # LIVE IMAGE
            # ------------------------------------------------
            #
            # Images must never become normal HA sensor
            # states because the Base64 payload can be huge.
            # ------------------------------------------------

            if isinstance(value, dict) and value.get("type") == "image":
                mimetype = value.get("mimetype")
                data = value.get("data")

                if isinstance(mimetype, str) and isinstance(data, str):
                    variants = create_field_variants(
                        path=path,
                        value="image",
                        unit=None,
                        control_plan=control_plan,
                    )

                    for variant in variants:
                        image_schema_changed = self.store_image(
                            group=variant["group"],
                            path=variant["path"],
                            mimetype=mimetype,
                            data=data,
                            control_plan=variant.get("control_plan"),
                            generic=variant.get(
                                "generic",
                                False,
                            ),
                            message_id=current_message_id,
                        )

                        if image_schema_changed:
                            schema_changed = True

                # Never send the Base64 image through normal
                # sensor processing.
                continue

            # Ignore serialized images / enormous binary data.
            if should_ignore_mss_field(
                path,
                value,
            ):
                continue

            variants = create_field_variants(
                path=path,
                value=value,
                unit=unit,
                control_plan=control_plan,
            )

            entity_updates.extend(variants)

        # ====================================================
        # DEDUPLICATE GROUP + PATH
        # ====================================================

        deduplicated: dict[
            str,
            dict[str, Any],
        ] = {}

        for update in entity_updates:
            key = create_entity_manager_key(
                group=update["group"],
                path=update["path"],
            )

            deduplicated[key] = update

        # ====================================================
        # CREATE / UPDATE ENTITIES
        # ====================================================

        discovered: list[MSSDynamicSensor] = []

        for key, update in deduplicated.items():
            numeric = to_number(update["value"]) is not None

            schema_definition = {
                "path": update["path"],
                "group": update["group"],
                "control_plan": update.get("control_plan"),
                "generic": bool(
                    update.get(
                        "generic",
                        False,
                    )
                ),
                "unit": update.get("unit"),
                "numeric": numeric,
            }

            # -----------------------------------------------
            # UPDATE PERSISTENT STRUCTURE
            # -----------------------------------------------

            if self.schema.get(key) != schema_definition:
                self.schema[key] = schema_definition
                schema_changed = True

            # -----------------------------------------------
            # CREATE OR UPDATE ENTITY
            # -----------------------------------------------

            entity = self.entities.get(key)

            if entity is None:
                entity = MSSDynamicSensor(
                    path=update["path"],
                    value=update["value"],
                    unit=update.get("unit"),
                    group=update["group"],
                    message_id=current_message_id,
                    control_plan=update.get("control_plan"),
                    generic=update.get(
                        "generic",
                        False,
                    ),
                    restored=False,
                    numeric_hint=numeric,
                )

                self.entities[key] = entity
                discovered.append(entity)

            else:
                entity.update_value(
                    value=update["value"],
                    unit=update.get("unit"),
                    message_id=current_message_id,
                )

        # ====================================================
        # REGISTER NEW ENTITIES
        # ====================================================

        if discovered:
            self.async_add_entities(discovered)

        # Only write storage when the MSS structure actually
        # changes.
        if schema_changed:
            self.schedule_schema_save()


# ============================================================
# MSS DYNAMIC SENSOR
# ============================================================


class MSSDynamicSensor(SensorEntity):
    """One dynamically discovered MSS field."""

    _attr_has_entity_name = True

    def __init__(
        self,
        path: str,
        value: Any,
        group: str,
        message_id: str | None,
        unit: str | None = None,
        control_plan: str | None = None,
        generic: bool = False,
        restored: bool = False,
        numeric_hint: bool = False,
    ) -> None:
        """Initialize a dynamically discovered MSS sensor."""

        self.source_path = path
        self.mss_group = group
        self.mss_message_id = message_id
        self.control_plan = control_plan
        self.is_generic = generic
        self._restored_structure = restored

        # ====================================================
        # UNIQUE ID
        # ====================================================

        self._attr_unique_id = create_grouped_unique_id(
            group=group,
            path=path,
        )

        # ====================================================
        # FRIENDLY NAME
        # ====================================================

        self._attr_name = create_friendly_name(path)

        # ====================================================
        # INITIAL VALUE
        # ====================================================

        if restored:
            # Structural entity restored before MQTT.
            #
            # Keep it available so its metadata is exposed to
            # the frontend immediately.
            #
            # Its state is unknown until a live report arrives.
            self._attr_available = True
            self._attr_native_value = None

            self._attr_native_unit_of_measurement = (
                str(unit) if (numeric_hint and unit) else None
            )

            self._attr_state_class = (
                SensorStateClass.MEASUREMENT if numeric_hint else None
            )

        else:
            self._attr_available = True

            self._configure_value(
                value,
                unit,
            )

    # ========================================================
    # DEVICE GROUPING
    # ========================================================

    @property
    def device_info(
        self,
    ) -> DeviceInfo:
        """Group MSS entities into HA devices."""

        if self.is_generic:
            device_name = "MSS Report"

        elif self.control_plan:
            device_name = f"MSS Report - {self.control_plan}"

        else:
            device_name = self.mss_group

        return DeviceInfo(
            identifiers={
                (
                    DOMAIN,
                    self.mss_group,
                )
            },
            name=device_name,
            manufacturer="MSS",
            model="MSS Report",
        )

    # ========================================================
    # STRUCTURAL + REPORT METADATA
    # ========================================================

    @property
    def extra_state_attributes(
        self,
    ) -> dict[str, Any]:
        """Expose MSS metadata."""

        attributes: dict[
            str,
            Any,
        ] = {
            "mss_source_path": self.source_path,
            "mss_group": self.mss_group,
            "mss_generic": self.is_generic,
        }

        if self.control_plan:
            attributes["mss_control_plan"] = self.control_plan

        # Message ID only exists after a live report has been
        # received during this HA runtime.
        if self.mss_message_id:
            attributes["mss_message_id"] = self.mss_message_id

        return attributes

    # ========================================================
    # UPDATE FROM MQTT
    # ========================================================

    @callback
    def update_value(
        self,
        value: Any,
        message_id: str,
        unit: str | None = None,
    ) -> None:
        """Update sensor from a new MSS report."""

        self._attr_available = True
        self._restored_structure = False
        self.mss_message_id = message_id

        self._configure_value(
            value,
            unit,
        )

        if self.hass:
            self.async_write_ha_state()

    # ========================================================
    # CONFIGURE SENSOR VALUE
    # ========================================================

    def _configure_value(
        self,
        value: Any,
        unit: str | None,
    ) -> None:
        """Configure native value and statistics support."""

        numeric_value = to_number(value)

        if numeric_value is not None:
            self._attr_native_value = numeric_value

            self._attr_native_unit_of_measurement = str(unit) if unit else None

            self._attr_state_class = SensorStateClass.MEASUREMENT

            return

        # Non-numeric sensor.
        self._attr_native_value = normalize_state_value(value)

        self._attr_native_unit_of_measurement = None

        self._attr_state_class = None


# ============================================================
# CONTROL PLAN EXTRACTION
# ============================================================


def extract_report_control_plan(
    fields: list[dict[str, Any]],
) -> str | None:
    """Determine the current control plan.

    Preferred source:
        *.ControlPlan

    Fallback:
        infer from ANY path segment ending in _Something.
    """

    # ========================================================
    # EXPLICIT CONTROL PLAN FIELD
    # ========================================================

    for field in fields:
        path = str(
            field.get(
                "path",
                "",
            )
        )

        if path.lower().endswith(".controlplan"):
            value = field.get("value")

            if value is not None and str(value).strip():
                return str(value).strip()

    # ========================================================
    # FALLBACK
    # ========================================================
    #
    # Prefer known structural roots as a fallback.
    #
    # The actual genericization itself remains completely
    # generic and works for AnythingElse_Test1 etc.
    # ========================================================

    for field in fields:
        path = str(
            field.get(
                "path",
                "",
            )
        )

        parts = path.split(".")

        for part in parts:
            match = re.match(
                r"^(?:LastMeasurement|"
                r"StatisticsEvaluation)_(.+)$",
                part,
                re.IGNORECASE,
            )

            if match:
                control_plan = match.group(1).strip()

                if control_plan:
                    return control_plan

    return None


# ============================================================
# CREATE GENERIC + SPECIFIC FIELD VARIANTS
# ============================================================


def create_field_variants(
    path: str,
    value: Any,
    unit: str | None,
    control_plan: str | None,
) -> list[dict[str, Any]]:
    """Create MSS entity variants.

    Rules
    -----

    No Control Plan:
        MSSReport only.

    Control Plan exists + field is genuinely general:
        MSSReport
        MSSReport_{ControlPlan}

    Control Plan exists + the actual MSS path already contains
    that Control Plan:
        MSSReport_{ControlPlan} only.

    Examples:
    --------
    Test1 report:

        rootNode.Identification.SerialNumber

    becomes:

        MSSReport
            rootNode.Identification.SerialNumber

        MSSReport_Test1
            rootNode.Identification.SerialNumber

    But:

        rootNode.LastMeasurement_Test1.
        Blob_Detection_2_Main_Result_X

    becomes ONLY:

        MSSReport_Test1
            rootNode.LastMeasurement_Test1.
            Blob_Detection_2_Main_Result_X

    No synthetic generic LastMeasurement path is created.
    """

    variants: list[dict[str, Any]] = []

    # ========================================================
    # NO CONTROL PLAN
    # ========================================================

    if not control_plan:
        variants.append(
            {
                "path": path,
                "value": value,
                "unit": unit,
                "group": "MSSReport",
                "control_plan": None,
                "generic": True,
            }
        )

        return variants

    # ========================================================
    # DETERMINE WHETHER THIS PATH IS CONTROL-PLAN-SPECIFIC
    # ========================================================

    control_plan_specific = path_contains_control_plan(
        path,
        control_plan,
    )

    # ========================================================
    # GENERIC VERSION
    # ========================================================
    #
    # Only genuinely common fields are copied to MSSReport.
    #
    # We NO LONGER manufacture a generic version of:
    #
    # LastMeasurement_Test1
    # StatisticsEvaluation_Test1
    # Anything_Test1
    #
    # Wildcards will handle those differences at visualization
    # level instead.
    # ========================================================

    if not control_plan_specific:
        variants.append(
            {
                "path": path,
                "value": value,
                "unit": unit,
                "group": "MSSReport",
                "control_plan": None,
                "generic": True,
            }
        )

    # ========================================================
    # CONTROL-PLAN-SPECIFIC VERSION
    # ========================================================
    #
    # The specific group contains the COMPLETE report:
    #
    # - general fields
    # - control-plan-specific fields
    #
    # This is important because visualization will resolve
    # wildcards entirely inside the latest incoming group.
    # ========================================================

    variants.append(
        {
            "path": path,
            "value": value,
            "unit": unit,
            "group": f"MSSReport_{control_plan}",
            "control_plan": control_plan,
            "generic": False,
        }
    )

    return variants


def path_contains_control_plan(
    path: str,
    control_plan: str | None,
) -> bool:
    """Return whether an MSS path contains the current Control Plan.

    The Control Plan is matched as a distinct technical-name token.

    Matches examples such as:

        LastMeasurement_Test1
        StatisticsEvaluation_Test1
        Test1_BlobDetection
        Something_Test1_Result

    But avoids blindly matching Test1 as part of an unrelated
    larger word.
    """

    if not path or not control_plan:
        return False

    escaped_control_plan = re.escape(str(control_plan).strip())

    if not escaped_control_plan:
        return False

    pattern = re.compile(
        rf"(?:^|_)"
        rf"{escaped_control_plan}"
        rf"(?:_|$)",
        re.IGNORECASE,
    )

    return any(pattern.search(segment) for segment in str(path).split("."))


# ============================================================
# FLATTEN ARBITRARY MSS JSON
# ============================================================


def flatten_mss_report(
    report: dict[str, Any],
) -> list[dict[str, Any]]:
    """Flatten arbitrary MSS JSON into leaf fields."""

    fields: list[dict[str, Any]] = []

    flatten_value(
        value=report,
        path="",
        fields=fields,
        inherited_unit=None,
    )

    return fields


def flatten_value(
    value: Any,
    path: str,
    fields: list[dict[str, Any]],
    inherited_unit: str | None = None,
) -> None:
    """Recursively flatten arbitrary MSS data."""

    # ========================================================
    # DICTIONARY
    # ========================================================

    if isinstance(
        value,
        dict,
    ):
        # ====================================================
        # MSS IMAGE VALUE
        # ====================================================

        image = value.get("image")

        if isinstance(image, dict):
            mimetype = image.get("mimetype")
            data = image.get("data")

            if (
                isinstance(mimetype, str)
                and isinstance(data, str)
                and mimetype.startswith("image/")
                and data
            ):
                if path:
                    fields.append(
                        {
                            "path": path,
                            "value": {
                                "type": "image",
                                "mimetype": mimetype,
                                "data": data,
                            },
                            "unit": None,
                        }
                    )

                return

        local_unit = value.get("@Unit") or value.get("Unit") or inherited_unit

        for (
            key,
            child_value,
        ) in value.items():
            child_path = f"{path}.{key}" if path else str(key)

            flatten_value(
                value=child_value,
                path=child_path,
                fields=fields,
                inherited_unit=local_unit,
            )

        return

    # ========================================================
    # LIST
    # ========================================================

    if isinstance(
        value,
        list,
    ):
        for (
            index,
            child_value,
        ) in enumerate(value):
            child_path = f"{path}__{index}__"

            flatten_value(
                value=child_value,
                path=child_path,
                fields=fields,
                inherited_unit=inherited_unit,
            )

        return

    # ========================================================
    # LEAF
    # ========================================================

    if not path:
        return

    fields.append(
        {
            "path": path,
            "value": value,
            "unit": inherited_unit,
        }
    )


# ============================================================
# IGNORE LARGE / UNSUITABLE FIELDS
# ============================================================


def should_ignore_mss_field(
    path: str,
    value: Any,
) -> bool:
    """Ignore serialized images and enormous binary values."""

    path_lower = path.lower()

    image_tokens = (
        ".image.data",
        ".image.mimetype",
        "image_file",
        "image.data",
        "serialized_image",
    )

    if any(token in path_lower for token in image_tokens):
        return True

    if isinstance(
        value,
        str,
    ):
        stripped = value.strip()

        if stripped.startswith(
            (
                "iVBOR",
                "/9j/",
                "R0lGOD",
                "UklGR",
            )
        ):
            return True

        if len(stripped) > 4096:
            return True

    return False


# ============================================================
# VALUE HELPERS
# ============================================================


def to_number(
    value: Any,
) -> int | float | None:
    """Convert a value to a finite numeric HA state when appropriate.

    NaN and +/-Infinity are deliberately treated as non-numeric
    because Home Assistant does not allow non-finite values for
    measurement sensors.
    """

    if isinstance(value, bool):
        return None

    if isinstance(value, int):
        return value

    if isinstance(value, float):
        if not math.isfinite(value):
            return None

        return value

    if not isinstance(value, str):
        return None

    text = value.strip()

    if not text:
        return None

    try:
        number = float(text)
    except ValueError:
        return None

    # float("NaN"), float("inf") and float("-inf")
    # are valid Python floats but invalid HA measurement states.
    if not math.isfinite(number):
        return None

    if number.is_integer():
        return int(number)

    return number


def normalize_state_value(
    value: Any,
) -> str | None:
    """Convert arbitrary non-numeric MSS values to HA states."""

    if value is None:
        return None

    if isinstance(value, bool):
        return "true" if value else "false"

    if isinstance(value, str):
        text = value.strip()

        # MSS can report non-finite numeric placeholders.
        # Represent these as an unknown HA state.
        if text.lower() in {
            "nan",
            "+nan",
            "-nan",
            "inf",
            "+inf",
            "-inf",
            "infinity",
            "+infinity",
            "-infinity",
        }:
            return None

        return value

    return str(value)


# ============================================================
# ENTITY ID / UNIQUE ID HELPERS
# ============================================================


def create_entity_manager_key(
    group: str,
    path: str,
) -> str:
    """Create internal manager key."""

    return f"{group}::{path}"


def create_grouped_unique_id(
    group: str,
    path: str,
) -> str:
    """Create stable group-aware unique ID."""

    return f"mss_{slugify(group)}_{slugify(path)}"


def create_friendly_name(
    path: str,
) -> str:
    """Create readable HA entity name."""

    parts = path.split(".")

    if parts and parts[0].lower() == "rootnode":
        parts = parts[1:]

    readable_parts = [format_name_part(part) for part in parts]

    return " ".join(part for part in readable_parts if part)


def format_name_part(
    value: str,
) -> str:
    """Convert MSS key to readable text."""

    value = (
        str(value)
        .replace(
            "__",
            " ",
        )
        .replace(
            "_",
            " ",
        )
    )

    value = re.sub(
        r"([a-z0-9])([A-Z])",
        r"\1 \2",
        value,
    )

    value = re.sub(
        r"\s+",
        " ",
        value,
    )

    return value.strip()


def slugify(
    value: str,
) -> str:
    """Create deterministic HA-safe identifier fragment."""

    value = str(value).strip().lower()

    value = re.sub(
        r"[^a-z0-9]+",
        "_",
        value,
    )

    return value.strip("_")
