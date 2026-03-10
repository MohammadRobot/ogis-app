const DANGEROUS_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
  "base",
]);

function hasDangerousUrl(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return false;
  return normalized.startsWith("javascript:") || normalized.startsWith("vbscript:");
}

function hasDangerousStyle(value) {
  const normalized = String(value || "").toLowerCase();
  if (!normalized) return false;
  return normalized.includes("expression(") || normalized.includes("javascript:");
}

export function sanitizeHtmlFragment(html) {
  if (typeof html !== "string" || html.length === 0) return "";
  if (typeof document === "undefined") return "";

  const template = document.createElement("template");
  template.innerHTML = html;

  const elements = template.content.querySelectorAll("*");
  for (const element of elements) {
    const tagName = element.tagName.toLowerCase();
    if (DANGEROUS_TAGS.has(tagName)) {
      element.remove();
      continue;
    }

    for (const attribute of [...element.attributes]) {
      const attrName = attribute.name.toLowerCase();
      const attrValue = attribute.value;

      if (attrName.startsWith("on")) {
        element.removeAttribute(attribute.name);
        continue;
      }

      if ((attrName === "href" || attrName === "src" || attrName === "xlink:href") && hasDangerousUrl(attrValue)) {
        element.removeAttribute(attribute.name);
        continue;
      }

      if (attrName === "style" && hasDangerousStyle(attrValue)) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  return template.innerHTML;
}
