// Service Worker: defines the context menu and when the side panel is open

const MENU_ID = "inspect-selection";

// Menu activated via right click
chrome.runtime.onInstalled.addListener(async () => {
	chrome.contextMenus.create({
		id: MENU_ID,
		title: "Undestand with TAPier",
		contexts: ["selection"], // only appears when text is highlighted
	});
	// toolbar-icon click also toggle the panel.
	chrome.sidePanel
		.setPanelBehavior({ openPanelOnActionClick: true })
		.catch((err) => console.error(err));
	  // Create a pseudonymous id once; never overwrite an existing one.
	const { user_id } = await chrome.storage.local.get("user_id");
	if (!user_id) {
		await chrome.storage.local.set({ user_id: crypto.randomUUID() });
	}
});
	
// Activate on menu item, save text for analyses and open the panel.
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
	if (info.menuItemId !== MENU_ID || !info.selectionText) return;
	// Persist so the panel can read even mid-load.
	
	chrome.sidePanel.open({ tabId: tab.id });

	chrome.storage.session.set({
		lastSelection: {
			text: info.selectionText,
			url: info.pageUrl,
			title: tab?.title ?? "",
		},
	});
});