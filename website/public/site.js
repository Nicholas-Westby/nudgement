import { examples } from "./examples.js";
import { initMargin } from "./margin.js";

const picker = document.querySelector(".example-picker");
const buttons = [...picker.querySelectorAll("button")];
for (const button of buttons) {
  button.addEventListener("click", () => {
    const example = examples[button.dataset.example];
    for (const sibling of buttons) sibling.setAttribute("aria-pressed", String(sibling === button));
    for (const field of ["title", "before", "after", "finding"]) {
      document.querySelector(`#example-${field}`).textContent = example[field];
    }
    document.querySelector("#example-type").textContent = example.evaluator;
    const source = document.querySelector("#example-source");
    source.textContent = `Source: ${example.source}`;
    source.href = example.url;
    document.querySelector("#example-announcement").textContent = `${example.title} ${example.finding}`;
  });
}
picker.hidden = false;

const copyButton = document.querySelector("#copy-command");
const copyStatus = document.querySelector("#copy-status");
// Do not offer a nonfunctional button on browsers without clipboard support.
if (navigator.clipboard?.writeText) {
  copyButton.hidden = false;
  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(document.querySelector("#command").textContent);
      copyStatus.textContent = "Command copied.";
      copyButton.textContent = "Copied";
      setTimeout(() => {
        copyButton.textContent = "Copy command";
      }, 2000);
    } catch {
      copyStatus.textContent = "Couldn't copy. Select the command above and copy it manually.";
      copyButton.textContent = "Select to copy";
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(document.querySelector("#command"));
      selection.removeAllRanges();
      selection.addRange(range);
    }
  });
}
initMargin();
