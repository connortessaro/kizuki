import type { Location } from "./events";

/** A short, plain description of where a passage is, such as "Slide 12 of Week 3.pptx". */
export function describeLocation(location: Location, fileName: string): string {
  if (location.slide !== undefined) {
    return location.notes ? `The notes on slide ${location.slide} of ${fileName}` : `Slide ${location.slide} of ${fileName}`;
  }
  if (location.page !== undefined) return `Page ${location.page} of ${fileName}`;
  if (location.sheet !== undefined) {
    return location.cells ? `Cells ${location.cells} of sheet “${location.sheet}” in ${fileName}` : `Sheet “${location.sheet}” in ${fileName}`;
  }
  if (location.cells !== undefined) return `Cells ${location.cells} of ${fileName}`;
  if (location.heading !== undefined) return `The section “${location.heading}” of ${fileName}`;
  if (location.paragraph !== undefined) return `Paragraph ${location.paragraph} of ${fileName}`;
  return fileName;
}
