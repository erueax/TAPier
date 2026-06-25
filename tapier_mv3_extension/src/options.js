const baseEl = document.getElementById("base");
const keyEl = document.getElementById("key");
const statusEl = document.getElementById("status");

// Load any saved values into the form.
chrome.storage.local.get(["server_base", "demo_key"]).then((s) => {
	baseEl.value = s.server_base || "http://localhost:8080";
	keyEl.value = s.demo_key || "";
});

document.getElementById("save").addEventListener("click", async () => {
	const server_base = baseEl.value.trim().replace(/\/+$/, ""); // drop trailing slash
	const demo_key = keyEl.value;
	await chrome.storage.local.set({ server_base, demo_key });
	statusEl.textContent = "Saved ✓";
	setTimeout(() => (statusEl.textContent = ""), 1500);
});