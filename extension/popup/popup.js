const input = document.getElementById("backendUrl");
const status = document.getElementById("status");

chrome.storage.sync.get("backendUrl").then(({ backendUrl }) => {
  if (backendUrl) input.value = backendUrl;
});

document.getElementById("save").addEventListener("click", async () => {
  const value = input.value.trim();
  await chrome.storage.sync.set({ backendUrl: value });
  status.textContent = value ? "Saved." : "Cleared — demo mode active.";
  setTimeout(() => (status.textContent = ""), 2000);
});
