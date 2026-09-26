import type { Location } from "../events";

/** A heading found in the material, before it gets an id. */
export interface ExtractedSection {
  /** The heading's text. Without a real heading it is a stand-in, such as the file name, a sheet name, a page's first line, or `Slide 3`. */
  title: string;
  /** How deep the heading is, 1 for a top heading. `toRecords` keeps it between 1 and 6. */
  level: number;
  /** True when the title is a real heading of the material, not a page number or a file name. */
  heading?: boolean;
}

/** A passage found in the material, before it gets an id. */
export interface ExtractedPassage {
  /** Index into {@link Extracted.sections}. */
  sectionIndex: number;
  /** The passage's text as read from the file. */
  text: string;
  /** Where the passage sits in the file, such as its page, slide, or cell range. */
  location: Location;
}

/** Everything read out of one file. */
export interface Extracted {
  /** The headings, in the order they appear in the file. */
  sections: ExtractedSection[];
  /** The passages, in the order they are read from the file. */
  passages: ExtractedPassage[];
}
