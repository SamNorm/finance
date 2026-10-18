// Applies the viewer's saved theme and sidebar width before first paint, so
// neither flashes. Plain data, readable by the server layout.

export const THEME_KEY = "theme";
export const SIDEBAR_KEY = "sidebar";

export const BOOT_SCRIPT = `try{var d=document.documentElement,t=localStorage.getItem("${THEME_KEY}");if(t&&t!=="system")d.dataset.theme=t;if(localStorage.getItem("${SIDEBAR_KEY}")==="collapsed")d.dataset.sidebar="collapsed"}catch(e){}`;
