/**
 * Waymark_Config class
 *
 * Defines the configuration options for Waymark JS maps.
 * Manages map options including marker types, line types, and tile layers.
 * Provides methods for setting and getting map options with deep cloning to ensure independence.
 *
 * This class is responsible for:
 * - Maintaining configuration structure for Waymark maps
 * - Providing access to specific configuration sections (marker_types, line_types, tile_layers)
 * - Ensuring proper deep cloning of configuration values to maintain state independence
 * - Supporting the undo/redo stack by providing immutable operations
 */
const ALLOWED_MARKER_SHAPES = new Set(["marker", "circle", "rectangle"]);
const ALLOWED_MARKER_SIZES = new Set(["small", "medium", "large"]);
const ALLOWED_ICON_TYPES = new Set(["icon", "text"]);

function sanitizePlainText(value, maxLength = 120) {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>]/g, "")
    .trim();
  if (!normalized) return "";
  return normalized.slice(0, maxLength);
}

function sanitizeColor(value, fallback) {
  const normalized = String(value ?? "").trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(normalized)) return normalized;
  if (/^[A-Za-z]{3,20}$/.test(normalized)) return normalized.toLowerCase();
  return fallback;
}

function sanitizeMarkerIcon(value, iconType) {
  const normalized = sanitizePlainText(value, 64);
  if (iconType === "icon") {
    const compact = normalized.replace(/\s+/g, "");
    if (/^(ion-[A-Za-z0-9-]+|fa-[A-Za-z0-9-]+|[A-Za-z0-9-]+)$/.test(compact)) return compact;
    return "ion-location";
  }
  return normalized.slice(0, 8);
}

function sanitizeBoundedNumberString(value, { min, max, fallback }) {
  const parsed = Number.parseFloat(String(value ?? "").trim());
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min || parsed > max) return fallback;
  return String(parsed);
}

function sanitizeMarkerType(entry) {
  const markerShape = ALLOWED_MARKER_SHAPES.has(entry?.marker_shape) ? entry.marker_shape : "marker";
  const markerSize = ALLOWED_MARKER_SIZES.has(entry?.marker_size) ? entry.marker_size : "medium";
  const iconType = ALLOWED_ICON_TYPES.has(entry?.icon_type) ? entry.icon_type : "icon";

  return {
    ...entry,
    marker_title: sanitizePlainText(entry?.marker_title || "Marker", 64) || "Marker",
    marker_shape: markerShape,
    marker_size: markerSize,
    icon_type: iconType,
    marker_icon: sanitizeMarkerIcon(entry?.marker_icon, iconType),
    marker_colour: sanitizeColor(entry?.marker_colour, "#2aabe1"),
    icon_colour: sanitizeColor(entry?.icon_colour, "#ffffff"),
  };
}

function sanitizeLineType(entry) {
  return {
    ...entry,
    line_title: sanitizePlainText(entry?.line_title || "Line", 64) || "Line",
    line_colour: sanitizeColor(entry?.line_colour, "#487bd9"),
    line_weight: sanitizeBoundedNumberString(entry?.line_weight, {
      min: 1,
      max: 24,
      fallback: "3",
    }),
    line_opacity: sanitizeBoundedNumberString(entry?.line_opacity, {
      min: 0,
      max: 1,
      fallback: "0.7",
    }),
  };
}

function sanitizeShapeType(entry) {
  return {
    ...entry,
    shape_title: sanitizePlainText(entry?.shape_title || "Shape", 64) || "Shape",
    shape_colour: sanitizeColor(entry?.shape_colour, "#487bd9"),
    fill_opacity: sanitizeBoundedNumberString(entry?.fill_opacity, {
      min: 0,
      max: 1,
      fallback: "0.5",
    }),
  };
}

function sanitizeTileLayer(entry) {
  const layerUrl = String(entry?.layer_url ?? "").trim();
  const safeUrl = /^https?:\/\/[^\s]+$/i.test(layerUrl)
    ? layerUrl
    : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

  return {
    ...entry,
    layer_name: sanitizePlainText(entry?.layer_name || "OpenStreetMap", 64) || "OpenStreetMap",
    layer_url: safeUrl,
    layer_attribution:
      sanitizePlainText(entry?.layer_attribution || "OSM contributors", 180) || "OSM contributors",
  };
}

function sanitizeMapOption(key, value) {
  if (key === "marker_types" && Array.isArray(value)) {
    return value.map((entry) => sanitizeMarkerType(entry));
  }
  if (key === "line_types" && Array.isArray(value)) {
    return value.map((entry) => sanitizeLineType(entry));
  }
  if (key === "shape_types" && Array.isArray(value)) {
    return value.map((entry) => sanitizeShapeType(entry));
  }
  if (key === "tile_layers" && Array.isArray(value)) {
    return value.map((entry) => sanitizeTileLayer(entry));
  }
  return value;
}

export class Waymark_Config {
  /**
   * Create a new Waymark_Config instance
   *
   * @param {Object} config - Optional initial configuration
   */
  constructor(config = {}) {
    // Initialize with default structure
    this.map_options = {
      // Default tile layers
      tile_layers: [
        {
          layer_name: "OpenStreetMap",
          layer_url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
          layer_attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors',
        },
      ],

      // Default marker types
      marker_types: [
        {
          marker_title: "Photo",
          marker_shape: "marker",
          marker_size: "medium",
          icon_type: "icon",
          marker_icon: "ion-camera",
          marker_colour: "#70af00",
          icon_colour: "#ffffff",
          marker_display: "1",
          marker_submission: "1",
        },
        {
          marker_title: "Water",
          marker_shape: "marker",
          marker_size: "medium",
          icon_type: "icon",
          marker_icon: "ion-waterdrop",
          marker_colour: "#2aabe1",
          icon_colour: "#fff",
          marker_display: "1",
          marker_submission: "1",
        },
        {
          marker_title: "Trail Access",
          marker_shape: "marker",
          marker_size: "medium",
          icon_type: "icon",
          marker_icon: "ion-android-car",
          marker_colour: "#fbfbfb",
          icon_colour: "#707070",
          marker_display: "1",
          marker_submission: "1",
        },
        {
          marker_title: "Information",
          marker_shape: "marker",
          marker_size: "medium",
          icon_type: "icon",
          marker_icon: "ion-information-circled",
          marker_colour: "#fbfbfb",
          icon_colour: "#0069a5",
          marker_display: "1",
          marker_submission: "1",
        },
        {
          marker_title: "Alert",
          marker_shape: "marker",
          marker_size: "medium",
          icon_type: "icon",
          marker_icon: "ion-android-alert",
          marker_colour: "#da3d20",
          icon_colour: "white",
          marker_display: "1",
          marker_submission: "1",
        },
        {
          marker_title: "Food",
          marker_shape: "marker",
          marker_size: "medium",
          icon_type: "icon",
          marker_icon: "ion-pizza",
          marker_colour: "#da3d20",
          icon_colour: "#ffba00",
          marker_display: "1",
          marker_submission: "1",
        },
        {
          marker_title: "Beer",
          marker_shape: "marker",
          marker_size: "medium",
          icon_type: "icon",
          marker_icon: "ion-beer",
          marker_colour: "#fbfbfb",
          icon_colour: "#754423",
          marker_display: "1",
          marker_submission: "1",
        },
        {
          marker_title: "Start",
          marker_shape: "marker",
          marker_size: "medium",
          icon_type: "icon",
          marker_icon: "fa-flag",
          marker_colour: "#70af00",
          icon_colour: "white",
          marker_display: "1",
          marker_submission: "1",
        },
        {
          marker_title: "Finish",
          marker_shape: "marker",
          marker_size: "medium",
          icon_type: "icon",
          marker_icon: "fa-flag-checkered",
          marker_colour: "#a43233",
          icon_colour: "white",
          marker_display: "1",
          marker_submission: "1",
        },
        {
          marker_title: "Store",
          marker_shape: "marker",
          marker_size: "medium",
          icon_type: "icon",
          marker_icon: "ion-android-cart",
          marker_colour: "#416979",
          icon_colour: "#ffffff",
          marker_display: "1",
          marker_submission: "1",
        },
        {
          marker_title: "Camp",
          marker_shape: "marker",
          marker_size: "medium",
          icon_type: "icon",
          marker_icon: "ion-android-home",
          marker_colour: "#a43233",
          icon_colour: "#ffffff",
          marker_display: "1",
          marker_submission: "1",
        },
        {
          marker_title: "Wildlife",
          marker_shape: "marker",
          marker_size: "medium",
          icon_type: "icon",
          marker_icon: "ion-ios-paw",
          marker_colour: "#a43233",
          icon_colour: "#ffffff",
          marker_display: "1",
          marker_submission: "1",
        },
        {
          marker_title: "Point of Interest",
          marker_shape: "marker",
          marker_size: "medium",
          icon_type: "icon",
          marker_icon: "ion-eye",
          marker_colour: "#da3d20",
          icon_colour: "#e5e5e5",
          marker_display: "1",
          marker_submission: "1",
        },
      ],

      // Default line types
      line_types: [
        {
          line_title: "Green",
          line_colour: "#30d100",
          line_weight: "3",
          line_opacity: "0.7",
          line_display: "1",
          line_submission: "1",
        },
        {
          line_title: "Red",
          line_colour: "#dd3333",
          line_weight: "3",
          line_opacity: "0.7",
          line_display: "1",
          line_submission: "1",
        },
        {
          line_title: "Blue",
          line_colour: "#487bd9",
          line_weight: "3",
          line_opacity: "0.7",
          line_display: "1",
        },
      ],

      // Default shape types
      shape_types: [
        {
          shape_title: "Red",
          shape_colour: "#d84848",
          fill_opacity: "0.5",
          shape_display: "1",
          shape_submission: "1",
        },
        {
          shape_title: "Green",
          shape_colour: "#3cbc47",
          fill_opacity: "0.15",
          shape_display: "1",
          shape_submission: "1",
        },
        {
          shape_title: "Blue",
          shape_colour: "#487bd9",
          fill_opacity: "0.5",
          shape_display: "1",
          shape_submission: "1",
        },
      ],
    };

    // Override defaults with provided config
    this.updateConfig(config);

    // Make the class itself act like the configuration object
    // by defining a custom toString method
    this.toString = function () {
      return JSON.stringify({
        map_options: this.map_options,
      });
    };
  }

  /**
   * Update the configuration with new values
   * Creates deep clones of all values to ensure independence
   *
   * @param {Object} config - The new configuration options
   */
  updateConfig(config = {}) {
    if (!config) return;

    // If config has map_options, merge them with existing ones
    if (config.map_options) {
      for (const key in config.map_options) {
        if (config.map_options.hasOwnProperty(key)) {
          const sanitized = sanitizeMapOption(key, config.map_options[key]);
          // Deep clone each value to ensure independence
          this.map_options[key] = JSON.parse(JSON.stringify(sanitized));
        }
      }
    }
  }

  /**
   * Get specific map option
   *
   * @param {string} key - The option key
   * @returns {any} The option value
   */
  getMapOption(key) {
    return key ? this.map_options[key] : undefined;
  }

  /**
   * Get all map option keys
   *
   * @returns {string[]} Array of map option keys
   */
  getMapOptionKeys() {
    return Object.keys(this.map_options);
  }

  /**
   * Set specific map option
   * Creates a deep copy of the value to ensure independence
   *
   * @param {string} key - The option key
   * @param {any} value - The option value
   */
  setMapOption(key, value) {
    if (key) {
      // Create a deep copy of the value to ensure it's independent
      this.map_options[key] = JSON.parse(JSON.stringify(value));
    }
  }

  /**
   * Create a clone of this Waymark_Config
   * Creates a completely new Waymark_Config instance with deep-cloned data
   *
   * @returns {Waymark_Config} A new Waymark_Config instance with the same data
   */
  clone() {
    const clonedConfig = new Waymark_Config();

    // Copy all map options from this config
    for (const key in this.map_options) {
      if (this.map_options.hasOwnProperty(key)) {
        // Deep clone each option value to ensure complete independence
        const value = JSON.parse(JSON.stringify(this.getMapOption(key)));
        clonedConfig.setMapOption(key, value);
      }
    }

    return clonedConfig;
  }
}
