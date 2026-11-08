const copyButton = document.querySelector("#copy-setup");
if (navigator.clipboard?.writeText) {
  copyButton.hidden = false;
  copyButton.addEventListener("click", async () => {
    const result = document.querySelector("#copy-result");
    try {
      await navigator.clipboard.writeText(document.querySelector("#setup-prompt").textContent);
      result.textContent = "Copied.";
    } catch {
      result.textContent = "Select the prompt to copy it manually.";
    }
  });
}
