// Injected into every page
// It every 250ms it checks if the selected text has changed
let debounce;

document.addEventListener("selectionchange", () => {
	clearTimeout(debounce);
	debounce = setTimeout(() => {
		const text = window.getSelection()?.toString().trim();
		if (!text) return;

		chrome.runtime
			.sendMessage({
			type: "live-selection",
			payload: { text, url: location.href, title: document.title },
		})
		.catch(() => {});
	}, 250);
});