import { getElementById } from "./elementRegistry.ts";

let currentlyHighlighted: HTMLElement | null = null;

const highlightParagraph = (id: string): void => {
  if (currentlyHighlighted) {
    currentlyHighlighted.style.backgroundColor = "";
    currentlyHighlighted = null;
  }

  const element = getElementById(id) as HTMLElement | undefined;
  if (element) {
    const rect = element.getBoundingClientRect();
    const top = rect.top + window.scrollY - window.innerHeight / 2;
    window.scrollTo({
      top,
      behavior: "smooth",
    });
    element.style.backgroundColor = "yellow";
    currentlyHighlighted = element;
  }
};

export default highlightParagraph;
