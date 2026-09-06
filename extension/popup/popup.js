const backendInput = document.getElementById("backendUrl");
const bookerInput = document.getElementById("bookerEmail");
const status = document.getElementById("status");

chrome.storage.sync.get(["backendUrl", "bookerEmail"]).then(({ backendUrl, bookerEmail }) => {
  if (backendUrl) backendInput.value = backendUrl;
  if (bookerEmail) bookerInput.value = bookerEmail;
});

document.getElementById("save").addEventListener("click", async () => {
  const backendUrl = backendInput.value.trim();
  const bookerEmail = bookerInput.value.trim();
  await chrome.storage.sync.set({ backendUrl, bookerEmail });
  status.textContent = backendUrl ? "Saved." : "Backend URL cleared — demo mode active.";
  setTimeout(() => (status.textContent = ""), 2000);
});
