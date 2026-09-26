import { XMLParser } from "fast-xml-parser";

/** A simplified XML element: name, attributes, children in document order, and text for text nodes. */
export interface XNode {
  /** The element's name with its prefix, such as `w:p`. `#text` for a text node, `#root` for the top of the tree. */
  name: string;
  /** The element's attributes by name, all as strings. Empty for text nodes. */
  attrs: Record<string, string>;
  /** The child nodes, in document order. Empty for text nodes. */
  children: XNode[];
  /** The text of a text node. Empty for elements. */
  text: string;
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
});

type Raw = Record<string, unknown>;

function convert(items: unknown): XNode[] {
  if (!Array.isArray(items)) return [];
  return items.map((item: Raw) => {
    const name = Object.keys(item).find((k) => k !== ":@") ?? "#text";
    if (name === "#text") return { name, attrs: {}, children: [], text: String(item["#text"] ?? "") };
    return { name, attrs: (item[":@"] as Record<string, string>) ?? {}, children: convert(item[name]), text: "" };
  });
}

/** Parses an XML string into a tree rooted at a node named `#root`. */
export function parseXml(xml: string): XNode {
  return { name: "#root", attrs: {}, children: convert(parser.parse(xml)), text: "" };
}

/** Every descendant of a node, in document order. */
export function* descendants(node: XNode): Generator<XNode> {
  for (const child of node.children) {
    yield child;
    yield* descendants(child);
  }
}

/** The first descendant with the given element name. */
export function find(node: XNode, name: string): XNode | undefined {
  for (const n of descendants(node)) if (n.name === name) return n;
  return undefined;
}

/** All descendants with the given element name. */
export function findAll(node: XNode, name: string): XNode[] {
  return [...descendants(node)].filter((n) => n.name === name);
}

/** The direct children with the given element name. */
export function childrenNamed(node: XNode, name: string): XNode[] {
  return node.children.filter((n) => n.name === name);
}

/** The text inside every descendant element named `textTag`, joined together. */
export function textOf(node: XNode, textTag: string): string {
  let out = "";
  for (const n of descendants(node)) {
    if (n.name === textTag) out += n.children.map((c) => c.text).join("");
  }
  return out;
}
